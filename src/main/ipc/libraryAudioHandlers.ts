import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import type { MfbAudioFeatures } from '../../shared/types'
import { deriveAudioFeatures } from '../../shared/deriveAudioFeatures'

export function registerLibraryAudioHandlers(): void {
  ipcMain.handle(
    'library:getWaveformPeaks',
    async (_, filePath: string, numPeaks = 800): Promise<number[]> => {
      return extractPeaks(filePath, numPeaks)
    }
  )

  ipcMain.handle(
    'audio:analyzeCues',
    async (_, filePath: string): Promise<CueAnalysis> => {
      return analyzeCues(filePath)
    }
  )

  ipcMain.handle(
    'audio:analyzeFeatures',
    async (_, filePath: string, durationSec: number): Promise<AnalyzeResult> => {
      return analyzeFeatures(filePath, durationSec)
    }
  )

  ipcMain.handle('audio:getFileDuration', async (_, filePath: string): Promise<number> => {
    return new Promise((resolve) => {
      const bin = (ffmpegPath as string).replace('app.asar', 'app.asar.unpacked')
      if (!bin) { resolve(0); return }
      // Resample to 8kHz mono and count raw output bytes — bypasses any WAV header size bugs.
      // Duration = (16-bit samples at 8000 Hz) = byteCount / 2 / 8000
      const proc = spawn(bin, [
        '-v', 'quiet', '-i', filePath,
        '-ac', '1', '-filter:a', 'aresample=8000',
        '-map', '0:a', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1',
      ])
      let byteCount = 0
      proc.stdout.on('data', (c: Buffer) => { byteCount += c.byteLength })
      proc.stderr.on('data', () => {})
      proc.on('error', () => resolve(0))
      proc.on('close', () => resolve(byteCount / 2 / 8000))
    })
  })
}

export interface CueAnalysis {
  introEndMs: number | null    // where the intro builds to full level; null = no long intro
  outroStartMs: number | null  // where the outro/tail begins; null = plays to the end
}

/**
 * Decode a file to 8kHz mono PCM and derive intro/outro cue points from its
 * energy envelope, so Auto-Mix can crossfade at musically sensible moments.
 *
 * Heuristic: compute RMS over ~100ms windows, take a high percentile as the
 * "full level" reference, then mark a window "active" when it exceeds a
 * fraction of that. The intro ends at the first sustained-active window; the
 * outro begins after the last active window. When the audio is active from the
 * very start / all the way to the end, the corresponding cue is left null and
 * the engine's default fade window applies.
 */
function analyzeCues(filePath: string): Promise<CueAnalysis> {
  return new Promise((resolve) => {
    const bin = (ffmpegPath as string).replace('app.asar', 'app.asar.unpacked')
    if (!bin) { resolve({ introEndMs: null, outroStartMs: null }); return }

    const SR = 8000
    const proc = spawn(bin, [
      '-v', 'quiet', '-i', filePath,
      '-ac', '1', '-filter:a', `aresample=${SR}`,
      '-map', '0:a', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1',
    ])
    const chunks: Buffer[] = []
    proc.stdout.on('data', (c: Buffer) => chunks.push(c))
    proc.stderr.on('data', () => {})
    proc.on('error', () => resolve({ introEndMs: null, outroStartMs: null }))
    proc.on('close', () => {
      const raw = Buffer.concat(chunks)
      if (raw.byteLength < 4) { resolve({ introEndMs: null, outroStartMs: null }); return }
      const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2))

      const WIN = Math.round(SR * 0.1) // 100ms windows
      const winMs = 100
      const rms: number[] = []
      for (let start = 0; start < samples.length; start += WIN) {
        const end = Math.min(start + WIN, samples.length)
        let sum = 0
        for (let j = start; j < end; j++) { const v = samples[j] / 32768; sum += v * v }
        rms.push(Math.sqrt(sum / Math.max(1, end - start)))
      }
      if (rms.length < 3) { resolve({ introEndMs: null, outroStartMs: null }); return }

      // Reference level = 85th percentile of windowed RMS.
      const sorted = [...rms].sort((a, b) => a - b)
      const ref = sorted[Math.floor(sorted.length * 0.85)] || 0
      if (ref <= 0) { resolve({ introEndMs: null, outroStartMs: null }); return }
      const thresh = Math.max(0.02, ref * 0.35)

      const active = (i: number): boolean => rms[i] >= thresh
      const n = rms.length

      // First sustained-active window (3 consecutive) = end of intro build.
      let firstActive = -1
      for (let i = 0; i < n; i++) {
        if (active(i) && active(Math.min(i + 1, n - 1)) && active(Math.min(i + 2, n - 1))) { firstActive = i; break }
      }
      // Last active window = start of outro/tail.
      let lastActive = -1
      for (let i = n - 1; i >= 0; i--) { if (active(i)) { lastActive = i; break } }

      const introEndMs = firstActive > 1 ? firstActive * winMs : null
      const outroStartMs = (lastActive >= 0 && lastActive < n - 2) ? (lastActive + 1) * winMs : null
      resolve({ introEndMs, outroStartMs })
    })
  })
}

// Reccobeats analysis endpoint — same fallback MFB uses server-side. Accepts a
// short audio clip and returns Spotify-scale perceptual features. No API key.
const RECCOBEATS_ANALYSIS_URL = 'https://api.reccobeats.com/v1/analysis/audio-features'
const CLIP_SECONDS = 30

interface BaseFeatures {
  valence: number
  energy: number
  danceability: number
  tempo: number
  mode?: number
}

/**
 * Result of a feature analysis. `retriable` is true when the reason we got no
 * features was transient (rate-limit / server / network), so the caller should
 * leave the file un-analysed and try again on a later pass rather than giving
 * up on it permanently.
 */
export interface AnalyzeResult {
  features: MfbAudioFeatures | null
  retriable: boolean
}

const GAP_BETWEEN_WINDOWS_MS = 400

/**
 * Estimate audio features for a local file that isn't in the MFB catalogue.
 *
 * Breathwork tracks evolve a lot over their length (quiet build → peak →
 * wind-down), so a single window isn't representative. We sample three
 * CLIP_SECONDS windows — start, middle and end — upload each to Reccobeats,
 * and average the perceptual base features across whichever succeed. The
 * averaged base is folded into the full MfbAudioFeatures set via the ported
 * MFB formulas.
 *
 * When no window yields features we report whether the failure was transient
 * (`retriable`) so a rate-limited file self-heals on a later pass instead of
 * being marked done with nothing.
 */
async function analyzeFeatures(filePath: string, durationSec: number): Promise<AnalyzeResult> {
  const starts = clipStarts(durationSec)
  const bases: BaseFeatures[] = []
  let anyTransient = false
  for (let i = 0; i < starts.length; i++) {
    const clip = await extractClip(filePath, starts[i])
    if (!clip || clip.byteLength < 1024) continue
    const { base, transient } = await uploadClip(clip)
    if (base) bases.push(base)
    else if (transient) anyTransient = true
    if (i < starts.length - 1) await sleep(GAP_BETWEEN_WINDOWS_MS)
  }
  if (bases.length > 0) return { features: deriveAudioFeatures(averageBases(bases)), retriable: false }
  // No usable data: retry later only if the failures looked transient.
  return { features: null, retriable: anyTransient }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Window start offsets (seconds) for start/middle/end, deduped for short tracks. */
function clipStarts(durationSec: number): number[] {
  const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0
  if (dur <= CLIP_SECONDS) return [0]
  const starts = [
    0,                                          // start
    Math.max(0, dur / 2 - CLIP_SECONDS / 2),    // middle
    Math.max(0, dur - CLIP_SECONDS),            // end (window ends at track end)
  ]
  // Drop windows whose start rounds to the same second (very short tracks).
  return [...new Set(starts.map((s) => Math.round(s)))]
}

/** Mean of each base feature across the sampled windows. */
function averageBases(bases: BaseFeatures[]): BaseFeatures {
  const n = bases.length
  const sum = (pick: (b: BaseFeatures) => number): number => bases.reduce((a, b) => a + pick(b), 0) / n
  const modes = bases.map((b) => b.mode).filter((m): m is number => typeof m === 'number')
  return {
    valence: sum((b) => b.valence),
    energy: sum((b) => b.energy),
    danceability: sum((b) => b.danceability),
    tempo: sum((b) => b.tempo),
    // Majority-vote the key mode across windows (absent in the upload endpoint today).
    mode: modes.length ? (modes.filter((m) => m === 0).length > modes.length / 2 ? 0 : 1) : undefined,
  }
}

/**
 * Upload one clip to Reccobeats. `transient` marks failures worth retrying:
 * rate-limits (429), server errors (5xx) and network faults. A 200 with no
 * usable features, or a 4xx that isn't 429, is treated as permanent.
 */
async function uploadClip(clip: Buffer): Promise<{ base: BaseFeatures | null; transient: boolean }> {
  try {
    const form = new FormData()
    form.append('audioFile', new Blob([new Uint8Array(clip)], { type: 'audio/mpeg' }), 'audio.mp3')
    const res = await fetch(RECCOBEATS_ANALYSIS_URL, { method: 'POST', body: form })
    if (!res.ok) {
      const transient = res.status === 429 || res.status >= 500
      console.warn(`[features] Reccobeats ${res.status}${transient ? ' (will retry)' : ''}`)
      return { base: null, transient }
    }
    return { base: parseBaseFeatures((await res.json()) as unknown), transient: false }
  } catch (err) {
    // Network-level failure (offline, DNS, timeout) — retriable.
    console.warn('[features] Reccobeats request failed (will retry):', err instanceof Error ? err.message : err)
    return { base: null, transient: true }
  }
}

/** Pull valence/energy/danceability/tempo/mode out of a Reccobeats response. */
function parseBaseFeatures(json: unknown): BaseFeatures | null {
  if (!json || typeof json !== 'object') return null
  // Response may be flat or wrapped in a `content` array (both seen from Reccobeats).
  const obj = json as Record<string, unknown>
  const src = Array.isArray(obj.content) && obj.content.length > 0
    ? (obj.content[0] as Record<string, unknown>)
    : obj
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const valence = num(src.valence)
  const energy = num(src.energy)
  const danceability = num(src.danceability)
  if (valence === null || energy === null || danceability === null) return null
  return {
    valence,
    energy,
    danceability,
    tempo: num(src.tempo) ?? 0,
    mode: num(src.mode) ?? undefined,
  }
}

/** ffmpeg: extract a CLIP_SECONDS mp3 clip starting at startSec as a Buffer. */
function extractClip(filePath: string, startSec: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const bin = (ffmpegPath as string).replace('app.asar', 'app.asar.unpacked')
    if (!bin) { resolve(null); return }
    const start = Number.isFinite(startSec) && startSec > 0 ? startSec : 0
    const proc = spawn(bin, [
      '-v', 'quiet',
      '-ss', start.toFixed(2), '-t', String(CLIP_SECONDS), '-i', filePath,
      '-ac', '2', '-b:a', '128k', '-f', 'mp3', 'pipe:1',
    ])
    const chunks: Buffer[] = []
    proc.stdout.on('data', (c: Buffer) => chunks.push(c))
    proc.stderr.on('data', () => {})
    proc.on('error', () => resolve(null))
    proc.on('close', () => resolve(chunks.length ? Buffer.concat(chunks) : null))
  })
}

function extractPeaks(filePath: string, numPeaks: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const bin = (ffmpegPath as string).replace('app.asar', 'app.asar.unpacked')
    if (!bin) { reject(new Error('ffmpeg not found')); return }

    const args = [
      '-v', 'error', '-i', filePath,
      '-ac', '1', '-filter:a', 'aresample=8000',
      '-map', '0:a', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1',
    ]
    const proc = spawn(bin, args)
    const chunks: Buffer[] = []
    let stderr = ''
    proc.stdout.on('data', (c: Buffer) => chunks.push(c))
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0 && chunks.length === 0) {
        const detail = stderr.trim().split('\n').pop() || 'unknown error'
        console.warn(`[waveform] ffmpeg exited ${code} for ${filePath}: ${detail}`)
        reject(new Error(`ffmpeg exited ${code}: ${detail}`))
        return
      }
      const raw = Buffer.concat(chunks)
      const samples = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2)
      const spp = Math.max(1, Math.floor(samples.length / numPeaks))
      const peaks: number[] = []
      for (let i = 0; i < numPeaks; i++) {
        let max = 0
        const start = i * spp
        const end = Math.min(start + spp, samples.length)
        for (let j = start; j < end; j++) {
          const abs = Math.abs(samples[j]) / 32768
          if (abs > max) max = abs
        }
        peaks.push(max)
      }
      resolve(peaks)
    })
  })
}
