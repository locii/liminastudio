import { useSessionStore } from '../store/sessionStore'
import { useTransportStore } from '../store/transportStore'
import { useToastStore } from '../store/toastStore'
import type { LibraryFile } from '../../library/types'

const TARGET_PEAK_LINEAR = Math.pow(10, -0.5 / 20)
function peaksForClip(duration: number, zoom: number): number {
  return Math.min(Math.ceil(duration * zoom), 50_000)
}

/**
 * Append a Library file to the current Mix session (alternating Track A/B
 * placement), applying its cue points and enriching the clip with waveform
 * peaks, auto-gain and MFB metadata. Shared by the Mix LibraryDock and the
 * Library file-list "Add to Mix" right-click so both behave identically.
 *
 * Falls back to an ffmpeg-accurate duration when the Library entry's duration
 * is 0 (a file that was dataless/unreadable when scanned) so the clip never
 * lands as a zero-length sliver.
 */
export async function addLibraryFileToMix(f: LibraryFile, opts?: { silent?: boolean }): Promise<void> {
  const zoom = useTransportStore.getState().zoom
  const name = (f.trackTitle || f.fileName).replace(/\.[^.]+$/, '')

  let duration = f.duration
  if (!(duration > 0)) {
    duration = await window.electronAPI.getFileDuration(f.filePath).catch(() => 0)
  }

  const hasCues = f.clipStartMs != null || f.clipEndMs != null || f.introEndMs != null || f.outroStartMs != null
  const clipStartSec = (f.clipStartMs ?? 0) / 1000
  const clipEndSec = f.clipEndMs != null ? f.clipEndMs / 1000 : duration
  const fadeIn = hasCues && f.introEndMs != null ? Math.max(0, f.introEndMs / 1000 - clipStartSec) : 0

  const { clip } = useSessionStore.getState().addToABTracks({ name, filePath: f.filePath, duration, fadeIn })

  if (hasCues) {
    useSessionStore.getState().updateClipSilent(clip.id, {
      trimStart: clipStartSec,
      trimEnd: Math.max(0, duration - clipEndSec),
      fadeIn,
      fadeOut: f.outroStartMs != null ? Math.max(0, clipEndSec - f.outroStartMs / 1000) : 0,
      fadeInCurve: f.fadeInCurve,
      fadeOutCurve: f.fadeOutCurve,
    })
  }

  window.electronAPI
    .getWaveformPeaks(f.filePath, peaksForClip(duration, zoom))
    .then((peaks) => useSessionStore.getState().setWaveform(f.filePath, { peaks, loading: false }))
    .catch(() => useSessionStore.getState().setWaveform(f.filePath, { peaks: [], loading: false }))
  window.electronAPI
    .getPeakLevel(f.filePath)
    .then((peak) => { if (peak > 0) useSessionStore.getState().updateClip(clip.id, { volume: Math.min(2, TARGET_PEAK_LINEAR / peak) }) })
    .catch(() => {})
  window.electronAPI
    .lookupLibraryFile(f.filePath)
    .then((data) => {
      if (data) useSessionStore.getState().updateClip(clip.id, {
        mfbTrackId: data.mfbTrackId,
        mfbTrackTitle: data.trackTitle || undefined,
        mfbArtist: data.artist || undefined,
        mfbAlbumImageUrl: data.albumImageUrl ?? undefined,
        mfbTags: data.tags,
        mfbBreathworkPhase: data.breathworkPhase,
      })
    })
    .catch(() => {})

  if (!opts?.silent) {
    useToastStore.getState().add(`Added “${f.trackTitle || f.fileName}” to Mix`, 'success', 2000)
  }
}
