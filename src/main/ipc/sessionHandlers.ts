import { ipcMain, dialog } from 'electron'
import { promises as fs } from 'fs'
import { join, dirname, basename, extname } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'

const execFileAsync = promisify(execFile)

const RECENT_FILE = join(app.getPath('userData'), 'recent-sessions.json')
const AUTOSAVE_FILE = join(app.getPath('userData'), 'autosave.limina')
const MAX_RECENT = 20

const MAX_BACKUPS = 15

/** Folder that holds rolling backups for a given .limina, beside the file. */
function backupsDirFor(filePath: string): string {
  return join(dirname(filePath), `${basename(filePath, extname(filePath))}.backups`)
}

/** Find the session file inside a project folder: prefer <dir>/<dirname>.limina,
 *  otherwise the first .limina in the folder. */
async function resolveLiminaInDir(dir: string): Promise<string | null> {
  const preferred = join(dir, `${basename(dir)}.limina`)
  try { await fs.access(preferred); return preferred } catch { /* fall through */ }
  try {
    const entries = (await fs.readdir(dir)).filter((f) => f.endsWith('.limina')).sort()
    return entries.length > 0 ? join(dir, entries[0]) : null
  } catch {
    return null
  }
}

/** Copy the CURRENT on-disk file into its .backups/ folder (timestamped) before
 *  it gets overwritten, then prune to the newest MAX_BACKUPS. Best-effort. */
async function backupExisting(filePath: string): Promise<void> {
  try {
    await fs.access(filePath)
  } catch {
    return // nothing on disk yet — first save, nothing to preserve
  }
  const dir = backupsDirFor(filePath)
  await fs.mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await fs.copyFile(filePath, join(dir, `${stamp}.limina`)).catch(() => {})
  try {
    const entries = (await fs.readdir(dir)).filter((f) => f.endsWith('.limina')).sort()
    for (let i = 0; i < entries.length - MAX_BACKUPS; i++) {
      await fs.unlink(join(dir, entries[i])).catch(() => {})
    }
  } catch { /* pruning is best-effort */ }
}

/** Crash-proof save: back up the existing file, write + fsync to a temp file in
 *  a sibling .tmp/ dir, then atomically rename over the target. A crash or error
 *  can never leave a half-written or truncated .limina in place. */
async function atomicWriteWithBackup(filePath: string, contents: string): Promise<void> {
  await backupExisting(filePath)
  const tmpDir = join(dirname(filePath), '.tmp')
  await fs.mkdir(tmpDir, { recursive: true })
  const tmpPath = join(
    tmpDir,
    `${basename(filePath)}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  )
  const handle = await fs.open(tmpPath, 'w')
  try {
    await handle.writeFile(contents, 'utf-8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(tmpPath, filePath)
}

export async function getRecent(): Promise<string[]> {
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

export function registerSessionHandlers(rebuildMenu?: () => void): void {
  ipcMain.handle('session:save', async (_, sessionJson: string, defaultName?: string): Promise<string | null> => {
    const safeName = defaultName ? defaultName.replace(/[/\\:*?"<>|]/g, '_') : 'session'
    const result = await dialog.showSaveDialog({
      title: 'Save Session',
      defaultPath: `${safeName}.limina`,
      filters: [{ name: 'Limina Session', extensions: ['limina'] }],
    })
    if (result.canceled || !result.filePath) return null
    await atomicWriteWithBackup(result.filePath, sessionJson)
    await addRecent(result.filePath)
    rebuildMenu?.()
    return result.filePath
  })

  ipcMain.handle('session:saveAs', async (_, sessionJson: string, filePath: string): Promise<void> => {
    await atomicWriteWithBackup(filePath, sessionJson)
    await addRecent(filePath)
    rebuildMenu?.()
  })

  // List the rolling backups for a session, newest first.
  ipcMain.handle(
    'session:listBackups',
    async (_, filePath: string): Promise<Array<{ path: string; savedAt: string; size: number }>> => {
      try {
        const dir = backupsDirFor(filePath)
        const entries = (await fs.readdir(dir)).filter((f) => f.endsWith('.limina'))
        const infos = await Promise.all(
          entries.map(async (f) => {
            const p = join(dir, f)
            const st = await fs.stat(p)
            return { path: p, savedAt: st.mtime.toISOString(), size: st.size }
          })
        )
        return infos.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      } catch {
        return []
      }
    }
  )

  // Open the backups folder in a picker and return the chosen snapshot's JSON,
  // keeping the ORIGINAL file as the save target so reverting + saving writes back.
  ipcMain.handle(
    'session:revertToBackup',
    async (_, currentFilePath: string): Promise<{ json: string; filePath: string } | null> => {
      const result = await dialog.showOpenDialog({
        title: 'Revert to Backup',
        defaultPath: backupsDirFor(currentFilePath),
        filters: [{ name: 'Limina Session Backup', extensions: ['limina'] }],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const json = await fs.readFile(result.filePaths[0], 'utf-8')
      return { json, filePath: currentFilePath }
    }
  )

  // Save as a self-contained PROJECT FOLDER: creates <chosen>/ and writes
  // <chosen>/<name>.limina inside it (atomic + backup). Backups/ and .tmp/ then
  // live inside the folder automatically. Audio stays referenced by absolute path.
  ipcMain.handle('session:saveProject', async (_, sessionJson: string, defaultName?: string): Promise<string | null> => {
    const safe = (defaultName || 'Untitled Mix').replace(/[/\\:*?"<>|]/g, '_')
    const result = await dialog.showSaveDialog({
      title: 'Save as Project',
      defaultPath: safe,
      buttonLabel: 'Create Project',
      properties: ['createDirectory'],
    })
    if (result.canceled || !result.filePath) return null
    const folder = result.filePath.replace(/\.limina$/i, '')
    await fs.mkdir(folder, { recursive: true })
    const liminaPath = join(folder, `${basename(folder)}.limina`)
    await atomicWriteWithBackup(liminaPath, sessionJson)
    await addRecent(liminaPath)
    rebuildMenu?.()
    return liminaPath
  })

  // Open a project FOLDER: locate the .limina inside and load it.
  ipcMain.handle('session:openProject', async (): Promise<{ json: string; filePath: string } | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Open Project Folder',
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const liminaPath = await resolveLiminaInDir(result.filePaths[0])
    if (!liminaPath) return null
    const json = await fs.readFile(liminaPath, 'utf-8')
    await addRecent(liminaPath)
    rebuildMenu?.()
    return { json, filePath: liminaPath }
  })

  // For clips whose original path is gone, look for a collected copy in the
  // project's files/ folder (matched by filename). Returns a path-substitution
  // map plus the still-missing paths.
  ipcMain.handle(
    'session:resolveMissing',
    async (_, liminaPath: string, paths: string[]): Promise<{ resolved: Record<string, string>; missing: string[] }> => {
      const filesDir = join(dirname(liminaPath), 'files')
      const resolved: Record<string, string> = {}
      const missing: string[] = []
      await Promise.all(
        paths.map(async (p) => {
          try { await fs.access(p); return } catch { /* gone from original location */ }
          const candidate = join(filesDir, basename(p))
          try { await fs.access(candidate); resolved[p] = candidate; return } catch { /* not collected */ }
          missing.push(p)
        })
      )
      return { resolved, missing }
    }
  )

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
    rebuildMenu?.()
    return { json, filePath }
  })

  ipcMain.handle('session:getRecent', async (): Promise<string[]> => getRecent())

  ipcMain.handle(
    'session:openRecent',
    async (_, filePath: string): Promise<{ json: string; filePath: string } | null> => {
      try {
        const json = await fs.readFile(filePath, 'utf-8')
        await addRecent(filePath)
        rebuildMenu?.()
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
    let alreadyThere = false
    while (true) {
      try {
        await fs.access(dest)
        // dest exists — if sizes match, assume it's the same file from a prior collect
        const [srcStat, destStat] = await Promise.all([fs.stat(src), fs.stat(dest)])
        if (srcStat.size === destStat.size) { alreadyThere = true; break }
        const ext = extname(name)
        dest = join(filesDir, `${basename(name, ext)}_${i++}${ext}`)
      } catch { break }
    }
    if (!alreadyThere) await fs.copyFile(src, dest)
    pathMap.set(src, dest)
  }

  const updated = {
    ...data,
    clips: data.clips.map((c) => ({ ...c, filePath: pathMap.get(c.filePath) ?? c.filePath })),
  }
  return JSON.stringify(updated, null, 2)
}
