import { useLibraryStore } from '../store/libraryStore'
import type { MfbRefreshItem } from '../store/libraryStore'
import type { LibraryFile, MfbAudioFeatures } from '../types'
import { mfbTagNames, reconcileTags, hourPhase, hasRealFeatures, type TagGroups } from './mfbTags'

interface TrackDetail {
  id: number
  tags?: TagGroups
  audio_features?: MfbAudioFeatures
  album?: { image_url?: string | null } | null
}

let running = false
let cancelRequested = false

/** Request the running MFB resync stop after the current track. No-op if idle. */
export function cancelMfbRefresh(): void {
  if (running) cancelRequested = true
}

// Matched tracks rarely change, so keep a gentle gap between fetches — this is a
// background housekeeping pass, not something the user is waiting on. Mirrors the
// throttling the indexer/feature-scan use to stay under the MFB rate limit.
const REQUEST_GAP_MS = 1000

/**
 * Silent, non-destructive resync of already-matched tracks against the live MFB
 * catalogue. For every file with an `mfbTrackId` it re-fetches the track detail
 * (`mfb:getTrack`, which carries fresh audio_features + tags) and applies:
 *   - audio_features (only when real, not mid-enrichment nulls)
 *   - system tags — added/removed to match the catalogue, while user-added tags
 *     are preserved (see reconcileTags)
 *   - breathwork phase + album art
 * The MFB match itself, notes, and buy links are left untouched.
 *
 * Publishes a per-track log to `mfbRefresh` (drives the "Syncing" pill + its log
 * modal). Runs as a background job (like reindexing) once per session.
 * Idempotent: a second call while running is a no-op; bails on logout mid-pass.
 *
 * Incremental by default: after the first full pass, only tracks whose MFB
 * `updated_at` has changed since we last synced them are re-fetched (the
 * lightweight catalogue carries `updated_at`). Pass `{ force: true }` to re-fetch
 * every matched track regardless (the "Rescan Audio Features" action).
 */
export async function runMfbRefresh(opts: { force?: boolean } = {}): Promise<void> {
  if (running) return
  if (!useLibraryStore.getState().userAccount) return
  running = true
  cancelRequested = false
  const { force = false } = opts
  const update = useLibraryStore.getState().updateFile
  const setProgress = useLibraryStore.getState().setMfbRefresh
  // Hoisted so the finally block can leave the final statuses on screen.
  let items: MfbRefreshItem[] = []
  try {
    // Change-map { trackId: updated_at } from the (cached) catalogue — used both
    // to decide what changed and to stamp mfbSyncedAt. If it fails we fall back to
    // a full pass rather than skipping the sync entirely.
    let updatedMap: Record<number, string> = {}
    try { updatedMap = await window.electronAPI.mfbGetUpdatedMap() } catch { updatedMap = {} }
    const hasMap = !force && Object.keys(updatedMap).length > 0

    const todo = useLibraryStore.getState().files
      .filter((f) => f.mfbApplied && f.mfbTrackId != null)
      // Incremental: keep a track only if never synced, or its upstream
      // updated_at differs from what we last applied. Force keeps everything.
      .filter((f) => {
        if (force || !hasMap) return true
        const upstream = updatedMap[f.mfbTrackId as number]
        return !upstream || !f.mfbSyncedAt || upstream !== f.mfbSyncedAt
      })
      .map((f) => ({ id: f.id, trackId: f.mfbTrackId as number, fileName: f.fileName, title: f.trackTitle || f.fileName, upstream: updatedMap[f.mfbTrackId as number] }))
    const total = todo.length
    if (total === 0) return

    // Snapshot the working set up front so the log can show the full queue.
    items = todo.map((t) => ({ fileId: t.id, fileName: t.fileName, title: t.title, status: 'queued' }))
    const publish = (done: number): void => setProgress({ running: true, done, total, items: [...items] })
    publish(0)

    let synced = 0
    for (let i = 0; i < todo.length; i++) {
      if (cancelRequested) break
      if (!useLibraryStore.getState().userAccount) break // logged out mid-pass
      const { id, trackId, upstream } = todo[i]
      items[i].status = 'syncing'
      publish(i)
      let ok = false
      try {
        const detail = (await window.electronAPI.mfbGetTrack(trackId)) as TrackDetail | null
        const cur = useLibraryStore.getState().files.find((f) => f.id === id)
        if (detail?.id && cur) {
          const { tags, mfbTags } = reconcileTags(cur.tags, cur.mfbTags, mfbTagNames(detail.tags))
          const patch: Partial<LibraryFile> = { tags, mfbTags }
          if (hasRealFeatures(detail.audio_features)) {
            patch.audioFeatures = detail.audio_features
            patch.audioFeaturesEstimated = false
          }
          const phase = hourPhase(detail.tags)
          if (phase) patch.breathworkPhase = phase
          if (detail.album?.image_url) patch.albumImageUrl = detail.album.image_url
          // Stamp the upstream updated_at so the next incremental pass skips this
          // track until it changes again on MFB.
          if (upstream) patch.mfbSyncedAt = upstream
          update(id, patch)
          ok = true
          synced++
        }
      } catch {
        // Transient (network / rate limit) — mark failed; the next session retries.
      }
      items[i].status = ok ? 'synced' : 'failed'
      publish(i + 1)
      await new Promise((r) => setTimeout(r, REQUEST_GAP_MS))
    }
    console.log(`[mfbRefresh] synced ${synced}/${total} matched tracks`)
  } finally {
    running = false
    // Keep the final per-track statuses visible (log stays readable); the pill
    // hides on running=false. Cleared on the next run.
    setProgress({ running: false, done: items.length, total: items.length, items })
  }
}
