import { ipcMain, dialog, shell, clipboard, app } from 'electron'
import { promises as fs } from 'fs'
import { basename, join } from 'path'
import * as mm from 'music-metadata'

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

  ipcMain.handle('file:readAudioFile', async (_, filePath: string): Promise<Buffer> => {
    return fs.readFile(filePath)
  })

  ipcMain.handle(
    'file:getAudioMetadata',
    async (_, filePath: string): Promise<AudioFileMeta | null> => parseMeta(filePath)
  )

  ipcMain.handle('shell:showInFolder', (_e, filePath: string) => shell.showItemInFolder(filePath))
  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))

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
        const match = catalogue.files?.find((f) => f['filePath'] === filePath)
        if (!match) { console.log('[library:lookup] no path match'); return null }
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
    return {
      path: filePath,
      name: basename(filePath),
      duration: metadata.format.duration ?? 0,
      sampleRate: metadata.format.sampleRate ?? 44100,
      channels: metadata.format.numberOfChannels ?? 2,
    }
  } catch (err) {
    console.error(`[parseMeta] Failed for ${filePath}:`, err)
    return null
  }
}
