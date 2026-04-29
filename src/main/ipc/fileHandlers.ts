import { ipcMain, dialog, shell } from 'electron'
import { promises as fs } from 'fs'
import { basename } from 'path'
import * as mm from 'music-metadata'

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
