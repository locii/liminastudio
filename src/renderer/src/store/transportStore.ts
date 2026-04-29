import { create } from 'zustand'

interface TransportStore {
  playing: boolean
  playhead: number
  looping: boolean
  zoom: number   // pixels per second
  scrollX: number
  viewportWidth: number  // scrollable timeline container width in px
  masterVolume: number   // 0–1

  setPlaying: (playing: boolean) => void
  setPlayhead: (seconds: number) => void
  toggleLoop: () => void
  setZoom: (zoom: number) => void
  setScrollX: (x: number) => void
  setViewportWidth: (w: number) => void
  setMasterVolume: (v: number) => void
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 200

export const useTransportStore = create<TransportStore>((set) => ({
  playing: false,
  playhead: 0,
  looping: false,
  zoom: 10,
  scrollX: 0,
  viewportWidth: 0,
  masterVolume: 1,

  setPlaying: (playing) => set({ playing }),
  setPlayhead: (playhead) => set({ playhead }),
  toggleLoop: () => set((s) => ({ looping: !s.looping })),
  setZoom: (zoom) =>
    set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 10) / 10)) }),
  setScrollX: (scrollX) => set({ scrollX }),
  setViewportWidth: (viewportWidth) => set({ viewportWidth }),
  setMasterVolume: (masterVolume) => set({ masterVolume: Math.max(0, Math.min(1, masterVolume)) }),
}))
