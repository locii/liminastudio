import { useLibraryStore } from '../store/libraryStore'
import type { LibraryFile } from '../types'
import type { NextTrack } from './mixEngine'

/**
 * Feel score for a track against the engaged EQ bands. Each band's slider
 * (−1..1) sets a TARGET level for that audio feature: `target = 0.5 + 0.5·slider`
 * (so +1 → 1.0, −1 → 0.0, +0.4 → 0.7). A track's per-band fit is its closeness
 * to that target (`1 − |value − target|`), so moving a slider changes which
 * tracks match — not just the boost/cut direction. Bands combine as a fuzzy AND
 * (the minimum closeness across bands), so a track scores only as well as its
 * furthest-from-target band: every engaged feature must sit near its target, not
 * just one. (Taking the max, or averaging, would be an OR.)
 */
export function feelScore(f: LibraryFile, targets: [string, number][]): number {
  if (targets.length === 0) return 0
  const af = f.audioFeatures as unknown as Record<string, number> | null
  if (!af) return 0
  let worst = Infinity
  for (const [k, slider] of targets) {
    const target = 0.5 + 0.5 * slider
    const closeness = 1 - Math.abs((af[k] ?? 0.5) - target)
    if (closeness < worst) worst = closeness
  }
  return worst
}

/**
 * Pick a track from `candidates`, steered by the feel-EQ boost/cut weights. With
 * no engaged bands it's a plain random pick; otherwise tracks are ranked by feel
 * score and one is chosen randomly from the top ~40% — steered but varied.
 */
export function pickSteered(
  candidates: LibraryFile[],
  excludeId: string | null,
  weights: [string, number][],
): LibraryFile | null {
  let pool = excludeId ? candidates.filter((f) => f.id !== excludeId) : candidates
  if (pool.length === 0) pool = candidates
  if (pool.length === 0) return null
  if (weights.length === 0) return pool[Math.floor(Math.random() * pool.length)]
  const scored = pool.map((f) => ({ f, s: feelScore(f, weights) })).sort((a, b) => b.s - a.s)
  const topN = Math.max(5, Math.floor(scored.length * 0.4))
  return scored[Math.floor(Math.random() * Math.min(topN, scored.length))].f
}

/** The current "available" pool: the library filtered by the active mix tags. */
export function computePool(): LibraryFile[] {
  const st = useLibraryStore.getState()
  return st.files.filter((f) => {
    if (!f.filePath) return false
    if (st.mixTags.length === 0) return true
    return st.mixMatchMode === 'all'
      ? st.mixTags.every((t) => f.tags.includes(t))
      : st.mixTags.some((t) => f.tags.includes(t))
  })
}

/**
 * Store-driven next-track provider for the engine. Walks the explicit queue
 * (consuming track items, generating from persistent tag-groups) and falls back
 * to the tail group / current pool when the queue is empty. Reads everything
 * from the store so it works without any component mounted.
 */
export function filterByTags(tags: string[], mode: 'any' | 'all'): LibraryFile[] {
  const files = useLibraryStore.getState().files.filter((f) => f.filePath)
  if (tags.length === 0) return files
  return files.filter((f) => (mode === 'all' ? tags.every((t) => f.tags.includes(t)) : tags.some((t) => f.tags.includes(t))))
}

/** Materialise an ordered list of `count` track ids for a tag-group, steered by
 *  its feel and without repeats — so the ghost preview and playback agree. */
export function materializeGroup(
  tags: string[], matchMode: 'any' | 'all', feel: Record<string, number>, count: number, exclude: Set<string>,
): string[] {
  let cands = filterByTags(tags, matchMode).filter((f) => !exclude.has(f.id))
  const weights = Object.entries(feel)
  const out: string[] = []
  while (out.length < count && cands.length > 0) {
    const p = pickSteered(cands, null, weights)
    if (!p) break
    out.push(p.id)
    cands = cands.filter((f) => f.id !== p.id)
  }
  return out
}

// Within this much of a timed generator's end, don't start a fresh song — hand
// over to the next queue item instead. Prevents a short track ending/skipping
// right at the duration boundary, which would double up transitions in that area.
const NEW_SONG_MIN_REMAINING_MS = 60000

// When a tag-group generator became the queue front (for its play-duration timer).
let genStart: { id: string; at: number } | null = null

/** The active tag-group timer, so the UI can show "time left until the next
 *  queue item takes over". Null when no timed group is currently generating. */
export function getGenStart(): { id: string; at: number } | null {
  return genStart
}

/**
 * True when the front queue item is a timed tag-group whose play-duration has
 * elapsed — the engine polls this each frame so it can crossfade to the next
 * queue item the moment the timer runs out, instead of waiting for the current
 * track to reach its outro. Kept in lockstep with the provider's own dequeue
 * check (same genStart + threshold) so both agree the group is done: when the
 * engine advances on this signal, the provider then dequeues the elapsed group.
 */
export function activeGroupTimerElapsed(): boolean {
  const front = useLibraryStore.getState().mixQueue[0]
  if (!front || front.kind !== 'tags' || front.durationMin == null) return false
  if (!genStart || genStart.id !== front.id) return false
  return Date.now() - genStart.at >= front.durationMin * 60000
}

export function makeMixProvider(): (currentId: string | null) => NextTrack | null {
  return (currentId) => {
    for (let guard = 0; guard < 500; guard++) {
      const st = useLibraryStore.getState()
      const q = st.mixQueue
      if (q.length === 0) break
      const front = q[0]
      if (front.kind === 'track') {
        st.dequeueFront()
        const f = st.files.find((x) => x.id === front.fileId)
        // Carry any recorded per-transition overrides (session replay).
        if (f && f.filePath) return { file: f, fadeMs: front.fadeMs, startMs: front.startMs, holdMs: front.holdMs }
        continue
      }
      // Tag-group generator, steered by its OWN captured feel EQ. It's persistent
      // (keeps generating) until its duration timer elapses, then the queue
      // advances to the next item so later tracks/groups get their turn.
      const now = Date.now()
      if (!genStart || genStart.id !== front.id) genStart = { id: front.id, at: now }
      if (front.durationMin != null) {
        const remaining = front.durationMin * 60000 - (now - genStart.at)
        // Duration elapsed → hand over. Also, once we're inside the last minute,
        // don't start a fresh song (it would end/skip right at the boundary and
        // double up transitions) — advance now, but only if there's a next item
        // to take over. The last generator just rides its current track out.
        if (remaining <= 0 || (remaining < NEW_SONG_MIN_REMAINING_MS && q.length > 1)) {
          st.dequeueFront()
          genStart = null
          continue
        }
      }
      st.setMixTailTags(front.tags)
      // Play the head of the materialised list; the ghost shows the same order.
      // Exclude tracks already played this session so nothing repeats.
      const played = st.playedIds
      const exclude = new Set<string>(played)
      if (currentId) exclude.add(currentId)
      let up = front.upcoming.filter((id) => id !== currentId && !played.has(id))
      if (up.length === 0) up = materializeGroup(front.tags, front.matchMode, front.feel, 12, exclude)
      // Whole tag pool exhausted this session → allow repeats rather than stall.
      if (up.length === 0) up = materializeGroup(front.tags, front.matchMode, front.feel, 12, new Set(currentId ? [currentId] : []))
      if (up.length === 0) break
      const nextId = up[0]
      let rest = up.slice(1)
      // Keep a buffer of ~12 so the queue's "next 10" preview always has enough.
      if (rest.length < 10) {
        const have = new Set([nextId, ...rest, ...exclude])
        rest = rest.concat(materializeGroup(front.tags, front.matchMode, front.feel, 12 - rest.length, have))
      }
      st.setQueueItemUpcoming(front.id, rest)
      const f = st.files.find((x) => x.id === nextId)
      if (f && f.filePath) return { file: f }
      continue
    }
    // Empty queue → tail group, else the live pool (steered by the live EQ).
    const st = useLibraryStore.getState()
    const liveTargets = Object.entries(st.mixFeatureTargets)
    const cands = st.mixTailTags ? filterByTags(st.mixTailTags, 'any') : computePool()
    const base = cands.length ? cands : computePool()
    // Skip session-played tracks; if that empties the pool, allow repeats.
    const unplayed = base.filter((f) => !st.playedIds.has(f.id))
    const pool = unplayed.length ? unplayed : base
    const pick = pickSteered(pool, currentId, liveTargets)
    return pick ? { file: pick } : null
  }
}
