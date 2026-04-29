import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import ffmpegPath from 'ffmpeg-static'

export function registerAudioHandlers(): void {
  ipcMain.handle(
    'audio:getWaveformPeaks',
    async (_, filePath: string, numPeaks = 1000): Promise<number[]> => {
      return extractPeaks(filePath, numPeaks)
    }
  )
}

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
      '-filter:a', 'aresample=8000',
      '-map', '0:a',
      '-c:a', 'pcm_s16le',
      '-f', 's16le',
      'pipe:1',
    ]

    const proc = spawn(bin, args)
    const chunks: Buffer[] = []

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    proc.stderr.on('data', () => {}) // suppress stderr

    proc.on('error', reject)

    proc.on('close', (code) => {
      if (code !== 0 && chunks.length === 0) {
        reject(new Error(`ffmpeg exited with code ${code}`))
        return
      }

      const raw = Buffer.concat(chunks)
      const samples = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2)
      const samplesPerPeak = Math.max(1, Math.floor(samples.length / numPeaks))
      const peaks: number[] = []

      for (let i = 0; i < numPeaks; i++) {
        let max = 0
        const start = i * samplesPerPeak
        const end = Math.min(start + samplesPerPeak, samples.length)
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
