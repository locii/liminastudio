import { ipcMain, BrowserWindow, dialog } from 'electron'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import ffmpegPath from 'ffmpeg-static'

interface ClipExport {
  id: string
  trackId: string
  filePath: string
  startTime: number
  duration: number
  trimStart: number
  trimEnd: number
  fadeIn: number
  fadeOut: number
  fadeInCurve: number
  fadeOutCurve: number
  crossfadeIn: number
  crossfadeOut: number
  volume: number
}

interface TrackExport {
  id: string
  volume: number
  muted: boolean
  solo: boolean
}

interface ExportConfig {
  clips: ClipExport[]
  tracks: TrackExport[]
  outputPath: string
  format: 'wav' | 'mp3'
  sampleRate: 44100 | 48000
  bitrate?: 128 | 192 | 320
}

export function registerFfmpegHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('dialog:showSaveAudio', async (_, format: 'wav' | 'mp3'): Promise<string | null> => {
    const win = getMainWindow()
    const result = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Export Mix',
      defaultPath: `mix.${format}`,
      filters: [
        format === 'wav'
          ? { name: 'WAV Audio', extensions: ['wav'] }
          : { name: 'MP3 Audio', extensions: ['mp3'] },
      ],
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('export:mix', async (_, config: ExportConfig): Promise<string> => {
    const win = getMainWindow()
    const bin = (ffmpegPath as string).replace('app.asar', 'app.asar.unpacked')
    if (!bin) throw new Error('ffmpeg binary not found')

    // Verify all files exist
    for (const clip of config.clips) {
      await fs.access(clip.filePath)
    }

    const trackMap = new Map(config.tracks.map((t) => [t.id, t]))
    const hasSolo = config.tracks.some((t) => t.solo)

    const included = config.clips.filter((clip) => {
      const track = trackMap.get(clip.trackId)
      if (!track) return false
      if (track.muted) return false
      if (hasSolo && !track.solo) return false
      return true
    })

    if (included.length === 0) throw new Error('No clips to export (all tracks muted?)')

    const totalDuration = Math.max(
      ...included.map((c) => c.startTime + (c.duration - c.trimStart - c.trimEnd))
    )

    const { args } = buildFfmpegArgs(included, trackMap, config, totalDuration)

    console.log('[export] ffmpeg filter_complex:', args[args.indexOf('-filter_complex') + 1])

    return new Promise<string>((resolve, reject) => {
      const proc = spawn(bin, args)
      let stderr = ''

      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        stderr += text
        // Parse time= lines for progress
        const m = text.match(/time=(\d+):(\d+):(\d+\.\d+)/)
        if (m) {
          const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3])
          const pct = totalDuration > 0 ? Math.min(1, secs / totalDuration) : 0
          win?.webContents.send('export:progress', pct)
        }
      })

      proc.on('error', reject)

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg failed (code ${code}):\n${stderr.slice(-1000)}`))
          return
        }
        win?.webContents.send('export:progress', 1)
        resolve(config.outputPath)
      })
    })
  })
}

function buildFfmpegArgs(
  clips: ClipExport[],
  trackMap: Map<string, TrackExport>,
  config: ExportConfig,
  totalDuration: number
): { args: string[] } {
  const inputs: string[] = []
  const filterParts: string[] = []
  const labels: string[] = []

  clips.forEach((clip, i) => {
    const track = trackMap.get(clip.trackId)!
    const vol = track.volume * clip.volume
    const eff = clip.duration - clip.trimStart - clip.trimEnd
    const delayMs = Math.round(clip.startTime * 1000)

    inputs.push('-i', clip.filePath)

    let chain = `[${i}:a]`

    const fadeIn = Math.max(clip.fadeIn, clip.crossfadeIn ?? 0)
    const fadeOut = Math.max(clip.fadeOut, clip.crossfadeOut ?? 0)

    // Trim to effective region, delay to timeline position, then apply
    // per-clip gain + fade curves using the same power-law formula as playback.
    chain += `atrim=start=${clip.trimStart}:end=${clip.duration - clip.trimEnd},`
    chain += `asetpts=PTS-STARTPTS,`
    chain += `adelay=${delayMs}:all=1,`
    chain += buildVolumeExpr(vol, clip.startTime, fadeIn, clip.fadeInCurve ?? 0.5, fadeOut, clip.fadeOutCurve ?? 0.5, eff)
    chain += `,apad`
    const label = `a${i}`
    chain += `[${label}]`
    filterParts.push(chain)
    labels.push(`[${label}]`)
  })

  const mixLabel = 'mixed'
  const outLabel = 'out'
  // Apply -3 dB (1/√2) before the limiter: equal-power crossfades of two clips
  // sum to exactly +3 dB at the midpoint, so this neutralises that headroom hit.
  // The alimiter then only needs to catch genuinely unusual peaks.
  if (labels.length === 1) {
    filterParts.push(`${labels[0]}alimiter=limit=0.891:level=0:attack=1:release=50[${outLabel}]`)
  } else {
    filterParts.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0[${mixLabel}]`)
    filterParts.push(`[${mixLabel}]alimiter=limit=0.891:level=0:attack=1:release=50[${outLabel}]`)
  }

  const filterComplex = filterParts.join(';')

  // Output codec
  const codecArgs: string[] =
    config.format === 'wav'
      ? ['-c:a', 'pcm_s16le']
      : ['-c:a', 'libmp3lame', '-b:a', `${config.bitrate ?? 320}k`]

  const args = [
    ...inputs,
    '-filter_complex', filterComplex,
    '-map', `[${outLabel}]`,
    '-ar', String(config.sampleRate),
    '-ac', '2',
    '-t', totalDuration.toFixed(3),
    ...codecArgs,
    '-y',             // overwrite output
    config.outputPath,
  ]

  return { args }
}

// Builds a ffmpeg volume filter expression that replicates the playback engine's
// power-law fade curve: gain = t^(4^-curveParam).
// Single-quoted so ffmpeg parses commas inside the if() calls correctly.
function buildVolumeExpr(
  vol: number,
  clipStart: number,
  fadeIn: number,
  fadeInCurve: number,
  fadeOut: number,
  fadeOutCurve: number,
  eff: number
): string {
  const v = vol.toFixed(4)
  const expIn = Math.pow(4, -fadeInCurve).toFixed(4)
  const expOut = Math.pow(4, -fadeOutCurve).toFixed(4)
  const cs = clipStart.toFixed(3)
  const fie = (clipStart + fadeIn).toFixed(3)
  const fid = fadeIn.toFixed(3)
  const fos = (clipStart + eff - fadeOut).toFixed(3)
  const fod = fadeOut.toFixed(3)

  let expr: string
  if (fadeIn > 0 && fadeOut > 0) {
    expr = `${v}*if(lt(t,${cs}),0,if(lt(t,${fie}),pow((t-${cs})/${fid},${expIn}),if(gt(t,${fos}),pow(max(0,1-(t-${fos})/${fod}),${expOut}),1)))`
  } else if (fadeIn > 0) {
    expr = `${v}*if(lt(t,${cs}),0,if(lt(t,${fie}),pow((t-${cs})/${fid},${expIn}),1))`
  } else if (fadeOut > 0) {
    expr = `${v}*if(gt(t,${fos}),pow(max(0,1-(t-${fos})/${fod}),${expOut}),if(lt(t,${cs}),0,1))`
  } else {
    return `volume=${v}`
  }

  return `volume='${expr}':eval=frame`
}
