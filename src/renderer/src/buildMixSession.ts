import { nanoid } from './mix/utils/nanoid'
import { pickTrackColor } from './mix/types'
import type { Track, Clip } from './mix/types'
import type { LibraryFile } from './library/types'

const XFADE_S = 3 // gentle overlap between consecutive tracks

/**
 * Build a Mix session (single track, sequential clips with a small crossfade
 * overlap) from an ordered list of library files. Used by "Open in Mix" from
 * Session mode. Crossfades are pre-computed so they're live on load.
 */
export function buildMixSessionFromFiles(files: LibraryFile[]): { tracks: Track[]; clips: Clip[] } {
  const track: Track = {
    id: nanoid(), name: 'Session', color: pickTrackColor(0),
    volume: 1, muted: false, solo: false, order: 0,
  }
  const clips: Clip[] = []
  let start = 0
  for (const f of files) {
    const dur = f.duration || 0
    if (!f.filePath || dur <= 0) continue
    clips.push({
      id: nanoid(), trackId: track.id,
      filePath: f.filePath, fileName: f.fileName,
      startTime: Math.max(0, start), duration: dur, trimStart: 0, trimEnd: 0,
      fadeIn: 0, fadeOut: 0, fadeInCurve: 0.5, fadeOutCurve: 0.5,
      crossfadeIn: 0, crossfadeOut: 0, volume: 1, automation: [],
      mfbTrackId: f.mfbTrackId,
      mfbTrackTitle: f.trackTitle || undefined,
      mfbArtist: f.artist || undefined,
      mfbAlbumImageUrl: f.albumImageUrl ?? undefined,
      mfbTags: f.tags,
      mfbBreathworkPhase: f.breathworkPhase,
    })
    start += Math.max(dur - XFADE_S, 1)
  }

  // Pre-compute overlap crossfades (single track), mirroring sessionStore.
  const sorted = [...clips].sort((a, b) => a.startTime - b.startTime)
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    const aEff = a.duration - a.trimStart - a.trimEnd
    const bEff = b.duration - b.trimStart - b.trimEnd
    const overlap = a.startTime + aEff - b.startTime
    if (overlap > 0.05) {
      const fade = Math.max(0.1, Math.min(overlap, Math.min(aEff / 2, bEff / 2)))
      a.crossfadeOut = fade
      b.crossfadeIn = fade
    }
  }

  return { tracks: [track], clips }
}
