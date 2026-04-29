import { ipcMain, dialog } from 'electron'
import { promises as fs } from 'fs'
import { join, dirname, basename, extname } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'

const execFileAsync = promisify(execFile)

const RECENT_FILE = join(app.getPath('userData'), 'recent-sessions.json')
const AUTOSAVE_FILE = join(app.getPath('userData'), 'autosave.limina')
const MAX_RECENT = 5

async function getRecent(): Promise<string[]> {
  try {
    const data = await fs.readFile(RECENT_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return []
  }
}

async function addRecent(filePath: string): Promise<void> {
  const current = await getRecent()
  const updated = [filePath, ...current.filter((p) => p !== filePath)].slice(0, MAX_RECENT)
  await fs.writeFile(RECENT_FILE, JSON.stringify(updated), 'utf-8')
}

export function registerSessionHandlers(): void {
  ipcMain.handle('session:save', async (_, sessionJson: string): Promise<string | null> => {
    const result = await dialog.showSaveDialog({
      title: 'Save Session',
      defaultPath: 'session.limina',
      filters: [{ name: 'Limina Session', extensions: ['limina'] }],
    })
    if (result.canceled || !result.filePath) return null
    await fs.writeFile(result.filePath, sessionJson, 'utf-8')
    await addRecent(result.filePath)
    return result.filePath
  })

  ipcMain.handle('session:saveAs', async (_, sessionJson: string, filePath: string): Promise<void> => {
    await fs.writeFile(filePath, sessionJson, 'utf-8')
    await addRecent(filePath)
  })

  ipcMain.handle('session:load', async (): Promise<{ json: string; filePath: string } | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Open Session',
      filters: [{ name: 'Limina Session', extensions: ['limina'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const json = await fs.readFile(filePath, 'utf-8')
    await addRecent(filePath)
    return { json, filePath }
  })

  ipcMain.handle('session:getRecent', async (): Promise<string[]> => getRecent())

  ipcMain.handle(
    'session:openRecent',
    async (_, filePath: string): Promise<{ json: string; filePath: string } | null> => {
      try {
        const json = await fs.readFile(filePath, 'utf-8')
        await addRecent(filePath)
        return { json, filePath }
      } catch {
        return null // file missing
      }
    }
  )

  ipcMain.handle('session:autosave', async (_, sessionJson: string, sessionFilePath?: string): Promise<void> => {
    // Always write to userData (startup recovery)
    await fs.writeFile(AUTOSAVE_FILE, sessionJson, 'utf-8')
    // Also write next to the project file when one is open
    if (sessionFilePath) {
      const projectAutosave = join(dirname(sessionFilePath), '.autosave.limina')
      await fs.writeFile(projectAutosave, sessionJson, 'utf-8').catch(() => {})
    }
  })

  ipcMain.handle('session:checkAutosave', async (): Promise<{ json: string; savedAt: string } | null> => {
    try {
      const json = await fs.readFile(AUTOSAVE_FILE, 'utf-8')
      const stat = await fs.stat(AUTOSAVE_FILE)
      return { json, savedAt: stat.mtime.toISOString() }
    } catch {
      return null
    }
  })

  ipcMain.handle('session:clearAutosave', async (_, sessionFilePath?: string): Promise<void> => {
    try { await fs.unlink(AUTOSAVE_FILE) } catch { /* already gone */ }
    if (sessionFilePath) {
      const projectAutosave = join(dirname(sessionFilePath), '.autosave.limina')
      try { await fs.unlink(projectAutosave) } catch { /* already gone */ }
    }
  })

  ipcMain.handle('window:setTitle', (_, title: string) => {
    const { BrowserWindow } = require('electron')
    BrowserWindow.getFocusedWindow()?.setTitle(title)
  })

  ipcMain.handle(
    'session:collect',
    async (_, sessionJson: string, sessionFilePath: string): Promise<string> => {
      const updatedJson = await collectFiles(sessionJson, sessionFilePath)
      await fs.writeFile(sessionFilePath, updatedJson, 'utf-8')
      return updatedJson
    }
  )

  ipcMain.handle(
    'session:exportZip',
    async (
      _,
      sessionJson: string,
      sessionFilePath: string
    ): Promise<{ zipPath: string; updatedJson: string } | null> => {
      const sessionName = basename(sessionFilePath, '.limina')
      const result = await dialog.showSaveDialog({
        title: 'Export Project as ZIP',
        defaultPath: sessionName + '.zip',
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      })
      if (result.canceled || !result.filePath) return null

      const updatedJson = await collectFiles(sessionJson, sessionFilePath)
      await fs.writeFile(sessionFilePath, updatedJson, 'utf-8')

      const sessionDir = dirname(sessionFilePath)
      const sessionFileName = basename(sessionFilePath)
      // Zip the .limina file + files/ folder from the session directory
      await execFileAsync('zip', ['-r', result.filePath, sessionFileName, 'files'], {
        cwd: sessionDir,
      })

      return { zipPath: result.filePath, updatedJson }
    }
  )
}

// Copy all clip audio files into a files/ subfolder next to the .limina,
// update paths in the JSON, and return the updated JSON string.
async function collectFiles(sessionJson: string, sessionFilePath: string): Promise<string> {
  const sessionDir = dirname(sessionFilePath)
  const filesDir = join(sessionDir, 'files')
  await fs.mkdir(filesDir, { recursive: true })

  const data = JSON.parse(sessionJson) as { clips: Array<{ filePath: string }> }
  const pathMap = new Map<string, string>()

  for (const clip of data.clips) {
    const src = clip.filePath
    if (pathMap.has(src)) continue
    if (dirname(src) === filesDir) { pathMap.set(src, src); continue } // already collected

    const name = basename(src)
    let dest = join(filesDir, name)
    let i = 1
    while (true) {
      try { await fs.access(dest) } catch { break } // no file at dest — use it
      const ext = extname(name)
      dest = join(filesDir, `${basename(name, ext)}_${i++}${ext}`)
    }
    await fs.copyFile(src, dest)
    pathMap.set(src, dest)
  }

  const updated = {
    ...data,
    clips: data.clips.map((c) => ({ ...c, filePath: pathMap.get(c.filePath) ?? c.filePath })),
  }
  return JSON.stringify(updated, null, 2)
}
