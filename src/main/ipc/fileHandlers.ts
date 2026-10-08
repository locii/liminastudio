import { ipcMain, dialog, shell, clipboard, app } from 'electron'
import { promises as fs } from 'fs'
import { spawn } from 'child_process'
import { basename, join } from 'path'
import * as mm from 'music-metadata'
import ffmpegPath from 'ffmpeg-static'
import { safeOpenExternal } from '../safeOpenExternal'

export interface LibraryMfbData {
  mfbTrackId: number
  trackTitle: string
  artist: string
  albumImageUrl: string | null
  tags: string[]
  breathworkPhase: string | null
}

export interface AudioFileMeta {
  path: string
  name: string
  duration: number
  sampleRate: number
  channels: number
}

export function registerFileHandlers(): void {
  ipcMain.handle('file:openAudioFiles', async (): Promise<AudioFileMeta[]> => {
    const result = await dialog.showOpenDialog({
      title: 'Add Audio Files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'aiff', 'aif', 'm4a', 'ogg'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) return []

    const metas: AudioFileMeta[] = []
    for (const filePath of result.filePaths) {
      const meta = await parseMeta(filePath)
      if (meta) metas.push(meta)
    }
    return metas
  })

  ipcMain.handle(
    'file:getAudioMetadata',
    async (_, filePath: string): Promise<AudioFileMeta | null> => parseMeta(filePath)
  )

  ipcMain.handle('shell:showInFolder', (_e, filePath: string) => shell.showItemInFolder(filePath))
  ipcMain.handle('shell:openExternal', (_e, url: string) => safeOpenExternal(url))

  // Given a list of file paths, return only those that are missing on disk.
  // Used by Mix to flag clips whose audio can't be found so the session still
  // loads (with placeholders) instead of stalling on the missing file.
  ipcMain.handle('file:checkExist', async (_e, paths: string[]): Promise<string[]> => {
    const missing: string[] = []
    await Promise.all(
      paths.map(async (p) => {
        try { await fs.access(p) } catch { missing.push(p) }
      })
    )
    return missing
  })

  // Pre-session check: is each file actually on this disk? Cloud-synced folders
  // (Dropbox, iCloud) leave "online-only" placeholders that look present but
  // read as silence or 0 duration mid-session.
  //   ok      — readable, data on disk
  //   cloud   — placeholder with a size but no blocks allocated (dataless);
  //             reading it makes the sync app download it
  //   empty   — 0 bytes; nothing to download from here
  //   missing — not found
  ipcMain.handle('file:checkReady', async (_e, paths: string[]): Promise<{ path: string; status: 'ok' | 'cloud' | 'empty' | 'missing' }[]> => {
    return Promise.all(paths.map(async (p) => {
      try {
        const st = await fs.stat(p)
        if (st.size === 0) return { path: p, status: 'empty' as const }
        if (st.blocks === 0) return { path: p, status: 'cloud' as const }
        return { path: p, status: 'ok' as const }
      } catch {
        return { path: p, status: 'missing' as const }
      }
    }))
  })

  // Ask the sync app to download online-only files by reading from each one —
  // the OS blocks the read until the file is materialised. One at a time (they
  // can be large), each capped so a stuck download can't hang the queue.
  // Progress is reported per file on 'file:makeAvailableProgress'.
  ipcMain.handle('file:makeAvailable', async (e, paths: string[]): Promise<{ path: string; ok: boolean }[]> => {
    const results: { path: string; ok: boolean }[] = []
    let done = 0
    for (const p of paths) {
      const ok = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 5 * 60_000)
        ;(async () => {
          const fh = await fs.open(p, 'r')
          try { await fh.read(Buffer.alloc(65536), 0, 65536, 0) } finally { await fh.close() }
          const st = await fs.stat(p)
          return st.size > 0 && st.blocks > 0
        })()
          .then((v) => { clearTimeout(timer); resolve(v) })
          .catch(() => { clearTimeout(timer); resolve(false) })
      })
      results.push({ path: p, ok })
      done++
      if (!e.sender.isDestroyed()) e.sender.send('file:makeAvailableProgress', { done, total: paths.length, path: p, ok })
    }
    return results
  })

  const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.aiff', '.aif', '.m4a', '.ogg'])
  ipcMain.handle('shell:readClipboardPath', async (): Promise<string | null> => {
    const text = clipboard.readText().trim()
    if (!text) return null
    const ext = require('path').extname(text).toLowerCase()
    if (!AUDIO_EXTS.has(ext)) return null
    try { await fs.access(text); return text } catch { return null }
  })

  ipcMain.handle(
    'file:importFile',
    async (): Promise<{ content: string; filePath: string; ext: string } | null> => {
      const result = await dialog.showOpenDialog({
        title: 'Import Session',
        properties: ['openFile'],
        filters: [
          { name: 'DAW Sessions', extensions: ['sesx', 'aup'] },
          { name: 'Adobe Audition Session', extensions: ['sesx'] },
          { name: 'Audacity Project (legacy)', extensions: ['aup'] },
        ],
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const filePath = result.filePaths[0]
      const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
      const content = await fs.readFile(filePath, 'utf-8')
      return { content, filePath, ext }
    }
  )

  ipcMain.handle(
    'file:pickFolder',
    async (): Promise<string | null> => {
      const result = await dialog.showOpenDialog({
        title: 'Choose folder to copy audio files into',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    }
  )

  ipcMain.handle(
    'library:lookupFile',
    async (_, filePath: string): Promise<LibraryMfbData | null> => {
      try {
        // Dev uses npm package name, production uses productName
        const appData = app.getPath('appData')
        let raw: string | null = null
        let foundPath = ''
        for (const dir of ['Limina Library', 'limina-library']) {
          const p = join(appData, dir, 'catalogue.json')
          try { raw = await fs.readFile(p, 'utf-8'); foundPath = p; break } catch { /* try next */ }
        }
        if (!raw) { console.log('[library:lookup] catalogue.json not found in', appData); return null }
        console.log('[library:lookup] reading', foundPath)
        const catalogue = JSON.parse(raw!) as { files?: Array<Record<string, unknown>> }
        console.log('[library:lookup] catalogue has', catalogue.files?.length ?? 0, 'files, looking for:', filePath)
        let match = catalogue.files?.find((f) => f['filePath'] === filePath)
        if (!match) {
          const name = basename(filePath)
          const stripExt = (s: string): string => s.replace(/\.[^.]+$/, '')
          const normalize = (s: string): string =>
            s.normalize('NFC').toLowerCase().replace(/['''\u02bc]/g, '').replace(/\s+/g, ' ').trim()
          const nameStem = normalize(stripExt(name))

          // 1. Exact stem match - extension-agnostic, apostrophe-normalized
          match = catalogue.files?.find((f) => {
            const catStem = normalize(stripExt(f['fileName'] as string))
            return catStem === nameStem
          })

          // 2. Prefix match - handles extra suffixes added during WAV export (e.g. "48000 1")
          if (!match) {
            match = catalogue.files?.find((f) => {
              const catStem = normalize(stripExt(f['fileName'] as string))
              return nameStem.startsWith(catStem + ' ') || catStem.startsWith(nameStem + ' ')
            })
          }

          if (match) {
            console.log('[library:lookup] matched by filename:', name)
          } else {
            console.log('[library:lookup] no match for:', name)
            return null
          }
        }
        if (!match['mfbTrackId']) { console.log('[library:lookup] found file but no mfbTrackId'); return null }
        console.log('[library:lookup] matched:', match['trackTitle'], 'id:', match['mfbTrackId'])
        return {
          mfbTrackId: match['mfbTrackId'] as number,
          trackTitle: (match['trackTitle'] as string) || '',
          artist: (match['artist'] as string) || '',
          albumImageUrl: (match['albumImageUrl'] as string | null) ?? null,
          tags: (match['tags'] as string[]) ?? [],
          breathworkPhase: (match['breathworkPhase'] as string | null) ?? null,
        }
      } catch (err) {
        console.log('[library:lookup] error:', err)
        return null
      }
    }
  )

  ipcMain.handle(
    'file:copyFiles',
    async (
      _,
      srcPaths: string[],
      destFolder: string
    ): Promise<Record<string, string>> => {
      const { join: pathJoin } = await import('path')
      const mapping: Record<string, string> = {}
      for (const src of srcPaths) {
        const name = basename(src)
        const dest = pathJoin(destFolder, name)
        try {
          await fs.copyFile(src, dest)
          mapping[src] = dest
        } catch (err) {
          console.error('[copyFiles] failed to copy', src, err)
        }
      }
      return mapping
    }
  )
}

async function parseMeta(filePath: string): Promise<AudioFileMeta | null> {
  try {
    const metadata = await mm.parseFile(filePath)
    let duration = metadata.format.duration ?? 0
    // music-metadata occasionally returns 0/undefined (e.g. float/24-bit WAVs, or
    // a Dropbox placeholder that was dataless at read time). A zero duration makes
    // the clip a zero-width sliver on the timeline, so fall back to an
    // ffmpeg decode-and-count, which reads the true length regardless of header.
    if (!(duration > 0)) {
      duration = await ffmpegDuration(filePath)
    }
    return {
      path: filePath,
      name: basename(filePath),
      duration,
      sampleRate: metadata.format.sampleRate ?? 44100,
      channels: metadata.format.numberOfChannels ?? 2,
    }
  } catch (err) {
    console.error(`[parseMeta] Failed for ${filePath}:`, err)
    // Last resort: try to at least recover the duration so the clip is usable.
    const duration = await ffmpegDuration(filePath).catch(() => 0)
    if (duration > 0) {
      return { path: filePath, name: basename(filePath), duration, sampleRate: 44100, channels: 2 }
    }
    return null
  }
}

// Accurate duration via ffmpeg: decode to 8kHz mono PCM and count bytes. Bypasses
// any container/header quirks that make music-metadata report 0.
function ffmpegDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const bin = (ffmpegPath as string).replace('app.asar', 'app.asar.unpacked')
    if (!bin) { resolve(0); return }
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
}
