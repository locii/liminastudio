import MixApp from './mix/App'
import LibraryApp from './library/App'
import { Home } from './Home'
import { PlaylistsSurface } from './PlaylistsSurface'
import { NavConfirmModal } from './NavConfirmModal'
import { useUIStore } from './uiStore'

/**
 * Limina Studio umbrella shell. Switches between the two ported apps — Mix and
 * Library — each keeping its own renderer (components / store / session mode)
 * intact under its namespace. The umbrella only decides which one is on screen.
 */
export default function Root(): JSX.Element {
  const surface = useUIStore((s) => s.surface)

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
    </>
  )
}
