import { useEffect } from 'react'
import MixApp from './mix/App'
import LibraryApp from './library/App'
import { Home } from './Home'
import { PlaylistsSurface } from './PlaylistsSurface'
import { NavConfirmModal } from './NavConfirmModal'
import { OverwriteModal } from './OverwriteModal'
import { useUIStore } from './uiStore'
import { useLibraryStore } from './library/store/libraryStore'
import { useCatalogueBootstrap } from './useCatalogueBootstrap'
import { useLibraryAutoRescan } from './library/useLibraryAutoRescan'

/**
 * Limina Studio umbrella shell. Switches between the two ported apps — Mix and
 * Library — each keeping its own renderer (components / store / session mode)
 * intact under its namespace. The umbrella only decides which one is on screen.
 */
export default function Root(): JSX.Element {
  const surface = useUIStore((s) => s.surface)
  useCatalogueBootstrap()
  useLibraryAutoRescan()

  // Opening a .limina file from the OS (double-click / "open with") always lands
  // in Mix Mode. Registered here at the umbrella level so it fires no matter
  // which surface is showing; Mix Mode consumes the stashed path and loads it.
  useEffect(() => {
    return window.electronAPI.onFileOpened((filePath) => {
      useUIStore.getState().setPendingMixOpenPath(filePath)
      useLibraryStore.getState().exitMixMode()
      useUIStore.getState().setSurface('mix')
    })
  }, [])

  const view = ((): JSX.Element => {
    switch (surface) {
      case 'mix':
        return <MixApp />
      case 'library':
        return <LibraryApp />
      case 'playlists':
        return <PlaylistsSurface />
      default:
        return <Home />
    }
  })()

  return (
    <>
      {view}
      <NavConfirmModal />
      <OverwriteModal />
    </>
  )
}
