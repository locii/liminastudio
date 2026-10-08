import { app, ipcMain, dialog } from 'electron'
import { promises as fs } from 'fs'
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { join } from 'path'
import ffmpegPath from 'ffmpeg-static'

// ── Peak cache ──────────────────────────────────────────────────────────────
// Decoding a 3-hour set's worth of audio for waveforms took a long time on
// every session open. Results are cached on disk keyed by path + size + mtime
// (so an edited/replaced file re-extracts), identical in-flight requests share
// one ffmpeg run, and at most FFMPEG_CONCURRENCY decodes run at once so a
// session open doesn't starve the audio server and IPC.

const FFMPEG_CONCURRENCY = 3
const CACHE_MAX_FILES = 2000

let running = 0
const waiting: (() => void)[] = []

async function withDecodeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= FFMPEG_CONCURRENCY) await new Promise<void>((r) => waiting.push(r))
  running++
  try { return await fn() } finally {
    running--
    waiting.shift()?.()
  }
}

const inFlight = new Map<string, Promise<unknown>>()

function cacheDir(): string {
  return join(app.getPath('userData'), 'peak-cache')
}

async function cacheKey(filePath: string, kind: string): Promise<string | null> {
  try {
    const st = await fs.stat(filePath)
    // Zero-byte files are cloud placeholders (e.g. Dropbox online-only) —
    // never cache their empty result.
    if (st.size === 0) return null
    return createHash('sha1').update(`${filePath}\0${st.size}\0${st.mtimeMs}\0${kind}`).digest('hex')
  } catch {
    return null
  }
}

async function cached<T>(
  filePath: string,
  kind: string,
  encode: (v: T) => Buffer,
  decode: (b: Buffer) => T,
  compute: () => Promise<T>,
  shouldCache: (v: T) => boolean = () => true,
): Promise<T> {
  const key = await cacheKey(filePath, kind)
  if (!key) return withDecodeSlot(compute)
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const p = (async (): Promise<T> => {
    const file = join(cacheDir(), key)
    try { return decode(await fs.readFile(file)) } catch { /* miss */ }
    const value = await withDecodeSlot(compute)
    if (shouldCache(value)) {
      fs.mkdir(cacheDir(), { recursive: true })
        .then(() => fs.writeFile(file, encode(value)))
        .catch(() => {})
    }
    return value
  })()
  inFlight.set(key, p)
  try { return await p } finally { inFlight.delete(key) }
}

const encodePeaks = (v: number[]): Buffer => Buffer.from(new Float32Array(v).buffer)
const decodePeaks = (b: Buffer): number[] =>
  Array.from(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4))
const encodeLevel = (v: number): Buffer => Buffer.from(String(v))
const decodeLevel = (b: Buffer): number => {
  const v = parseFloat(b.toString())
  if (!Number.isFinite(v)) throw new Error('corrupt cache entry')
  return v
}

// Keep the cache bounded: drop the least-recently-written entries.
async function pruneCache(): Promise<void> {
  const dir = cacheDir()
  const names = await fs.readdir(dir).catch(() => [] as string[])
  if (names.length <= CACHE_MAX_FILES) return
  const entries = await Promise.all(names.map(async (n) => {
    const st = await fs.stat(join(dir, n)).catch(() => null)
    return { n, t: st?.mtimeMs ?? 0 }
  }))
  entries.sort((a, b) => a.t - b.t)
  for (const { n } of entries.slice(0, entries.length - CACHE_MAX_FILES)) {
    await fs.unlink(join(dir, n)).catch(() => {})
  }
}

// Peaks are returned as a flat interleaved array of [min, max] pairs in
// normalized [-1, 1] range. Length = numPeaks * 2.
export function registerAudioHandlers(): void {
  pruneCache().catch(() => {})

  ipcMain.handle(
    'audio:getWaveformPeaks',
    async (_, filePath: string, numPeaks = 1000): Promise<number[]> => {
      return cached(
        filePath, `peaks:${numPeaks}`, encodePeaks, decodePeaks,
        () => extractPeaks(filePath, numPeaks),
        // All-zero = nothing decoded (cloud placeholder not yet downloaded) — retry next time.
        (peaks) => peaks.some((v) => v !== 0),
      )
    }
  )

  ipcMain.handle('audio:getPeakLevel', async (_, filePath: string): Promise<number> => {
    return cached(filePath, 'peakLevel', encodeLevel, decodeLevel, () => getPeakLevel(filePath))
  })

  ipcMain.handle('audio:getLoudness', async (_, filePath: string): Promise<Loudness> => {
    return cached(
      filePath, 'loudness',
      (v) => Buffer.from(JSON.stringify(v)),
      (b) => {
        const v = JSON.parse(b.toString()) as Loudness
        if (!Number.isFinite(v.integratedLufs) || !Number.isFinite(v.truePeakDb)) throw new Error('corrupt cache entry')
        return v
      },
      () => getLoudness(filePath),
    )
  })

  ipcMain.handle(
    'audio:exportWaveformData',
    async (_, json: string, defaultName = 'waveform-data.json'): Promise<string | null> => {
      const result = await dialog.showSaveDialog({
        title: 'Export Waveform Data',
        defaultPath: defaultName,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePath) return null
      await fs.writeFile(result.filePath, json, 'utf-8')
      return result.filePath
    }
  )
}

const EXTRACT_SAMPLE_RATE = 48000
const INITIAL_SAMPLES_PER_BUCKET = 256

function extractPeaks(filePath: string, numPeaks: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const bin = (ffmpegPath as string).replace('app.asar', 'app.asar.unpacked')
    if (!bin) {
      reject(new Error('ffmpeg-static binary not found'))
      return
    }

    const args = [
      '-v', 'error',
      '-i', filePath,
      '-ac', '1',
      '-ar', String(EXTRACT_SAMPLE_RATE),
      '-map', '0:a',
      '-c:a', 'pcm_s16le',
      '-f', 's16le',
      'pipe:1',
    ]

    const proc = spawn(bin, args)
    let stderr = ''

    // Halving-streaming peak extractor: keeps memory bounded to ~2*numPeaks pairs
    // regardless of file length. When the bucket array grows past the target,
    // adjacent buckets are merged and samplesPerBucket doubles.
    let buckets: number[] = []
    let samplesPerBucket = INITIAL_SAMPLES_PER_BUCKET
    let curMin = 0
    let curMax = 0
    let curCount = 0
    let leftover: Buffer | null = null

    const halveIfNeeded = (): void => {
      // buckets holds flat [min0, max0, min1, max1, ...]; pair count = length / 2.
      if (buckets.length < 2 * numPeaks * 2) return
      const merged: number[] = new Array(buckets.length / 2)
      for (let i = 0, j = 0; i < buckets.length; i += 4, j += 2) {
        merged[j] = Math.min(buckets[i], buckets[i + 2] ?? buckets[i])
        merged[j + 1] = Math.max(buckets[i + 1], buckets[i + 3] ?? buckets[i + 1])
      }
      buckets = merged
      samplesPerBucket *= 2
    }

    const flushBucket = (): void => {
      buckets.push(curMin, curMax)
      curMin = 0
      curMax = 0
      curCount = 0
      halveIfNeeded()
    }

    proc.stdout.on('data', (chunk: Buffer) => {
      let buf = chunk
      if (leftover) {
        buf = Buffer.concat([leftover, chunk])
        leftover = null
      }
      const usableBytes = buf.length - (buf.length % 2)
      if (usableBytes < buf.length) leftover = buf.subarray(usableBytes)
      const samples = new Int16Array(buf.buffer, buf.byteOffset, usableBytes / 2)

      for (let i = 0; i < samples.length; i++) {
        const v = samples[i] / 32768
        if (v < curMin) curMin = v
        if (v > curMax) curMax = v
        curCount++
        if (curCount >= samplesPerBucket) flushBucket()
      }
    })

    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('error', reject)

    proc.on('close', (code) => {
      if (code !== 0 && buckets.length === 0 && curCount === 0) {
        reject(new Error(`ffmpeg exited with code ${code} for ${filePath}: ${stderr.trim() || '(no stderr)'}`))
        return
      }
      if (curCount > 0) flushBucket()

      const pairCount = buckets.length / 2
      const result = new Array<number>(numPeaks * 2).fill(0)
      if (pairCount === 0) {
        // File opened but decoded to no audio samples — typically a zero-byte or
        // cloud-placeholder file (e.g. Dropbox online-only). Surface it so the
        // renderer can distinguish "empty" from a real waveform of silence.
        console.warn(`[getWaveformPeaks] no audio decoded for ${filePath}${stderr.trim() ? ` — ${stderr.trim()}` : ''}`)
        resolve(result)
        return
      }

      // Downsample (or upsample by repetition) to exactly numPeaks pairs.
      const step = pairCount / numPeaks
      for (let p = 0; p < numPeaks; p++) {
        const start = Math.floor(p * step)
        const end = Math.max(start + 1, Math.floor((p + 1) * step))
        let mn = 0
        let mx = 0
        for (let i = start; i < end && i < pairCount; i++) {
          const bmn = buckets[i * 2]
          const bmx = buckets[i * 2 + 1]
          if (bmn < mn) mn = bmn
          if (bmx > mx) mx = bmx
        }
        result[p * 2] = mn
        result[p * 2 + 1] = mx
      }
      resolve(result)
    })
  })
}

export interface Loudness {
  /** Integrated loudness (EBU R128 / ITU-R BS.1770), LUFS. */
  integratedLufs: number
  /** True peak, dBTP. */
  truePeakDb: number
}

// Perceived loudness via ffmpeg's ebur128 meter. Peak normalisation makes every
// track hit the same *peak*, but a dense track then sounds far louder than a
// sparse one; matching integrated loudness keeps a 3-hour set even.
function getLoudness(filePath: string): Promise<Loudness> {
  return new Promise((resolve, reject) => {
    const bin = (ffmpegPath as string).replace('app.asar', 'app.asar.unpacked')
    if (!bin) { reject(new Error('ffmpeg-static binary not found')); return }
    const proc = spawn(bin, ['-hide_banner', '-nostats', '-i', filePath, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'])
    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      // Per-frame lines are long; only the trailing summary matters.
      if (stderr.length > 64_000) stderr = stderr.slice(-16_000)
    })
    proc.on('error', reject)
    proc.on('close', () => {
      const summary = stderr.slice(stderr.lastIndexOf('Summary:'))
      const i = summary.match(/I:\s*(-?[\d.]+|-inf)\s*LUFS/)
      const p = summary.match(/Peak:\s*(-?[\d.]+|-inf)\s*dBFS/)
      if (!i || !p) { reject(new Error('Could not parse loudness from ffmpeg output')); return }
      const num = (s: string): number => (s === '-inf' ? -70 : parseFloat(s))
      resolve({ integratedLufs: num(i[1]), truePeakDb: num(p[1]) })
    })
  })
}

// Returns the true peak amplitude (0–1 linear) using ffmpeg volumedetect.
function getPeakLevel(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const bin = (ffmpegPath as string).replace('app.asar', 'app.asar.unpacked')
    if (!bin) {
      reject(new Error('ffmpeg-static binary not found'))
      return
    }

    const args = ['-i', filePath, '-af', 'volumedetect', '-f', 'null', '-']

    const proc = spawn(bin, args)
    let stderr = ''

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('error', reject)

    proc.on('close', () => {
      // volumedetect writes: "max_volume: -6.0 dB"
      const match = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/)
      if (!match) {
        reject(new Error('Could not parse peak level from ffmpeg output'))
        return
      }
      const dBFS = parseFloat(match[1])
      const linear = Math.pow(10, dBFS / 20)
      resolve(linear)
    })
  })
}
