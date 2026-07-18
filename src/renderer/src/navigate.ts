import { useUIStore } from './uiStore'
import { useTransportStore } from './mix/store/transportStore'
import { useLibraryStore } from './library/store/libraryStore'
import { audioEngine } from './mix/audio/audioEngine'
import { peekMixEngine } from './library/lib/mixEngineSingleton'

export type NavTarget = 'home' | 'library' | 'playlists' | 'session' | 'mix'

// The full navigation action pending behind the confirm modal (captures any
// enterMixMode/exitMixMode + setSurface transition, not just a surface change).
let pendingAction: (() => void) | null = null

/** Which audio workspace is actively playing right now, or null. The two audio
 *  workspaces are the Mix timeline and Session's Auto-Mix engine. */
function playingAudioSurface(): 'mix' | 'session' | null {
  const surface = useUIStore.getState().surface
  if (surface === 'mix') return useTransportStore.getState().playing ? 'mix' : null
  // Session engine is a persistent singleton — it keeps playing across surface changes
  // (library, playlists, home), so check it regardless of current surface.
  if (useLibraryStore.getState().mixPlayback.playing) return 'session'
  return null
}

/** True when the pending navigation actually needs to interrupt playback.
 *  Playback only conflicts when moving directly between the two audio workspaces
 *  (Session ↔ Mix, two different engines). Every other destination — Library,
 *  Playlists, Home — lets the current audio keep playing; a mini-player keeps it
 *  visible and controllable. */
function crossesAudioBoundary(target: NavTarget | undefined): boolean {
  const from = playingAudioSurface()
  if (!from) return false
  return (from === 'mix' && target === 'session') || (from === 'session' && target === 'mix')
}

/** Stop whatever is currently playing (both engines, best-effort). */
export function stopAllPlayback(): void {
  try { audioEngine.stop() } catch { /* noop */ }
  try { peekMixEngine()?.stop() } catch { /* noop */ }
}

/**
 * Run a navigation action. If it would move directly between the two audio
 * workspaces (Session ↔ Mix) while one is playing, first ask for confirmation
 * (playback will stop). All other navigation runs immediately and leaves
 * playback untouched. Pass `target` so the boundary can be detected.
 */
export function requestNavigate(action: () => void, target?: NavTarget): void {
  if (crossesAudioBoundary(target)) {
    pendingAction = action
    useUIStore.getState().setNavConfirmOpen(true)
  } else {
    action()
  }
}

export function confirmPendingNav(): void {
  stopAllPlayback()
  const action = pendingAction
  pendingAction = null
  useUIStore.getState().setNavConfirmOpen(false)
  action?.()
}

export function cancelPendingNav(): void {
  pendingAction = null
  useUIStore.getState().setNavConfirmOpen(false)
}
