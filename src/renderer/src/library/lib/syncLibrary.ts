import { useLibraryStore } from '../store/libraryStore'

export async function syncLibraryToMfb(): Promise<void> {
  const { files } = useLibraryStore.getState()

  // Guard: don't sync until the catalogue is loaded — an empty file list
  // would wipe all server-side library records.
  if (files.length === 0) return

  const trackIds = files
    .filter((f) => f.mfbApplied && f.mfbTrackId !== null)
    .map((f) => f.mfbTrackId as number)

  try {
    await window.electronAPI.syncLibrary(trackIds)
    console.log(`[syncLibrary] synced ${trackIds.length} tracks`)
  } catch (err) {
    console.warn('[syncLibrary] failed:', err)
  }
}
