import { useUIStore } from './uiStore'
import { useTransportStore } from './mix/store/transportStore'
import { useLibraryStore } from './library/store/libraryStore'
import { audioEngine } from './mix/audio/audioEngine'
import { peekMixEngine } from './library/lib/mixEngineSingleton'

// The full navigation action pending behind the confirm modal (captures any
// enterMixMode/exitMixMode + setSurface transition, not just a surface change).
let pendingAction: (() => void) | null = null

/** True when the currently-visible view is actively playing audio (Mix timeline
 *  or the Session/Auto-Mix engine). Preview playback is transient, not guarded. */
function currentlyPlaying(): boolean {
  const surface = useUIStore.getState().surface
  if (surface === 'mix') return useTransportStore.getState().playing
  if (surface === 'library' && useLibraryStore.getState().mixMode) {
    return useLibraryStore.getState().mixPlayback.playing
  }
  return false
}

/** Stop whatever is currently playing (both engines, best-effort). */
export function stopAllPlayback(): void {
  try { audioEngine.stop() } catch { /* noop */ }
  try { peekMixEngine()?.stop() } catch { /* noop */ }
}

/**
 * Run a navigation action, but if the current view is actively playing, first
 * ask for confirmation (playback will stop). Use this everywhere instead of
 * calling setSurface directly for cross-view navigation.
 */
export function requestNavigate(action: () => void): void {
  if (currentlyPlaying()) {
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
