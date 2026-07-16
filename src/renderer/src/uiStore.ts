import { create } from 'zustand'

/** Which sub-app the umbrella is showing. `home` is the launch switcher. */
export type Surface = 'home' | 'library' | 'mix' | 'playlists'

interface UIState {
  surface: Surface
  setSurface: (surface: Surface) => void
  /** When leaving a view that's actively playing, a confirm modal is shown. */
  navConfirmOpen: boolean
  setNavConfirmOpen: (open: boolean) => void
  /** When an "Open in…" would overwrite existing content, a Save/Replace/Cancel
   *  modal is shown for the given target. */
  overwritePrompt: 'mix' | 'session' | null
  setOverwritePrompt: (target: 'mix' | 'session' | null) => void
}

export const useUIStore = create<UIState>((set) => ({
  surface: 'home',
  setSurface: (surface) => set({ surface }),
  navConfirmOpen: false,
  setNavConfirmOpen: (navConfirmOpen) => set({ navConfirmOpen }),
  overwritePrompt: null,
  setOverwritePrompt: (overwritePrompt) => set({ overwritePrompt }),
}))
