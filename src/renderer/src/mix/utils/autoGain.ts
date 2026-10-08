import { useSessionStore } from '../store/sessionStore'

/**
 * Loudness-matched auto-gain for clips.
 *
 * Each clip's gain brings the file to TARGET_LUFS integrated loudness, so a
 * quiet ambient piece and a dense drum track sound equally loud — peak
 * normalisation (the old approach) left dense tracks far louder. Gain is
 * capped so the file's true peak stays at or below PEAK_CEILING_DBTP (the
 * master limiter catches overlaps), and to the clip-volume range (×2 = +6 dB).
 */
export const TARGET_LUFS = -16
const PEAK_CEILING_DBTP = -1
const MAX_GAIN = 2

const dbToGain = (db: number): number => Math.pow(10, db / 20)

/** Suggested clip volume for a file, or null if it couldn't be measured. */
export async function autoGainFor(filePath: string): Promise<number | null> {
  try {
    const { integratedLufs, truePeakDb } = await window.electronAPI.getLoudness(filePath)
    if (integratedLufs <= -70) return null // silent / nothing decoded
    const loudnessGainDb = TARGET_LUFS - integratedLufs
    const peakHeadroomDb = PEAK_CEILING_DBTP - truePeakDb
    const gain = dbToGain(Math.min(loudnessGainDb, peakHeadroomDb))
    return Math.max(0.05, Math.min(MAX_GAIN, gain))
  } catch {
    return null
  }
}

/** Measure a clip's file and set its volume (fire-and-forget). */
export function applyAutoGain(clipId: string, filePath: string): void {
  void autoGainFor(filePath).then((volume) => {
    if (volume != null) useSessionStore.getState().updateClip(clipId, { volume })
  })
}

/**
 * Re-level every clip in the session to TARGET_LUFS — for sessions built
 * before loudness matching (or after manual tweaks). One undo step.
 */
export async function matchLoudnessAll(): Promise<{ changed: number; failed: number }> {
  const store = useSessionStore.getState()
  const before = { tracks: store.tracks, clips: store.clips }
  const paths = [...new Set(before.clips.map((c) => c.filePath))]
  const volumes = new Map<string, number | null>()
  await Promise.all(paths.map(async (p) => { volumes.set(p, await autoGainFor(p)) }))

  let changed = 0
  let failed = 0
  for (const clip of useSessionStore.getState().clips) {
    const v = volumes.get(clip.filePath)
    if (v == null) { failed++; continue }
    if (Math.abs(v - clip.volume) > 0.001) {
      useSessionStore.getState().updateClipSilent(clip.id, { volume: v })
      changed++
    }
  }
  if (changed > 0) useSessionStore.getState().pushHistorySnapshot(before)
  return { changed, failed }
}
