import { useLibraryStore } from '../store/libraryStore'
import type { MixSession, SessionPlayedTrack, SessionEdit, MixQueueItem } from '../store/libraryStore'

/**
 * Records a live Generate session: the realized tracklist (what actually played,
 * captured from engine state changes) plus the meaningful plan edits (captured by
 * diffing the queue). Deliberately ignores playback *consumption* (front-track
 * dequeues) and upcoming-list churn so the edit log stays about user intent.
 *
 * The in-progress log lives here (it changes constantly); only a small status
 * object is mirrored into the store (`recording`) so the UI can show the badge.
 */
interface ActiveSession {
  startedAt: number
  skeleton: MixSession['skeleton']
  seenIds: Set<string>   // queue-item ids already folded into the skeleton
  played: SessionPlayedTrack[]
  edits: SessionEdit[]
}

let active: ActiveSession | null = null
let unsub: (() => void) | null = null

export function isRecording(): boolean {
  return active != null
}

function describeGroup(it: Extract<MixQueueItem, { kind: 'tags' }>): string {
  const tags = it.tags.length ? it.tags.join(it.matchMode === 'all' ? ' + ' : ', ') : 'all tracks'
  return it.durationMin != null ? `${tags} (${it.durationMin}m)` : tags
}
function trackTitle(fileId: string): string {
  const f = useLibraryStore.getState().files.find((x) => x.id === fileId)
  return f ? (f.trackTitle || f.fileName) : 'track'
}

function openTrack(fileId: string, title: string, artist: string, fromTags: string[] | null, startMs: number, fadeInMs: number): void {
  if (!active) return
  active.played.push({
    atMs: Date.now() - active.startedAt,
    fileId, title, artist: artist || '', fromTags: fromTags ?? null,
    startMs: Math.max(0, Math.round(startMs)), fadeInMs: Math.max(0, Math.round(fadeInMs)),
    playedMs: 0, ended: null,
  })
  useLibraryStore.getState().setRecording({ startedAt: active.startedAt, trackCount: active.played.length })
}
function closeLastTrack(ended: SessionPlayedTrack['ended']): void {
  if (!active || active.played.length === 0) return
  const last = active.played[active.played.length - 1]
  if (last.ended == null) {
    last.playedMs = Date.now() - active.startedAt - last.atMs
    last.ended = ended
  }
}

// Log the user's plan edits by diffing queue snapshots — generators (add / remove /
// duration / match / tags) and newly-queued tracks. Track *removals* are skipped
// because they're almost always playback consumption, not user deletes.
function diffQueue(prev: MixQueueItem[], next: MixQueueItem[]): void {
  if (!active) return
  const atMs = Date.now() - active.startedAt
  const push = (summary: string): void => { active!.edits.push({ atMs, summary }) }
  const prevIds = new Set(prev.map((i) => i.id))
  const nextById = new Map(next.map((i) => [i.id, i]))
  const prevById = new Map(prev.map((i) => [i.id, i]))

  for (const it of next) {
    if (prevIds.has(it.id)) continue
    push(it.kind === 'tags' ? `Added section: ${describeGroup(it)}` : `Queued track: ${trackTitle(it.fileId)}`)
  }
  for (const it of prev) {
    if (nextById.has(it.id) || it.kind !== 'tags') continue // skip track consumption
    push(`Ended section: ${describeGroup(it)}`)
  }
  for (const it of next) {
    const p = prevById.get(it.id)
    if (!p || p.kind !== 'tags' || it.kind !== 'tags') continue
    if (p.durationMin !== it.durationMin) push(`${describeGroup(it)}: duration → ${it.durationMin == null ? '∞' : `${it.durationMin}m`}`)
    if (p.matchMode !== it.matchMode) push(`${describeGroup(it)}: match → ${it.matchMode.toUpperCase()}`)
    if (p.tags.join(',') !== it.tags.join(',')) push(`Section tags → ${it.tags.join(', ') || 'all tracks'}`)
  }
}

export function startRecording(): void {
  if (active) return
  const s = useLibraryStore.getState()
  active = {
    startedAt: Date.now(),
    skeleton: {
      queue: [...s.mixQueue], mixTags: s.mixTags, mixMatchMode: s.mixMatchMode,
      mixFeatureTargets: s.mixFeatureTargets, mixFadeMs: s.mixFadeMs, mixTailTags: s.mixTailTags,
    },
    seenIds: new Set(s.mixQueue.map((it) => it.id)),
    played: [],
    edits: [],
  }
  s.setRecording({ startedAt: active.startedAt, trackCount: 0 })
  // Seed with whatever's already playing (already mid-track — no fade-in captured).
  const cur = s.mixPlayback.current
  if (cur) openTrack(cur.id, cur.trackTitle || cur.fileName, cur.artist, s.mixTailTags, 0, 0)

  unsub = useLibraryStore.subscribe((state, prev) => {
    if (!active) return
    const curId = state.mixPlayback.current?.id ?? null
    const prevId = prev.mixPlayback.current?.id ?? null
    if (curId !== prevId && curId) {
      const c = state.mixPlayback.current!
      const fading = state.mixPlayback.fading
      closeLastTrack(fading ? 'crossfade' : 'skip')
      // At the transition tick the incoming track's crossfade length is live in
      // fadeDurationMs, and currentTime ≈ its file start offset.
      openTrack(
        c.id, c.trackTitle || c.fileName, c.artist, state.mixTailTags,
        state.mixPlayback.currentTime * 1000,
        fading ? state.mixPlayback.fadeDurationMs : 0,
      )
    }
    if (state.mixQueue !== prev.mixQueue) {
      diffQueue(prev.mixQueue, state.mixQueue)
      // Grow the skeleton with any newly-added sections/tracks (never drop on
      // consumption) so the frame reflects everything the user set up, whenever.
      for (const it of state.mixQueue) {
        if (active.seenIds.has(it.id)) continue
        active.seenIds.add(it.id)
        active.skeleton.queue.push(it.kind === 'tags' ? { ...it, upcoming: [] } : it)
      }
    }
  })
}

/** Finish and persist the session. Returns the saved session, or null if empty. */
export function stopRecording(name: string): MixSession | null {
  if (!active) return null
  const a = active
  active = null
  if (unsub) { unsub(); unsub = null }
  closeLastTrackFor(a, 'end')
  const store = useLibraryStore.getState()
  store.setRecording(null)
  if (a.played.length === 0 && a.edits.length === 0) return null
  const session: MixSession = {
    id: `sess_${Date.now().toString(36)}`,
    name: name.trim() || new Date(a.startedAt).toLocaleString(),
    startedAt: new Date(a.startedAt).toISOString(),
    durationMs: Date.now() - a.startedAt,
    skeleton: a.skeleton,
    played: a.played,
    edits: a.edits,
  }
  store.addMixSession(session)
  return session
}

export function cancelRecording(): void {
  if (!active) return
  active = null
  if (unsub) { unsub(); unsub = null }
  useLibraryStore.getState().setRecording(null)
}

// Close a track on a specific (already-detached) session — used by stop.
function closeLastTrackFor(a: ActiveSession, ended: SessionPlayedTrack['ended']): void {
  if (a.played.length === 0) return
  const last = a.played[a.played.length - 1]
  if (last.ended == null) { last.playedMs = Date.now() - a.startedAt - last.atMs; last.ended = ended }
}
