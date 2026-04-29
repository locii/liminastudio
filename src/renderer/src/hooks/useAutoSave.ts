import { useEffect } from 'react'
import { useSessionStore } from '../store/sessionStore'

const INTERVAL_MS = 60_000

// Saves the session to a crash-recovery file every 60 s when dirty.
// The file lives in Electron's userData directory and is cleared on
// any successful manual save or session load.
export function useAutoSave(): void {
  useEffect(() => {
    const id = setInterval(() => {
      const { tracks, clips, isDirty, currentFilePath } = useSessionStore.getState()
      if (!isDirty || tracks.length === 0) return
      const json = JSON.stringify({ tracks, clips }, null, 2)
      window.electronAPI.autosaveSession(json, currentFilePath ?? undefined).catch(console.error)
    }, INTERVAL_MS)
    return () => clearInterval(id)
  }, [])
}
