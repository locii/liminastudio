import { useSessionStore } from './mix/store/sessionStore'
import { useTransportStore } from './mix/store/transportStore'
import { useUIStore } from './uiStore'
import { stopAllPlayback } from './navigate'

type SessionSnapshot = Parameters<ReturnType<typeof useSessionStore.getState>['loadSnapshot']>[0]

/**
 * Load a Mix session (a `.limina` snapshot object — tracks + clips, as produced
 * by buildLiminaSession / materialise) into the Mix workspace in-app, fetch its
 * waveforms, and switch to the Mix surface. Used by "Open in Mix" everywhere.
 */
export function openInMix(session: SessionSnapshot | string): void {
  try {
    const data = (typeof session === 'string' ? JSON.parse(session) : session) as SessionSnapshot
    stopAllPlayback() // moving into Mix — stop any session/timeline playback first
    const store = useSessionStore.getState()
    store.loadSnapshot(data)

    // Fetch waveforms for each unique clip (Mix's interleaved peaks).
    const zoom = useTransportStore.getState().zoom
    const clips = (data as { clips?: { filePath: string; duration?: number }[] }).clips ?? []
    const seen = new Set<string>()
    for (const clip of clips) {
      if (!clip.filePath || seen.has(clip.filePath)) continue
      seen.add(clip.filePath)
      store.setWaveform(clip.filePath, { peaks: [], loading: true })
      const numPeaks = Math.min(Math.ceil((clip.duration ?? 300) * zoom), 50_000)
      window.electronAPI
        .getWaveformPeaks(clip.filePath, numPeaks)
        .then((peaks) => useSessionStore.getState().setWaveform(clip.filePath, { peaks, loading: false }))
        .catch(() => useSessionStore.getState().setWaveform(clip.filePath, { peaks: [], loading: false }))
    }

    useUIStore.getState().setSurface('mix')
  } catch (e) {
    console.error('[openInMix] failed', e)
  }
}
