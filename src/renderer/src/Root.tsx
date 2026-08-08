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

  // Cmd/Ctrl+A inside a text field. On macOS the native select-all needs the
  // Edit menu's Select All role, which we don't register (Cmd+A is overloaded to
  // "select all clips" in Mix). Handle it here at the umbrella level — capture
  // phase, so it runs before any surface's own Cmd+A — for every input box in
  // every workspace. Only acts when focus is in an editable field; otherwise it
  // falls through to the surface handler.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'a' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.select()
      } else if (el?.isContentEditable) {
        const sel = window.getSelection()
        if (!sel) return
        const range = document.createRange()
        range.selectNodeContents(el)
        sel.removeAllRanges()
        sel.addRange(range)
      } else {
        return // not in a field — let the surface's "select all" handler run
      }
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
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
