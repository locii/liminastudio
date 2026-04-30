import { create } from 'zustand'
import { nanoid } from '../utils/nanoid'
import type { Track, Clip, WaveformData, Marker } from '../types'
import { pickTrackColor, MARKER_COLORS } from '../types'

// ── Crossfade computation ────────────────────────────────────────────────────

function computeCrossfades(clips: Clip[]): Clip[] {
  const byTrack = new Map<string, Clip[]>()
  for (const c of clips) {
    if (!byTrack.has(c.trackId)) byTrack.set(c.trackId, [])
    byTrack.get(c.trackId)!.push(c)
  }

  // Reset only crossfadeIn/Out — never touch user-set fadeIn/fadeOut
  const updated = clips.map((c) => ({ ...c, crossfadeIn: 0, crossfadeOut: 0 }))

  for (const trackClips of byTrack.values()) {
    const sorted = [...trackClips].sort((a, b) => a.startTime - b.startTime)
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]
      const b = sorted[i + 1]
      const aEff = a.duration - a.trimStart - a.trimEnd
      const bEff = b.duration - b.trimStart - b.trimEnd
      const overlap = a.startTime + aEff - b.startTime
      if (overlap > 0.05) {
        const fade = Math.max(0.1, Math.min(overlap, Math.min(aEff / 2, bEff / 2)))
        const ai = updated.findIndex((c) => c.id === a.id)
        const bi = updated.findIndex((c) => c.id === b.id)
        if (ai >= 0) updated[ai] = { ...updated[ai], crossfadeOut: fade }
        if (bi >= 0) updated[bi] = { ...updated[bi], crossfadeIn: fade }
      }
    }
  }
  return updated
}

// ── History ──────────────────────────────────────────────────────────────────

type Snapshot = { tracks: Track[]; clips: Clip[] }
const MAX_HISTORY = 50

// ── Store ────────────────────────────────────────────────────────────────────

interface SessionState {
  tracks: Track[]
  clips: Clip[]
  markers: Marker[]
  waveforms: Record<string, WaveformData>
  selectedClipId: string | null
  selectedTrackId: string | null
  copiedClip: Clip | null
  currentFilePath: string | null
  sessionLabel: string
  isDirty: boolean

  // History
  past: Snapshot[]
  future: Snapshot[]
  undo: () => void
  redo: () => void

  // Track / clip actions
  addTrackWithClip: (p: { name: string; filePath: string; duration: number }) => {
    track: Track
    clip: Clip
  }
  addClipToTrack: (p: { trackId: string; name: string; filePath: string; duration: number; startTime?: number }) => Clip
  addEmptyTrack: () => Track
  removeTrack: (trackId: string) => void
  updateTrack: (trackId: string, patch: Partial<Track>) => void
  updateClip: (clipId: string, patch: Partial<Clip>) => void
  removeClip: (clipId: string) => void
  splitClip: (clipId: string, splitTime: number) => void
  duplicateClip: (clipId: string) => void
  copyClip: (clipId: string) => void
  pasteClip: (atTime: number, targetTrackId?: string) => void

  // Markers
  addMarker: (time: number) => void
  updateMarker: (id: string, patch: Partial<Pick<Marker, 'name' | 'color' | 'time'>>) => void
  removeMarker: (id: string) => void

  // Waveforms / selection / persistence
  setWaveform: (filePath: string, data: Partial<WaveformData>) => void
  selectClip: (clipId: string | null) => void
  selectTrack: (trackId: string | null) => void
  loadSnapshot: (snapshot: { tracks: Track[]; clips: Clip[]; markers?: Marker[]; sessionLabel?: string }) => void
  newSession: () => void
  setCurrentFile: (filePath: string | null) => void
  setSessionLabel: (label: string) => void
  markClean: () => void
}

export const useSessionStore = create<SessionState>((set, get) => {
  // Push a snapshot BEFORE a state change (called synchronously in the action)
  function snapshot(): Snapshot {
    const { tracks, clips } = get()
    return { tracks, clips }
  }

  function historyPush(snap: Snapshot): Partial<SessionState> {
    return {
      past: [...get().past.slice(-(MAX_HISTORY - 1)), snap],
      future: [],
      isDirty: true,
    }
  }

  return {
    tracks: [],
    clips: [],
    markers: [],
    waveforms: {},
    selectedClipId: null,
    selectedTrackId: null,
    copiedClip: null,
    currentFilePath: null,
    sessionLabel: '',
    isDirty: false,
    past: [],
    future: [],

    undo: () => {
      const { past, tracks, clips, future } = get()
      if (past.length === 0) return
      const prev = past[past.length - 1]
      set({
        ...prev,
        past: past.slice(0, -1),
        future: [{ tracks, clips }, ...future.slice(0, MAX_HISTORY - 1)],
        isDirty: true,
      })
    },

    redo: () => {
      const { future, tracks, clips, past } = get()
      if (future.length === 0) return
      const next = future[0]
      set({
        ...next,
        future: future.slice(1),
        past: [...past.slice(-(MAX_HISTORY - 1)), { tracks, clips }],
        isDirty: true,
      })
    },

    addTrackWithClip: ({ name, filePath, duration }) => {
      const snap = snapshot()
      const { tracks } = get()
      const track: Track = {
        id: nanoid(), name,
        color: pickTrackColor(tracks.length),
        volume: 1, muted: false, solo: false,
        order: tracks.length,
      }
      const clip: Clip = {
        id: nanoid(), trackId: track.id,
        filePath, fileName: name,
        startTime: 0, duration,
        trimStart: 0, trimEnd: 0,
        fadeIn: 0, fadeOut: 0, fadeInCurve: 0.5, fadeOutCurve: 0.5, crossfadeIn: 0, crossfadeOut: 0, volume: 1, automation: [],
      }
      set((s) => ({
        tracks: [...s.tracks, track],
        clips: [...s.clips, clip],
        waveforms: { ...s.waveforms, [filePath]: { trackId: track.id, peaks: [], loading: true } },
        ...historyPush(snap),
      }))
      return { track, clip }
    },

    addClipToTrack: ({ trackId, name, filePath, duration, startTime: explicitStart }) => {
      const snap = snapshot()
      const { clips } = get()
      let resolvedStart = explicitStart
      if (resolvedStart === undefined) {
        // Default: place after the last clip on this track
        const trackClips = clips.filter((c) => c.trackId === trackId)
        const lastEnd = trackClips.length
          ? Math.max(...trackClips.map((c) => c.startTime + c.duration - c.trimStart - c.trimEnd))
          : 0
        resolvedStart = lastEnd + 0.5
      }
      const clip: Clip = {
        id: nanoid(), trackId,
        filePath, fileName: name,
        startTime: resolvedStart,
        duration, trimStart: 0, trimEnd: 0,
        fadeIn: 0, fadeOut: 0, fadeInCurve: 0.5, fadeOutCurve: 0.5, crossfadeIn: 0, crossfadeOut: 0, volume: 1, automation: [],
      }
      set((s) => ({
        clips: computeCrossfades([...s.clips, clip]),
        ...historyPush(snap),
      }))
      return clip
    },

    addEmptyTrack: () => {
      const snap = snapshot()
      const { tracks } = get()
      const track: Track = {
        id: nanoid(),
        name: `Track ${tracks.length + 1}`,
        color: pickTrackColor(tracks.length),
        volume: 1, muted: false, solo: false,
        order: tracks.length,
      }
      set((s) => ({
        tracks: [...s.tracks, track],
        waveforms: s.waveforms,
        ...historyPush(snap),
      }))
      return track
    },

    removeTrack: (trackId) => {
      const snap = snapshot()
      set((s) => {
        const waveforms = { ...s.waveforms }
        delete waveforms[trackId]
        return {
          tracks: s.tracks.filter((t) => t.id !== trackId),
          clips: computeCrossfades(s.clips.filter((c) => c.trackId !== trackId)),
          waveforms,
          ...historyPush(snap),
        }
      })
    },

    updateTrack: (trackId, patch) => {
      set((s) => ({
        tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)),
        isDirty: true,
      }))
    },

    updateClip: (clipId, patch) => {
      const snap = snapshot()
      // These keys don't affect clip positions, so skip computeCrossfades to avoid resetting fades
      const BYPASS_KEYS = ['fadeIn', 'fadeOut', 'fadeInCurve', 'fadeOutCurve', 'automation', 'volume']
      const fadeOnly = Object.keys(patch).every((k) => BYPASS_KEYS.includes(k))
      set((s) => {
        const next = s.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c))
        return {
          clips: fadeOnly ? next : computeCrossfades(next),
          ...historyPush(snap),
        }
      })
    },

    removeClip: (clipId) => {
      const snap = snapshot()
      set((s) => ({
        clips: computeCrossfades(s.clips.filter((c) => c.id !== clipId)),
        selectedClipId: s.selectedClipId === clipId ? null : s.selectedClipId,
        ...historyPush(snap),
      }))
    },

    splitClip: (clipId, splitTime) => {
      const clip = get().clips.find((c) => c.id === clipId)
      if (!clip) return
      const eff = clip.duration - clip.trimStart - clip.trimEnd
      const clipEnd = clip.startTime + eff
      if (splitTime <= clip.startTime + 0.1 || splitTime >= clipEnd - 0.1) return
      const snap = snapshot()
      const leftDuration = splitTime - clip.startTime
      const leftClip: Clip = {
        ...clip,
        trimEnd: clip.trimEnd + (eff - leftDuration),
        fadeOut: 0, crossfadeOut: 0,
      }
      const rightClip: Clip = {
        ...clip,
        id: nanoid(),
        startTime: splitTime,
        trimStart: clip.trimStart + leftDuration,
        fadeIn: 0, crossfadeIn: 0,
      }
      set((s) => ({
        clips: computeCrossfades(s.clips.map((c) => c.id === clipId ? leftClip : c).concat(rightClip)),
        selectedClipId: rightClip.id,
        ...historyPush(snap),
      }))
    },

    duplicateClip: (clipId) => {
      const snap = snapshot()
      const clip = get().clips.find((c) => c.id === clipId)
      if (!clip) return
      const eff = clip.duration - clip.trimStart - clip.trimEnd
      const newClip: Clip = { ...clip, id: nanoid(), startTime: clip.startTime + eff + 0.5 }
      set((s) => ({
        clips: computeCrossfades([...s.clips, newClip]),
        ...historyPush(snap),
      }))
    },

    copyClip: (clipId) => {
      const clip = get().clips.find((c) => c.id === clipId)
      if (clip) set({ copiedClip: clip })
    },

    pasteClip: (atTime, targetTrackId?) => {
      const { copiedClip } = get()
      if (!copiedClip) return
      const snap = snapshot()
      const newClip: Clip = {
        ...copiedClip,
        id: nanoid(),
        startTime: atTime,
        trackId: targetTrackId ?? copiedClip.trackId,
      }
      set((s) => ({
        clips: computeCrossfades([...s.clips, newClip]),
        selectedClipId: newClip.id,
        ...historyPush(snap),
      }))
    },

    setWaveform: (filePath, data) => {
      set((s) => ({
        waveforms: { ...s.waveforms, [filePath]: { ...s.waveforms[filePath], ...data } },
      }))
    },

    selectClip: (clipId) => set({ selectedClipId: clipId }),
    selectTrack: (trackId) => set({ selectedTrackId: trackId }),

    addMarker: (time) => {
      const count = get().markers.length + 1
      const color = MARKER_COLORS[(count - 1) % MARKER_COLORS.length]
      set((s) => ({
        markers: [...s.markers, { id: nanoid(), time, name: `Marker ${count}`, color }],
        isDirty: true,
      }))
    },

    updateMarker: (id, patch) => {
      set((s) => ({
        markers: s.markers.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        isDirty: true,
      }))
    },

    removeMarker: (id) => {
      set((s) => ({ markers: s.markers.filter((m) => m.id !== id), isDirty: true }))
    },

    loadSnapshot: ({ tracks, clips, markers, sessionLabel }) => {
      set({ tracks, clips, markers: markers ?? [], sessionLabel: sessionLabel ?? '', past: [], future: [], isDirty: false, selectedClipId: null })
    },

    newSession: () => {
      const t1: Track = { id: nanoid(), name: 'Track 1', color: pickTrackColor(0), volume: 1, muted: false, solo: false, order: 0 }
      const t2: Track = { id: nanoid(), name: 'Track 2', color: pickTrackColor(1), volume: 1, muted: false, solo: false, order: 1 }
      set({
        tracks: [t1, t2],
        clips: [],
        markers: [],
        sessionLabel: '',
        waveforms: {
          [t1.id]: { trackId: t1.id, peaks: [], loading: false },
          [t2.id]: { trackId: t2.id, peaks: [], loading: false },
        },
        selectedClipId: null,
        selectedTrackId: null,
        currentFilePath: null,
        past: [],
        future: [],
        isDirty: false,
      })
    },

    setCurrentFile: (filePath) => set({ currentFilePath: filePath }),

    setSessionLabel: (label) => set({ sessionLabel: label, isDirty: true }),

    markClean: () => set({ isDirty: false }),
  }
})
