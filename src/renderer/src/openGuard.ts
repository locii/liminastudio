import { useUIStore } from './uiStore'
import { useSessionStore } from './mix/store/sessionStore'
import { useLibraryStore } from './library/store/libraryStore'

// The pending "open" action, run once the overwrite is confirmed (Replace, or
// Save-then-open).
let pendingOpen: (() => void) | null = null

/**
 * Run an "Open in Mix/Session" action, but if the target already has content
 * (Mix has clips / Session has queue items), first prompt Save / Replace / Cancel.
 */
export function requestOpen(target: 'mix' | 'session', open: () => void): void {
  const hasContent = target === 'mix'
    ? useSessionStore.getState().clips.length > 0
    : useLibraryStore.getState().mixQueue.length > 0
  if (hasContent) {
    pendingOpen = open
    useUIStore.getState().setOverwritePrompt(target)
  } else {
    open()
  }
}

/** Replace: proceed with the pending open, discarding current content. */
export function replaceAndOpen(): void {
  const open = pendingOpen
  pendingOpen = null
  useUIStore.getState().setOverwritePrompt(null)
  open?.()
}

/** Save the current mix/session, then proceed with the pending open. */
export async function saveThenOpen(): Promise<void> {
  const target = useUIStore.getState().overwritePrompt
  try {
    if (target === 'mix') {
      const { tracks, clips, segments, sessionLabel, trackHeights, laneHeights } = useSessionStore.getState()
      await window.electronAPI.saveSession(
        JSON.stringify({ tracks, clips, segments, sessionLabel, trackHeights, laneHeights }, null, 2),
        sessionLabel || undefined,
      )
    } else if (target === 'session') {
      useLibraryStore.getState().saveMix(`Session — ${new Date().toLocaleString()}`)
    }
  } catch (e) {
    console.error('[openGuard] save failed', e)
  }
  replaceAndOpen()
}

export function cancelOpen(): void {
  pendingOpen = null
  useUIStore.getState().setOverwritePrompt(null)
}
