import { useLibraryStore } from '../store/libraryStore'
import { useUIStore } from '../../uiStore'

/**
 * Pick (or accept an already-resolved / dropped) folder, scan it, and load its
 * files into the library store. This is the single home for the scan flow —
 * shared by the Home onboarding drop zone and the Library's add-folder actions
 * so the logic never drifts between the two.
 *
 * @param folderPath  A known folder path (a dropped folder, or one already picked
 *                    by the caller). When omitted, the native folder picker opens.
 * @returns true if a folder was scanned and added, false if cancelled or failed.
 */
export async function addFolder(folderPath?: string): Promise<boolean> {
  const path = typeof folderPath === 'string' ? folderPath : await window.electronAPI.libraryPickFolder()
  if (!path) return false

  const store = useLibraryStore.getState()
  // Keep the "Setting up your library" screen up through scan + indexing so the
  // user can apply matches there; it's dismissed when they open the library.
  useUIStore.getState().setLibrarySetupOpen(true)
  store.setScanning(true)
  try {
    const [folder, result] = await Promise.all([
      window.electronAPI.buildWatchedFolder(path),
      window.electronAPI.scanFolder(path),
    ])
    store.addWatchedFolder(folder)
    store.addFiles(result.files)
    store.selectFolder(null)
    if (result.errors.length > 0) console.warn('[scan] errors', result.errors)
    // A real folder now exists — clear dev-skip-load so restarts load normally.
    useUIStore.getState().setDevSkipLoad(false)
    return true
  } catch (err) {
    console.error('[scan] failed to add folder', path, err)
    useUIStore.getState().setLibrarySetupOpen(false)
    return false
  } finally {
    store.setScanning(false)
  }
}
