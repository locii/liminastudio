import { useLibraryStore } from '../store/libraryStore'
import type { LibraryFile } from '../types'

let running = false

/**
 * Cue scan for Auto-Mix. Walks the library one file at a time, running the
 * ffmpeg energy-envelope analysis (audio:analyzeCues) to populate intro/outro
 * cue points so crossfades happen at musical moments.
 *
 * - Serial + throttled (one ffmpeg at a time, small gap) to stay out of the way.
 * - `force` re-analyses every file and overwrites cues; otherwise only unscanned
 *   files are processed and existing (manual/MFB) cues are preserved.
 * - Marks cuesAnalyzed even on failure to avoid retry loops on unreadable files.
 * - Reports progress via the store; idempotent (a second call while running is a no-op).
 */
export async function runCueScan(opts: { force?: boolean } = {}): Promise<void> {
  if (running) return
  running = true
  const { force = false } = opts
  const setCueScan = useLibraryStore.getState().setCueScan
  const update = useLibraryStore.getState().updateFile
  try {
    const todo = useLibraryStore.getState().files
      .filter((f) => f.filePath && (force || !f.cuesAnalyzed))
      .map((f) => f.id)
    const total = todo.length
    if (total === 0) return
    setCueScan({ running: true, done: 0, total })

    let done = 0
    for (const id of todo) {
      const file = useLibraryStore.getState().files.find((f) => f.id === id)
      if (file && file.filePath && (force || !file.cuesAnalyzed)) {
        try {
          const cues = await window.electronAPI.analyzeCues(file.filePath)
          const cur = useLibraryStore.getState().files.find((f) => f.id === id)
          if (cur) {
            const updates: Partial<LibraryFile> = { cuesAnalyzed: true }
            if (force || cur.introEndMs == null) if (cues.introEndMs != null) updates.introEndMs = cues.introEndMs
            if (force || cur.outroStartMs == null) if (cues.outroStartMs != null) updates.outroStartMs = cues.outroStartMs
            update(id, updates)
          }
        } catch {
          update(id, { cuesAnalyzed: true })
        }
        await new Promise((r) => setTimeout(r, force ? 120 : 200))
      }
      done++
      setCueScan({ running: true, done, total })
    }
  } finally {
    running = false
    setCueScan({ running: false, done: 0, total: 0 })
  }
}
