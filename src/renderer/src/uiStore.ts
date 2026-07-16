import { create } from 'zustand'

/** Which sub-app the umbrella is showing. `home` is the launch switcher. */
export type Surface = 'home' | 'library' | 'mix' | 'playlists'

interface UIState {
  surface: Surface
  setSurface: (surface: Surface) => void
  /** When leaving a view that's actively playing, a confirm modal is shown. */
  navConfirmOpen: boolean
  setNavConfirmOpen: (open: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  surface: 'home',
  setSurface: (surface) => set({ surface }),
  navConfirmOpen: false,
  setNavConfirmOpen: (navConfirmOpen) => set({ navConfirmOpen }),
}))
