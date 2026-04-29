export interface Track {
  id: string
  name: string
  color: string
  volume: number
  muted: boolean
  solo: boolean
  order: number
}

export interface AutomationPoint {
  id: string
  time: number    // seconds from visual clip start (after trimStart)
  value: number   // 0–1 gain multiplier on top of clip.volume
}

export interface Clip {
  id: string
  trackId: string
  filePath: string
  fileName: string
  startTime: number
  duration: number
  trimStart: number
  trimEnd: number
  fadeIn: number
  fadeOut: number
  fadeInCurve: number   // -1 (concave) → 0 (linear) → 1 (convex), default 0.5
  fadeOutCurve: number
  crossfadeIn: number   // auto-computed from overlap, not user-editable
  crossfadeOut: number
  volume: number
  automation: AutomationPoint[]
}

export interface Marker {
  id: string
  time: number
  name: string
  color: string
}

export const MARKER_COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#22c55e', '#a855f7']

export interface TimelineState {
  zoom: number
  scrollX: number
  duration: number
}

export interface TransportState {
  playhead: number
  playing: boolean
  looping: boolean
  loopStart: number
  loopEnd: number
}

export interface Session {
  id: string
  name: string
  tracks: Track[]
  clips: Clip[]
  timeline: TimelineState
  createdAt: string
  updatedAt: string
}

export interface AudioFileMeta {
  path: string
  name: string
  duration: number
  sampleRate: number
  channels: number
}

export interface WaveformData {
  trackId: string
  peaks: number[]
  loading: boolean
  error?: string
}

// Track colours pool
export const TRACK_COLORS = [
  '#6366f1', // indigo
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f59e0b', // amber
  '#22c55e', // green
  '#ef4444', // red
  '#a855f7', // purple
  '#06b6d4', // cyan
]

export function pickTrackColor(order: number): string {
  return TRACK_COLORS[order % TRACK_COLORS.length]
}
