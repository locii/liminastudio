import type { LibraryFile } from './library/types'
import type { SessionPlayedTrack } from './library/store/libraryStore'

/**
 * Builds an editable Mix session (two alternating tracks, A/B, with cue-point /
 * waveform-analysis crossfades) from an ordered list of library files. This is
 * the shared core behind every "Open in Mix" path — the MFB playlist panel, the
 * recorded-sessions modal, and a freshly-loaded template/preset/recording.
 *
 * Extracted from PlaylistPanel's original buildLiminaSession so all callers get
 * the same real crossfades instead of a flat single-track import.
 */

export const SEGMENT_COLORS = [
  '#6366f1', '#3b82f6', '#14b8a6', '#22c55e',
  '#f59e0b', '#ef4444', '#a855f7', '#ec4899',
]

const ANALYSIS_WINDOW_S = 0.5
const FADE_OUT_THRESHOLD = 0.025   // ~-32 dBFS: below = silence tail
const CONTENT_THRESHOLD_RATIO = 0.25  // main content starts when RMS exceeds 25% of track peak
const MAX_FADEOUT_S = 20
const MAX_FADEIN_S = 30
const MIN_FADE_S = 0.5
const ANALYZE_TIMEOUT_MS = 15_000
const NON_CUE_FADEIN_BUFFER_S = 3  // extra fade-in time beyond detected content start for tracks without manual cue points

function windowRMS(data: Float32Array, startSample: number, windowSamples: number): number {
  let sum = 0
  const end = Math.min(startSample + windowSamples, data.length)
  for (let i = startSample; i < end; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / (end - startSample))
}

async function analyzeTransitions(filePath: string, sampleRate: number, port: number): Promise<{ fadeIn: number; fadeOut: number }> {
  const defaults = { fadeIn: 3, fadeOut: 8 }
  const work = async (): Promise<{ fadeIn: number; fadeOut: number }> => {
    const res = await fetch(`http://127.0.0.1:${port}${encodeURI(filePath)}?sr=${sampleRate}`)
    const arrayBuffer = await res.arrayBuffer()
    const ctx = new AudioContext()
    const audio = await ctx.decodeAudioData(arrayBuffer)
    ctx.close()

    const sr = audio.sampleRate
    const winSamples = Math.floor(ANALYSIS_WINDOW_S * sr)

    // Mix to mono
    const mono = new Float32Array(audio.length)
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
      const chData = audio.getChannelData(ch)
      for (let i = 0; i < audio.length; i++) mono[i] += chData[i] / audio.numberOfChannels
    }

    // Find peak RMS of the track body (skip first/last 5% to avoid artifacts)
    const bodyStart = Math.floor(mono.length * 0.05)
    const bodyEnd = Math.floor(mono.length * 0.95)
    let peakRms = 0
    for (let i = bodyStart; i < bodyEnd; i += winSamples) {
      const rms = windowRMS(mono, i, winSamples)
      if (rms > peakRms) peakRms = rms
    }
    // Main content threshold: relative to the track's own peak level
    const contentThreshold = Math.max(peakRms * CONTENT_THRESHOLD_RATIO, FADE_OUT_THRESHOLD)

    // Scan from end backwards — find last window with signal above silence threshold
    let fadeOut = MAX_FADEOUT_S
    const outScanStart = Math.max(0, mono.length - Math.floor(MAX_FADEOUT_S * sr))
    for (let i = mono.length - winSamples; i >= outScanStart; i -= winSamples) {
      if (windowRMS(mono, i, winSamples) > FADE_OUT_THRESHOLD) {
        fadeOut = (mono.length - i) / sr
        break
      }
    }

    // Find main content start — first window that clears the relative threshold
    let fadeIn: number
    const inScanEnd = Math.min(mono.length, Math.floor(MAX_FADEIN_S * sr))
    if (windowRMS(mono, 0, winSamples) >= contentThreshold) {
      fadeIn = MIN_FADE_S  // track opens at full content immediately
    } else {
      fadeIn = MAX_FADEIN_S
      for (let i = winSamples; i < inScanEnd; i += winSamples) {
        if (windowRMS(mono, i, winSamples) >= contentThreshold) {
          fadeIn = i / sr
          break
        }
      }
    }

    return { fadeIn, fadeOut }
  }

  const timeout = new Promise<{ fadeIn: number; fadeOut: number }>((resolve) =>
    setTimeout(() => resolve(defaults), ANALYZE_TIMEOUT_MS)
  )
  return Promise.race([work().catch(() => defaults), timeout])
}

/** One track in the ordered set, with optional metadata overrides (e.g. an MFB playlist supplies authoritative title/artist/artwork). */
export interface MixItem {
  file: LibraryFile
  mfbTrackId?: number | null
  title?: string
  artist?: string
  albumImageUrl?: string | null
}

/** A contiguous run of items that forms a named segment marker on the timeline. */
export interface SegmentSpan {
  name: string
  count: number
}

/**
 * Build the two-track session from an ordered item list. Clips alternate between
 * Track A and Track B so consecutive tracks overlap and crossfade. Fades come
 * from manual cue points (introEndMs / outroStartMs) when present, otherwise from
 * waveform analysis. Optional `segmentSpans` add named segment markers.
 */
export async function buildTwoTrackMix(items: MixItem[], segmentSpans?: SegmentSpan[]): Promise<object> {
  const orderedFiles = items.map((it) => it.file)
  const port = await window.electronAPI.getAudioServerPort()

  // True durations (ffmpeg — WAV RIFF headers lie) + transition analysis, in parallel.
  const [trueDurations, analyses] = await Promise.all([
    Promise.all(orderedFiles.map((f) =>
      window.electronAPI.getFileDuration(f.filePath).then((d) => d > 0 ? d : f.duration)
    )),
    Promise.all(orderedFiles.map((f) => {
      if (f.introEndMs != null && f.outroStartMs != null) {
        const clipStartMs = f.clipStartMs ?? 0
        const clipEndMs = f.clipEndMs ?? Math.round(f.duration * 1000)
        return Promise.resolve({
          fadeIn: (f.introEndMs - clipStartMs) / 1000,
          fadeOut: (clipEndMs - f.outroStartMs) / 1000,
        })
      }
      return analyzeTransitions(f.filePath, f.sampleRate, port)
    })),
  ])

  const trackAId = crypto.randomUUID()
  const trackBId = crypto.randomUUID()
  const tracks = [
    { id: trackAId, name: 'Track A', color: '#75f264', volume: 1, muted: false, solo: false, order: 0 },
    { id: trackBId, name: 'Track B', color: '#4946ec', volume: 1, muted: false, solo: false, order: 1 },
  ]

  const clips: object[] = []
  const clipStart: number[] = []
  const clipEnd: number[] = []
  let cursor = 0

  for (let clipIndex = 0; clipIndex < items.length; clipIndex++) {
    const it = items[clipIndex]
    const file = it.file
    const analysis = analyses[clipIndex] ?? { fadeIn: 3, fadeOut: 8 }
    const trueDuration = trueDurations[clipIndex] ?? file.duration

    // Clip trim bounds clamped to true audio duration
    const clipStartMs = file.clipStartMs ?? 0
    const clipEndMs = file.clipEndMs ?? Math.round(trueDuration * 1000)
    const clipStartS = Math.min(clipStartMs / 1000, trueDuration)
    const clipEndS = Math.min(clipEndMs / 1000, trueDuration)
    const effectiveDuration = Math.max(0.1, clipEndS - clipStartS)

    // Manual cues take priority over waveform analysis (relative to clip bounds)
    const rawFadeIn = file.introEndMs != null
      ? Math.max(0, (file.introEndMs - clipStartMs) / 1000)
      : analysis.fadeIn + NON_CUE_FADEIN_BUFFER_S
    const rawFadeOut = file.outroStartMs != null
      ? Math.max(0, (clipEndMs - file.outroStartMs) / 1000)
      : analysis.fadeOut

    const fadeOut = Math.min(rawFadeOut, effectiveDuration * 0.5)
    const fadeIn = Math.min(rawFadeIn, effectiveDuration * 0.5)

    const nextFile = orderedFiles[clipIndex + 1] ?? null
    const nextAnalysis = nextFile ? (analyses[clipIndex + 1] ?? null) : null
    const nextTrueDuration = (trueDurations[clipIndex + 1] ?? nextFile?.duration) ?? 0
    const nextClipStartMs = nextFile?.clipStartMs ?? 0
    const nextClipEndMs = nextFile
      ? Math.min(nextFile.clipEndMs ?? Math.round(nextTrueDuration * 1000), Math.round(nextTrueDuration * 1000))
      : 0
    const nextRawFadeIn = nextFile?.introEndMs != null
      ? Math.max(0, (nextFile.introEndMs - nextClipStartMs) / 1000)
      : (nextAnalysis?.fadeIn ?? 0) + NON_CUE_FADEIN_BUFFER_S
    const nextEffectiveDuration = nextFile
      ? Math.max(0.1, (nextClipEndMs - nextClipStartMs) / 1000)
      : 0
    // Cap nextFadeIn against both the next clip's duration and this clip's remaining playable time
    const nextFadeIn = nextFile
      ? Math.min(nextRawFadeIn, nextEffectiveDuration * 0.5, effectiveDuration * 0.5)
      : 0

    const startTime = cursor
    clipStart[clipIndex] = startTime
    clipEnd[clipIndex] = startTime + effectiveDuration
    clips.push({
      id: crypto.randomUUID(),
      trackId: clipIndex % 2 === 0 ? trackAId : trackBId,
      filePath: file.filePath,
      fileName: file.fileName.replace(/\.[^.]+$/, ''),
      startTime,
      duration: trueDuration,
      trimStart: clipStartS,
      trimEnd: trueDuration - clipEndS,
      fadeIn,
      fadeOut,
      fadeInCurve: file.fadeInCurve,
      fadeOutCurve: file.fadeOutCurve,
      crossfadeIn: 0,
      crossfadeOut: 0,
      volume: 1,
      automation: [],
      // MFB metadata — used by Limina Mix for the Now Playing overlay and clip properties
      mfbTrackId: it.mfbTrackId ?? file.mfbTrackId,
      mfbTrackTitle: it.title ?? file.trackTitle,
      mfbArtist: it.artist ?? file.artist,
      mfbAlbumImageUrl: it.albumImageUrl ?? file.albumImageUrl ?? null,
      mfbTags: file.tags.length > 0 ? file.tags : [],
      mfbBreathworkPhase: file.breathworkPhase ?? null,
    })

    // Crossfade alignment: the incoming track reaches full volume (the peak of its
    // fade-in) exactly when this clip *begins* its fade-out — so the new track sits
    // at full level throughout the outgoing fade-out. Applied uniformly, cued or not.
    cursor = startTime + effectiveDuration - fadeOut - nextFadeIn
  }

  // Named segment markers over contiguous runs of clips (playlist segments only).
  const segments: object[] = []
  if (segmentSpans) {
    let idx = 0
    segmentSpans.forEach((span, segIdx) => {
      const startIdx = idx
      const endIdx = idx + span.count
      idx = endIdx
      if (span.count <= 0 || startIdx >= clips.length) return
      const segStart = clipStart[startIdx]
      const segEnd = Math.max(...clipEnd.slice(startIdx, endIdx))
      segments.push({
        id: crypto.randomUUID(),
        name: span.name,
        startTime: segStart,
        endTime: segEnd,
        color: SEGMENT_COLORS[segIdx % SEGMENT_COLORS.length],
      })
    })
  }

  return { tracks, clips, segments, sessionLabel: '', trackHeights: {}, laneHeights: {} }
}

/**
 * Build a two-track Mix session from a RECORDED session, using the exact
 * timestamps from the recording (atMs / startMs / fadeInMs / playedMs).
 * Unlike buildTwoTrackMix, no audio analysis is performed — the positions
 * come straight from the session log so every crossfade lands exactly where
 * it happened during the live session.
 */
export async function buildTwoTrackMixFromRecording(
  items: MixItem[],
  played: SessionPlayedTrack[],
): Promise<object> {
  const orderedFiles = items.map((it) => it.file)

  const trueDurations = await Promise.all(
    orderedFiles.map((f) =>
      window.electronAPI.getFileDuration(f.filePath).then((d) => d > 0 ? d : f.duration)
    )
  )

  const trackAId = crypto.randomUUID()
  const trackBId = crypto.randomUUID()
  const tracks = [
    { id: trackAId, name: 'Track A', color: '#75f264', volume: 1, muted: false, solo: false, order: 0 },
    { id: trackBId, name: 'Track B', color: '#4946ec', volume: 1, muted: false, solo: false, order: 1 },
  ]

  const clips: object[] = []
  const baseMs = played[0]?.atMs ?? 0

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const p = played[i]
    const trueDuration = trueDurations[i] ?? it.file.duration

    const trimStartS = Math.min((p.startMs ?? 0) / 1000, trueDuration)
    const fadeInS = (p.fadeInMs ?? 0) / 1000

    // atMs = when the engine reached outroStartMs on the PREVIOUS track and
    // initiated this track's fade-in. Mirror buildTwoTrackMix: pre-roll the clip
    // by fadeInMs so it reaches full volume exactly when the old clip starts
    // fading out (at atMs).
    const crossfadeAtMs = p.atMs - baseMs
    const startTimeS = (crossfadeAtMs - (p.fadeInMs ?? 0)) / 1000

    // Determine where this clip ends on the timeline and its fade-out duration.
    let clipEndS: number
    let fadeOutS: number
    const nextP = played[i + 1]
    if (nextP && p.ended === 'crossfade') {
      // Old clip fades out starting at nextP.atMs for nextP.fadeInMs duration.
      clipEndS = (nextP.atMs - baseMs + (nextP.fadeInMs ?? 0)) / 1000
      fadeOutS = (nextP.fadeInMs ?? 0) / 1000
    } else {
      // Track played to natural end, was skipped, or is the last in the set.
      // clipEndS anchored from crossfadeAtMs (not startTimeS) so playedMs maps
      // correctly regardless of the pre-roll offset.
      const playedMs = p.playedMs > 0
        ? p.playedMs
        : Math.max(0, (trueDuration - trimStartS - fadeInS) * 1000)
      clipEndS = (crossfadeAtMs + playedMs) / 1000
      fadeOutS = 0
    }

    const effectiveDurationS = Math.max(0.1, clipEndS - startTimeS)
    const fileEndS = trimStartS + effectiveDurationS
    const trimEndS = Math.max(0, trueDuration - fileEndS)

    clips.push({
      id: crypto.randomUUID(),
      trackId: i % 2 === 0 ? trackAId : trackBId,
      filePath: it.file.filePath,
      fileName: it.file.fileName.replace(/\.[^.]+$/, ''),
      startTime: startTimeS,
      duration: trueDuration,
      trimStart: trimStartS,
      trimEnd: trimEndS,
      fadeIn: fadeInS,
      fadeOut: fadeOutS,
      fadeInCurve: it.file.fadeInCurve,
      fadeOutCurve: it.file.fadeOutCurve,
      crossfadeIn: 0,
      crossfadeOut: 0,
      volume: 1,
      automation: [],
      mfbTrackId: it.mfbTrackId ?? it.file.mfbTrackId,
      mfbTrackTitle: it.title ?? it.file.trackTitle,
      mfbArtist: it.artist ?? it.file.artist,
      mfbAlbumImageUrl: it.albumImageUrl ?? it.file.albumImageUrl ?? null,
      mfbTags: it.file.tags.length > 0 ? it.file.tags : [],
      mfbBreathworkPhase: it.file.breathworkPhase ?? null,
    })
  }

  return { tracks, clips, segments: [], sessionLabel: '', trackHeights: {}, laneHeights: {} }
}
