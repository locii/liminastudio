import { ipcMain, app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { Catalogue } from '../../shared/types'

const BACKUP_COUNT = 5
// Written once after a successful legacy migration so we never re-run it.
const MIGRATION_FLAG = 'legacy-migrated.flag'

function cataloguePath(): string {
  return join(app.getPath('userData'), 'catalogue.json')
}

function backupPath(n: number): string {
  return join(app.getPath('userData'), `catalogue.${n}.json`)
}

function migrationFlagPath(): string {
  return join(app.getPath('userData'), MIGRATION_FLAG)
}

function fileCount(catalogue: Catalogue): number {
  return catalogue.files?.length ?? 0
}

function hasContent(catalogue: Catalogue): boolean {
  return (catalogue.watchedFolders?.length ?? 0) > 0 || fileCount(catalogue) > 0
}

async function rotateBackups(current: string): Promise<void> {
  for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
    try {
      const data = await fs.readFile(backupPath(i))
      await fs.writeFile(backupPath(i + 1), data)
    } catch { /* slot missing */ }
  }
  try {
    const data = await fs.readFile(current)
    await fs.writeFile(backupPath(1), data)
  } catch { /* current missing on first run */ }
}

/** Legacy app dirs that may hold a richer library catalogue. Ordered by priority
 *  (first dir with content wins). Includes prior product names so that renaming
 *  to "Limina Studio" (a new userData dir) still imports an existing library:
 *  the standalone Library app, and the earlier "Limina Mix" builds. */
const LEGACY_APP_DIRS = ['limina-library', 'Limina Library', 'Limina Mix', 'limina-mix']

async function findLegacyCatalogue(): Promise<{ catalogue: Catalogue; path: string } | null> {
  const appData = app.getPath('appData')
  for (const dir of LEGACY_APP_DIRS) {
    try {
      const p = join(appData, dir, 'catalogue.json')
      const json = await fs.readFile(p, 'utf-8')
      const catalogue = JSON.parse(json) as Catalogue
      if (hasContent(catalogue)) return { catalogue, path: p }
    } catch { /* not found or corrupt */ }
  }
  return null
}

async function migrationAlreadyDone(): Promise<boolean> {
  try { await fs.access(migrationFlagPath()); return true } catch { return false }
}

async function writeMigrationFlag(): Promise<void> {
  await fs.writeFile(migrationFlagPath(), new Date().toISOString(), 'utf-8')
}

export function registerCatalogueHandlers(): void {
  ipcMain.handle('catalogue:load', async (): Promise<{ data: Catalogue | null; restoredFromBackup: boolean }> => {
    const path = cataloguePath()

    // Read the current catalogue (may or may not have content).
    let current: Catalogue | null = null
    try {
      const json = await fs.readFile(path, 'utf-8')
      const parsed = JSON.parse(json) as Catalogue
      if (hasContent(parsed)) current = parsed
    } catch { /* missing or corrupt */ }

    // One-time migration: if the legacy Library app has more tracks than the
    // current catalogue, import it. Skipped if the flag file exists (already done).
    if (!(await migrationAlreadyDone())) {
      const legacy = await findLegacyCatalogue()
      if (legacy && fileCount(legacy.catalogue) > fileCount(current ?? {})) {
        console.log(`[catalogue] migrating from ${legacy.path} (${fileCount(legacy.catalogue)} files vs current ${fileCount(current ?? {})} files)`)
        // Back up the current catalogue before overwriting.
        if (current) rotateBackups(path).catch(() => {})
        const legacyJson = JSON.stringify(legacy.catalogue, null, 2)
        await fs.writeFile(path, legacyJson, 'utf-8')
        await writeMigrationFlag()
        return { data: legacy.catalogue, restoredFromBackup: false }
      }
      // No better legacy data found — still mark migration as done so we don't
      // re-check on every launch.
      await writeMigrationFlag()
    }

    // Use the current catalogue if it has content.
    if (current) {
      rotateBackups(path).catch(() => {})
      return { data: current, restoredFromBackup: false }
    }

    // Try numbered backups.
    for (let i = 1; i <= BACKUP_COUNT; i++) {
      try {
        const json = await fs.readFile(backupPath(i), 'utf-8')
        const catalogue = JSON.parse(json) as Catalogue
        if (hasContent(catalogue)) {
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

  // Dev-only: stash all catalogue + auth files so the app boots as a new user.
  // Call devRestoreLibrary to bring them back.
  ipcMain.handle('dev:resetLibrary', async (): Promise<void> => {
    const ud = app.getPath('userData')
    const files = [
      'catalogue.json',
      ...Array.from({ length: BACKUP_COUNT }, (_, i) => `catalogue.${i + 1}.json`),
      'auth.bin',
    ]
    await Promise.allSettled(
      files.map((f) => fs.rename(join(ud, f), join(ud, f + '.devbak')).catch(() => {}))
    )
  })

  ipcMain.handle('dev:restoreLibrary', async (): Promise<void> => {
    const ud = app.getPath('userData')
    const files = [
      'catalogue.json',
      ...Array.from({ length: BACKUP_COUNT }, (_, i) => `catalogue.${i + 1}.json`),
      'auth.bin',
    ]
    await Promise.allSettled(
      files.map((f) => fs.rename(join(ud, f + '.devbak'), join(ud, f)).catch(() => {}))
    )
  })
}
