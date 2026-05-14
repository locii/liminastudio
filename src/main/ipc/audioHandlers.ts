import { ipcMain, dialog } from 'electron'
import { promises as fs } from 'fs'
import { spawn } from 'child_process'
import ffmpegPath from 'ffmpeg-static'

// Peaks are returned as a flat interleaved array of [min, max] pairs in
// normalized [-1, 1] range. Length = numPeaks * 2.
export function registerAudioHandlers(): void {
  ipcMain.handle(
    'audio:getWaveformPeaks',
    async (_, filePath: string, numPeaks = 1000): Promise<number[]> => {
      return extractPeaks(filePath, numPeaks)
    }
  )

  ipcMain.handle('audio:getPeakLevel', async (_, filePath: string): Promise<number> => {
    return getPeakLevel(filePath)
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
      '-v', 'quiet',
      '-i', filePath,
      '-ac', '1',
      '-ar', String(EXTRACT_SAMPLE_RATE),
      '-map', '0:a',
      '-c:a', 'pcm_s16le',
      '-f', 's16le',
      'pipe:1',
    ]

    const proc = spawn(bin, args)

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

    proc.stderr.on('data', () => {})
    proc.on('error', reject)

    proc.on('close', (code) => {
      if (code !== 0 && buckets.length === 0 && curCount === 0) {
        reject(new Error(`ffmpeg exited with code ${code}`))
        return
      }
      if (curCount > 0) flushBucket()

      const pairCount = buckets.length / 2
      const result = new Array<number>(numPeaks * 2).fill(0)
      if (pairCount === 0) {
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
