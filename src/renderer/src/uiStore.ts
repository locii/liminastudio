import { create } from 'zustand'

/** Which sub-app the umbrella is showing. `home` is the launch switcher. */
export type Surface = 'home' | 'library' | 'mix'

interface UIState {
  surface: Surface
  setSurface: (surface: Surface) => void
}

export const useUIStore = create<UIState>((set) => ({
  surface: 'home',
  setSurface: (surface) => set({ surface }),
}))
