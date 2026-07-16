import { MixEngine } from './mixEngine'
import { useLibraryStore } from '../store/libraryStore'
import { makeMixProvider, activeGroupTimerElapsed } from './mixSelection'

// A single persistent Auto-Mix engine for the whole app, so playback survives
// the MixPanel unmounting (i.e. closing the Auto-Mix section). Its live state is
// pushed into the store (`mixPlayback`) so any component — the panel or the
// navbar mini-player — can read it reactively.
let engine: MixEngine | null = null

export function peekMixEngine(): MixEngine | null {
  return engine
}

export function getMixEngine(): MixEngine {
  if (engine) return engine
  const e = new MixEngine()
  engine = e
  e.setQueueProvider(makeMixProvider())
  e.setGroupTimerCheck(activeGroupTimerElapsed)
  // Start at the track's clip-start cue if set, else its Auto-Mix fade-in point.
  e.setStartResolver((f) => f.clipStartMs ?? useLibraryStore.getState().mixFadeIns[f.id] ?? 0)
  e.xfadeMs = useLibraryStore.getState().mixFadeMs
  // Push live engine state to the store, and record each track that starts as
  // "played this session" so generators never pick it again (any entry path:
  // generator advance, dragged/double-clicked, or the first load).
  let lastPlayedId: string | null = null
  e.subscribe((s) => {
    const store = useLibraryStore.getState()
    store.setMixPlayback(s)
    const id = s.current?.id ?? null
    if (id && id !== lastPlayedId) { lastPlayedId = id; store.markPlayed(id) }
  })
  window.electronAPI.getAudioServerPort().then((p) => e.setPort(p))
  return e
}
