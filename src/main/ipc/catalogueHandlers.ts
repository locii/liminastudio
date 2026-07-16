import { ipcMain, app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { Catalogue } from '../../shared/types'

const BACKUP_COUNT = 5

function cataloguePath(): string {
  return join(app.getPath('userData'), 'catalogue.json')
}

function backupPath(n: number): string {
  return join(app.getPath('userData'), `catalogue.${n}.json`)
}

async function rotateBackups(current: string): Promise<void> {
  // Use readFile+writeFile (not copyFile) so each slot gets a fresh mtime
  // Shift older backups down: 4→5, 3→4, 2→3, 1→2
  for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
    try {
      const data = await fs.readFile(backupPath(i))
      await fs.writeFile(backupPath(i + 1), data)
    } catch {
      // older slot may not exist yet — that's fine
    }
  }
  // current → 1
  try {
    const data = await fs.readFile(current)
    await fs.writeFile(backupPath(1), data)
  } catch {
    // current may not exist on first run
  }
}

function hasContent(catalogue: Catalogue): boolean {
  return (catalogue.watchedFolders?.length ?? 0) > 0 || (catalogue.files?.length ?? 0) > 0
}

export function registerCatalogueHandlers(): void {
  ipcMain.handle('catalogue:load', async (): Promise<{ data: Catalogue | null; restoredFromBackup: boolean }> => {
    const path = cataloguePath()

    // Try current catalogue first
    try {
      const json = await fs.readFile(path, 'utf-8')
      const catalogue = JSON.parse(json) as Catalogue
      if (hasContent(catalogue)) {
        rotateBackups(path).catch(() => {})
        return { data: catalogue, restoredFromBackup: false }
      }
      // File exists but is empty — fall through to backups
    } catch {
      // File missing or corrupt — fall through to backups
    }

    // Auto-restore from the most recent valid backup
    for (let i = 1; i <= BACKUP_COUNT; i++) {
      try {
        const json = await fs.readFile(backupPath(i), 'utf-8')
        const catalogue = JSON.parse(json) as Catalogue
        if (hasContent(catalogue)) {
          // Write back as current so the next load is fast
          fs.writeFile(path, json, 'utf-8').catch(() => {})
          return { data: catalogue, restoredFromBackup: true }
        }
      } catch { /* slot missing or corrupt */ }
    }

    return { data: null, restoredFromBackup: false }
  })

  ipcMain.handle('catalogue:save', async (_, catalogue: Catalogue): Promise<void> => {
    const path = cataloguePath()
    const tmp = `${path}.${Date.now()}.tmp`
    await fs.mkdir(join(path, '..'), { recursive: true })
    // Atomic write: unique tmp name per call prevents concurrent saves from colliding
    await fs.writeFile(tmp, JSON.stringify(catalogue, null, 2), 'utf-8')
    await fs.rename(tmp, path)
  })

  ipcMain.handle('catalogue:listBackups', async (): Promise<{ slot: number; mtime: string; size: number }[]> => {
    const results: { slot: number; mtime: string; size: number }[] = []
    for (let i = 1; i <= BACKUP_COUNT; i++) {
      try {
        const stat = await fs.stat(backupPath(i))
        results.push({ slot: i, mtime: stat.mtime.toISOString(), size: stat.size })
      } catch { /* slot missing */ }
    }
    return results
  })

  ipcMain.handle('catalogue:restoreBackup', async (_, slot: number): Promise<Catalogue | null> => {
    try {
      const json = await fs.readFile(backupPath(slot), 'utf-8')
      return JSON.parse(json) as Catalogue
    } catch {
      return null
    }
  })
}
