import { useEffect, useRef } from 'react'
import { useLibraryStore } from './store/libraryStore'

/** Skip re-walking a folder that was scanned within this window (guards against
 *  rapid focus/blur cycles). The initial post-load rescan bypasses it. */
const RESCAN_THROTTLE_MS = 30_000

/**
 * Keeps the library in step with the filesystem without a live watcher: rescans
 * watched folders once the catalogue is ready and whenever the app window
 * regains focus — covering files added while Limina was closed or in the
 * background. Each folder is throttled by its `lastScanned`, and the rescan is a
 * cheap diff (only genuinely new files get their metadata parsed). `addFiles`
 * merges non-destructively, so nothing the user or MFB curated is touched. See
 * the diffFolder handler in scanHandlers.ts.
 *
 * Note: files that vanished from disk are logged but not yet surfaced — marking
 * them "missing" needs a schema field + UI and is a separate follow-up.
 */
export function useLibraryAutoRescan(): void {
  const runningRef = useRef(false)

  useEffect(() => {
    async function rescanAll(force: boolean): Promise<void> {
      if (runningRef.current) return
      const store = useLibraryStore.getState()
      if (!store.catalogueLoaded || store.watchedFolders.length === 0) return
      runningRef.current = true
      try {
        const now = Date.now()
        for (const folder of useLibraryStore.getState().watchedFolders) {
          const last = folder.lastScanned ? Date.parse(folder.lastScanned) : 0
          if (!force && now - last < RESCAN_THROTTLE_MS) continue
          const knownPaths = useLibraryStore.getState().files.map((f) => f.filePath)
          const { files, missing, errors } = await window.electronAPI.diffFolder(folder.path, knownPaths)
          if (errors.length > 0) console.warn('[rescan] errors', errors)
          if (missing.length > 0) console.info('[rescan] files missing on disk', missing)
          if (files.length > 0) useLibraryStore.getState().addFiles(files)
          // Refresh lastScanned (+ fileCount) via the upserting addWatchedFolder.
          useLibraryStore.getState().addWatchedFolder({
            ...folder,
            fileCount: folder.fileCount + files.length,
            lastScanned: new Date().toISOString(),
          })
        }
      } finally {
        runningRef.current = false
      }
    }

    // Rescan once the catalogue finishes loading, then on every window focus.
    const unsub = useLibraryStore.subscribe((s, prev) => {
      if (s.catalogueLoaded && !prev.catalogueLoaded) void rescanAll(true)
    })
    if (useLibraryStore.getState().catalogueLoaded) void rescanAll(true)
    const onFocus = (): void => void rescanAll(false)
    window.addEventListener('focus', onFocus)
    return () => {
      unsub()
      window.removeEventListener('focus', onFocus)
    }
  }, [])
}
