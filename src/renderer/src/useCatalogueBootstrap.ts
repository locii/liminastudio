import { useEffect, useRef } from 'react'
import { useLibraryStore } from './library/store/libraryStore'
import { useUIStore } from './uiStore'

/**
 * Restores the login session and loads the catalogue from disk once at app start
 * — regardless of which surface is showing — and persists the catalogue
 * (debounced) whenever it changes.
 *
 * This used to live inside the Library screen (catalogue load in App.tsx, auth
 * restore in AccountButton), which meant that on restart — the app opens on Home
 * — neither ran: `watchedFolders` / `userAccount` stayed at their empty defaults
 * and Home wrongly showed new-user onboarding even though a real library and
 * login existed. Bootstrapping here, at the umbrella level, guarantees the store
 * reflects the on-disk library and session before any surface decides new-user
 * state. The only things that force new-user mode when a library exists are the
 * dev toggles: "Reset to new user" (devSkipLoad) and "set empty state"
 * (devForceEmpty).
 */
export function useCatalogueBootstrap(): void {
  const loadedRef = useRef(false)
  const devSkipLoad = useUIStore((s) => s.devSkipLoad)

  // Initial bootstrap — runs exactly once.
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true

    const store = useLibraryStore.getState()

    if (import.meta.env.DEV && devSkipLoad) {
      // Dev "Reset to new user" — start fully fresh: skip disk load and session
      // restore so the whole new-user flow (sign-in → add music) is visible.
      store.setCatalogueLoaded(true)
      return
    }

    // Resolve session + catalogue together, then commit both before flipping the
    // loaded gate — so Home never flashes the sign-in step for a logged-in user.
    Promise.all([
      window.electronAPI.loadCatalogue(),
      window.electronAPI.authMe().catch(() => null),
    ]).then(([{ data, restoredFromBackup }, user]) => {
      if (user) store.setUserAccount(user)
      if (data) store.loadCatalogue(data)
      else store.setCatalogueLoaded(true)
      if (restoredFromBackup) store.setRestoredFromBackup(true)
    })
  }, [devSkipLoad])

  // Persist the catalogue whenever it changes — debounced so rapid updates don't race.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    return useLibraryStore.subscribe(() => {
      if (!useLibraryStore.getState().catalogueLoaded) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        window.electronAPI.saveCatalogue(useLibraryStore.getState().toCatalogue())
      }, 800)
    })
  }, [])
}
