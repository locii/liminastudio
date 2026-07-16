import { useLibraryStore } from '../store/libraryStore'
import type { LibraryFile } from '../types'

let running = false
let cancelRequested = false

/** Request the running feature scan stop after the current file. No-op if idle. */
export function cancelFeatureScan(): void {
  if (running) cancelRequested = true
}

// Reccobeats is a free public API — keep a generous gap between uploads so a
// large library doesn't hammer it (or saturate the user's uplink).
const REQUEST_GAP_MS = 1500

/** Files currently being analysed on-demand — drives per-row "analysing…" state. */
export const analyzingFeatureIds = new Set<string>()
const analyzingListeners = new Set<() => void>()
export function subscribeAnalyzing(fn: () => void): () => void {
  analyzingListeners.add(fn)
  return () => analyzingListeners.delete(fn)
}
const notifyAnalyzing = (): void => { analyzingListeners.forEach((fn) => fn()) }

/**
 * Force analysis of a single file now (e.g. from the row context menu), even if
 * a background scan is running and even if the file was already analysed.
 * Skips files that already carry real (non-estimated) MFB features.
 */
export async function analyzeFileFeatures(fileId: string): Promise<void> {
  const store = useLibraryStore.getState()
  const file = store.files.find((f) => f.id === fileId)
  if (!file || !file.filePath) return
  if (file.audioFeatures && !file.audioFeaturesEstimated) return
  if (analyzingFeatureIds.has(fileId)) return

  analyzingFeatureIds.add(fileId)
  notifyAnalyzing()
  try {
    const { features, retriable } = await window.electronAPI.analyzeFeatures(file.filePath, file.duration)
    const cur = useLibraryStore.getState().files.find((f) => f.id === fileId)
    if (cur && !(cur.audioFeatures && !cur.audioFeaturesEstimated)) {
      if (features) {
        store.updateFile(fileId, { audioFeatures: features, audioFeaturesEstimated: true, featuresAnalyzed: true })
      } else if (!retriable) {
        // Genuine no-data (unreadable file / no analysis). Mark done so we stop trying.
        store.updateFile(fileId, { featuresAnalyzed: true })
      }
      // retriable failure: leave un-analysed so a later pass retries it.
    }
  } catch {
    // Treat an IPC-level error as transient; don't mark done.
  } finally {
    analyzingFeatureIds.delete(fileId)
    notifyAnalyzing()
  }
}

/**
 * Background audio-feature scan for tracks that aren't in the MFB catalogue.
 *
 * Walks the library one file at a time, sampling three 30s windows per track
 * (audio:analyzeFeatures) and storing the derived features flagged
 * `audioFeaturesEstimated`, so non-catalogue tracks join the Session Mode Feel
 * EQ on the same scale as matched tracks.
 *
 * - Serial + throttled (~1.5s gap) — akin to indexing. Backs off (4×) after a
 *   transient/rate-limit failure so the API can recover.
 * - Only touches files with no audioFeatures that haven't been tried
 *   (`featuresAnalyzed`); a later MFB match overwrites estimated features.
 * - `force` re-analyses everything without real MFB features and overwrites.
 * - Marks `featuresAnalyzed` only on success or genuine no-data; transient
 *   failures are left un-analysed so a later pass retries them.
 * - Idempotent: a second call while running is a no-op.
 */
export async function runFeatureScan(opts: { force?: boolean } = {}): Promise<void> {
  if (running) return
  running = true
  cancelRequested = false
  const { force = false } = opts
  const setFeatureScan = useLibraryStore.getState().setFeatureScan
  const update = useLibraryStore.getState().updateFile
  try {
    const needs = (f: LibraryFile): boolean =>
      !!f.filePath &&
      // never touch files with real MFB features
      !(f.audioFeatures && !f.audioFeaturesEstimated) &&
      (force || (!f.audioFeatures && !f.featuresAnalyzed))

    const todo = useLibraryStore.getState().files.filter(needs).map((f) => f.id)
    const total = todo.length
    if (total === 0) return
    setFeatureScan({ running: true, done: 0, total })

    let done = 0, ok = 0, noData = 0, deferred = 0
    for (const id of todo) {
      if (cancelRequested) { console.log('[features] scan cancelled'); break }
      const file = useLibraryStore.getState().files.find((f) => f.id === id)
      if (file && needs(file)) {
        let gap = REQUEST_GAP_MS
        try {
          const { features, retriable } = await window.electronAPI.analyzeFeatures(file.filePath, file.duration)
          const cur = useLibraryStore.getState().files.find((f) => f.id === id)
          // Skip write if a real MFB match landed while we were analysing.
          if (cur && !(cur.audioFeatures && !cur.audioFeaturesEstimated)) {
            if (features) {
              update(id, { audioFeatures: features, audioFeaturesEstimated: true, featuresAnalyzed: true })
              ok++
            } else if (!retriable) {
              update(id, { featuresAnalyzed: true })
              noData++
            } else {
              // Rate-limited / transient: leave un-analysed and back off so the API recovers.
              deferred++
              gap = REQUEST_GAP_MS * 4
            }
          }
        } catch {
          deferred++
          gap = REQUEST_GAP_MS * 4
        }
        await new Promise((r) => setTimeout(r, gap))
      }
      done++
      setFeatureScan({ running: true, done, total })
    }
    console.log(`[features] scan done — ${ok} estimated, ${noData} no-data, ${deferred} deferred (will retry)`)
  } finally {
    running = false
    setFeatureScan({ running: false, done: 0, total: 0 })
  }
}
