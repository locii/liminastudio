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
  /** Dev-only: forces every surface to appear as if the library is empty. */
  devForceEmpty: boolean
  toggleDevForceEmpty: () => void
  /** Dev-only: skips loading the catalogue from disk (persisted to localStorage so it survives restarts). */
  devSkipLoad: boolean
  setDevSkipLoad: (skip: boolean) => void
  /** When true, Mix Mode opens the library dock on its next mount (consumed immediately). */
  mixOpenLibraryOnMount: boolean
  setMixOpenLibraryOnMount: (v: boolean) => void
  /** Onboarding: the user chose to continue without a Music for Breathwork
   *  account. Persisted so we stop nagging them to sign in on every launch. */
  loginSkipped: boolean
  setLoginSkipped: (v: boolean) => void
  /** While true, the Library shows the "Setting up your library" screen (scan +
   *  index progress + Apply matches) instead of the browser. Set when a folder
   *  add begins (from Home or Library); cleared when the user opens the library. */
  librarySetupOpen: boolean
  setLibrarySetupOpen: (v: boolean) => void
  /** Deep-link: a recorded session to reveal + select when Collections next
   *  mounts (e.g. from the "View in Collections" chip after recording). Consumed
   *  and cleared by PlaylistsSurface on mount. */
  collectionsPendingSessionId: string | null
  setCollectionsPendingSessionId: (id: string | null) => void
  /** Deep-link: a library file to reveal + select when the Library next mounts
   *  (e.g. "Show in Library" from a Collections playlist). Consumed and cleared
   *  by the Library on mount — set directly here because switching surfaces
   *  unmounts Collections, whose cleanup would otherwise clear the selection. */
  libraryRevealFileId: string | null
  setLibraryRevealFileId: (id: string | null) => void
}

export const useUIStore = create<UIState>((set) => ({
  surface: 'home',
  setSurface: (surface) => set({ surface }),
  navConfirmOpen: false,
  setNavConfirmOpen: (navConfirmOpen) => set({ navConfirmOpen }),
  overwritePrompt: null,
  setOverwritePrompt: (overwritePrompt) => set({ overwritePrompt }),
  devForceEmpty: false,
  toggleDevForceEmpty: () => set((s) => {
    const next = !s.devForceEmpty
    // Entering the preview also clears the "skipped sign-in" flag, so the whole
    // onboarding (sign-in → drop zone) is visible and the preview is repeatable.
    if (next) {
      try { ['limina-login-skipped', 'limina-tried-session', 'limina-tried-mix', 'limina-nextsteps-dismissed'].forEach((k) => localStorage.removeItem(k)) } catch { /* noop */ }
      return { devForceEmpty: true, loginSkipped: false }
    }
    return { devForceEmpty: false }
  }),
  devSkipLoad: (() => { try { return !!localStorage.getItem('limina-dev-skip-load') } catch { return false } })(),
  setDevSkipLoad: (skip) => {
    set({ devSkipLoad: skip })
    try {
      if (skip) localStorage.setItem('limina-dev-skip-load', '1')
      else localStorage.removeItem('limina-dev-skip-load')
    } catch { /* noop */ }
  },
  mixOpenLibraryOnMount: false,
  setMixOpenLibraryOnMount: (v) => set({ mixOpenLibraryOnMount: v }),
  loginSkipped: (() => { try { return !!localStorage.getItem('limina-login-skipped') } catch { return false } })(),
  setLoginSkipped: (v) => {
    set({ loginSkipped: v })
    try {
      if (v) localStorage.setItem('limina-login-skipped', '1')
      else localStorage.removeItem('limina-login-skipped')
    } catch { /* noop */ }
  },
  librarySetupOpen: false,
  setLibrarySetupOpen: (v) => set({ librarySetupOpen: v }),
  collectionsPendingSessionId: null,
  setCollectionsPendingSessionId: (id) => set({ collectionsPendingSessionId: id }),
  libraryRevealFileId: null,
  setLibraryRevealFileId: (id) => set({ libraryRevealFileId: id }),
}))
