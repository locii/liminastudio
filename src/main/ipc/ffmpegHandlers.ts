import { ipcMain, BrowserWindow, dialog } from 'electron'
import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { promises as fs } from 'fs'
import { basename, join } from 'path'
import { tmpdir } from 'os'
import ffmpegPath from 'ffmpeg-static'

let activeExport: { proc: ChildProcess; outputPath: string; cancelled: boolean } | null = null

const CLIP_NUMERIC_FIELDS = [
  'startTime', 'duration', 'trimStart', 'trimEnd', 'fadeIn', 'fadeOut',
  'fadeInCurve', 'fadeOutCurve', 'crossfadeIn', 'crossfadeOut', 'volume',
] as const

// Clip fields are interpolated into ffmpeg's -filter_complex string. Coerce
// them to finite numbers so a crafted .limina file can't inject extra filters
// (e.g. `amovie=` to read arbitrary files into the export).
function sanitizeClip(clip: ClipExport): ClipExport {
  const out = { ...clip }
  for (const k of CLIP_NUMERIC_FIELDS) {
    const v = Number(clip[k] ?? 0)
    if (!Number.isFinite(v)) throw new Error(`Clip "${basename(String(clip.filePath))}" has an invalid ${k}.`)
    out[k] = v
  }
  return out
}

// Turn ffmpeg's stderr into something a facilitator can act on; the raw output
// still goes to the console for debugging.
function friendlyExportError(stderr: string): string {
  if (/No space left on device/i.test(stderr)) return 'Export failed: the destination disk is full.'
  if (/Permission denied|Operation not permitted/i.test(stderr)) return "Export failed: Limina doesn't have permission to write to that location. Choose another folder."
  if (/Invalid data found|could not find codec|moov atom not found/i.test(stderr)) return 'Export failed: one of the audio files is damaged or not fully downloaded.'
  return 'Export failed while rendering the mix. Try again, or check that every clip plays.'
}

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

interface ExportChapter {
  title: string
  start: number // seconds
  end: number   // seconds
}

interface ExportConfig {
  clips: ClipExport[]
  tracks: TrackExport[]
  outputPath: string
  format: 'wav' | 'mp3'
  sampleRate: 44100 | 48000
  bitrate?: 128 | 192 | 320
  /** Embedded as ID3 chapters (MP3) and/or written to a .cue sheet. */
  chapters?: ExportChapter[]
  writeCueSheet?: boolean
}

function sanitizeChapters(chapters: ExportChapter[] | undefined, total: number): ExportChapter[] {
  return (chapters ?? [])
    .map((c) => ({
      title: String(c.title ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200) || 'Untitled',
      start: Math.max(0, Math.min(total, Number(c.start))),
      end: Math.max(0, Math.min(total, Number(c.end))),
    }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
    .sort((a, b) => a.start - b.start)
}

// FFMETADATA1 chapter file for ffmpeg (-map_chapters). Values escape = ; # \ and newlines.
function ffmetadata(chapters: ExportChapter[]): string {
  const esc = (s: string): string => s.replace(/([=;#\\\n])/g, '\\$1')
  return [
    ';FFMETADATA1',
    ...chapters.flatMap((c) => [
      '[CHAPTER]',
      'TIMEBASE=1/1000',
      `START=${Math.round(c.start * 1000)}`,
      `END=${Math.round(c.end * 1000)}`,
      `title=${esc(c.title)}`,
    ]),
    '',
  ].join('\n')
}

// Standard CD-style cue sheet (INDEX times are mm:ss:ff at 75 frames/s).
function cueSheet(chapters: ExportChapter[], audioFile: string, format: 'wav' | 'mp3'): string {
  const q = (s: string): string => s.replace(/"/g, "'")
  const ts = (sec: number): string => {
    const frames = Math.round(sec * 75)
    const m = Math.floor(frames / (75 * 60))
    const s = Math.floor((frames / 75) % 60)
    const f = frames % 75
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`
  }
  const lines = [
    `TITLE "${q(basename(audioFile).replace(/\.[^.]+$/, ''))}"`,
    `FILE "${q(basename(audioFile))}" ${format === 'mp3' ? 'MP3' : 'WAVE'}`,
  ]
  chapters.forEach((c, i) => {
    lines.push(`  TRACK ${String(i + 1).padStart(2, '0')} AUDIO`)
    lines.push(`    TITLE "${q(c.title)}"`)
    lines.push(`    INDEX 01 ${ts(c.start)}`)
  })
  return lines.join('\r\n') + '\r\n'
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

  ipcMain.handle('export:cancel', () => {
    if (!activeExport) return
    activeExport.cancelled = true
    activeExport.proc.kill('SIGKILL')
  })

  ipcMain.handle('export:mix', async (_, config: ExportConfig): Promise<string> => {
    const win = getMainWindow()
    const bin = (ffmpegPath as string).replace('app.asar', 'app.asar.unpacked')
    if (!bin) throw new Error('ffmpeg binary not found')

    config = { ...config, clips: config.clips.map(sanitizeClip) }

    // Verify all files exist
    for (const clip of config.clips) {
      try { await fs.access(clip.filePath) } catch {
        throw new Error(`Can't find "${basename(clip.filePath)}". Relink it (right-click the clip → Locate…) and export again.`)
      }
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

    const chapters = sanitizeChapters(config.chapters, totalDuration)
    let metadataPath: string | undefined
    if (config.format === 'mp3' && chapters.length > 0) {
      metadataPath = join(tmpdir(), `limina-chapters-${Date.now()}.txt`)
      await fs.writeFile(metadataPath, ffmetadata(chapters), 'utf-8')
    }

    const { args } = buildFfmpegArgs(included, trackMap, config, totalDuration, metadataPath)

    console.log('[export] ffmpeg filter_complex:', args[args.indexOf('-filter_complex') + 1])

    return new Promise<string>((resolve, reject) => {
      const proc = spawn(bin, args)
      const job = { proc, outputPath: config.outputPath, cancelled: false }
      activeExport = job
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
        if (activeExport === job) activeExport = null
        if (metadataPath) fs.unlink(metadataPath).catch(() => {})
        if (job.cancelled) {
          fs.unlink(config.outputPath).catch(() => {})
          reject(new Error('EXPORT_CANCELLED'))
          return
        }
        if (code !== 0) {
          console.error(`[export] ffmpeg failed (code ${code}):\n${stderr.slice(-2000)}`)
          reject(new Error(friendlyExportError(stderr)))
          return
        }
        win?.webContents.send('export:progress', 1)
        if (config.writeCueSheet && chapters.length > 0) {
          const cuePath = config.outputPath.replace(/\.[^.\\/]+$/, '') + '.cue'
          fs.writeFile(cuePath, cueSheet(chapters, config.outputPath, config.format), 'utf-8')
            .catch((e) => console.error('[export] cue sheet failed', e))
        }
        resolve(config.outputPath)
      })
    })
  })
}

function buildFfmpegArgs(
  clips: ClipExport[],
  trackMap: Map<string, TrackExport>,
  config: ExportConfig,
  totalDuration: number,
  metadataPath?: string,
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
      ? ['-c:a', 'pcm_s24le']
      : ['-c:a', 'libmp3lame', '-b:a', `${config.bitrate ?? 320}k`]

  // Chapter metadata is one extra input after the clips; map only its chapters.
  const metaInput = metadataPath ? ['-f', 'ffmetadata', '-i', metadataPath] : []
  const metaMap = metadataPath
    ? ['-map_metadata', String(clips.length), '-map_chapters', String(clips.length), '-id3v2_version', '3']
    : []
  const args = [
    ...inputs,
    ...metaInput,
    '-filter_complex', filterComplex,
    '-map', `[${outLabel}]`,
    ...metaMap,
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
