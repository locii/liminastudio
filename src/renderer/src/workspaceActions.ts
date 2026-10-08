import { useUIStore } from './uiStore'
import type { SessionsSection } from './uiStore'
import { useLibraryStore } from './library/store/libraryStore'
import { requestNavigate } from './navigate'
import { requestOpen } from './openGuard'
import { isInFolder } from './library/lib/isInFolder'

/**
 * "Go somewhere" actions shared by the workspace tab dropdowns, the Cmd+K
 * quick-jump palette and Home. Each one routes through requestNavigate (so
 * moving between Mix and Session playback asks first) and, where it replaces
 * content, requestOpen (Save / Replace / Cancel).
 */

export type Workspace = 'library' | 'playlists' | 'mix' | 'session' | 'sessions'

export function currentWorkspace(): Workspace {
  const { surface, collectionsView } = useUIStore.getState()
  if (surface === 'mix') return 'mix'
  if (surface === 'playlists') return collectionsView === 'sessions' ? 'sessions' : 'playlists'
  return useLibraryStore.getState().mixMode ? 'session' : 'library'
}

export function goToWorkspace(w: Workspace): void {
  if (w === currentWorkspace()) return
  const lib = useLibraryStore.getState()
  const ui = useUIStore.getState()
  requestNavigate(() => {
    if (w === 'library') { lib.exitMixMode(); ui.setSurface('library') }
    else if (w === 'session') { lib.enterMixMode(); ui.setSurface('library') }
    else if (w === 'playlists' || w === 'sessions') {
      lib.exitMixMode()
      ui.setCollectionsView(w)
      ui.setSurface('playlists')
    }
    else ui.setSurface('mix')
  }, w === 'sessions' ? 'playlists' : w)
}

/** Library filtered to a folder or a single tag (the sidebar follows). */
export function openLibraryAt(pick: { folderId: string } | { tag: string }): void {
  requestNavigate(() => {
    const lib = useLibraryStore.getState()
    lib.exitMixMode()
    if ('folderId' in pick) lib.selectFolder(pick.folderId)
    else useLibraryStore.setState({ selectedTags: [pick.tag], selectedFolderId: null, selectedPlaylistId: null, selectedFileId: null })
    useUIStore.getState().setSurface('library')
  }, 'library')
}

/** Library with one track revealed and selected (its folder shown). */
export function revealTrack(fileId: string): void {
  requestNavigate(() => {
    const lib = useLibraryStore.getState()
    const ui = useUIStore.getState()
    const alreadyInLibrary = ui.surface === 'library'
    lib.exitMixMode()
    if (alreadyInLibrary) {
      // Library is mounted — select directly.
      const file = lib.files.find((f) => f.id === fileId)
      const folder = file ? lib.watchedFolders.find((wf) => isInFolder(file.filePath, wf.path)) : null
      lib.showFileInLibrary(folder?.id ?? null, fileId)
    } else {
      // Consumed by the Library on mount (leaving Playlists clears selection first).
      ui.setLibraryRevealFileId(fileId)
      ui.setSurface('library')
    }
  }, 'library')
}

export function openPlaylistById(id: number): void {
  requestNavigate(() => {
    useLibraryStore.getState().exitMixMode()
    useUIStore.getState().openPlaylist(id)
  }, 'playlists')
}

/** Same path as File → Open Recent, so the mix keeps its file (Save writes back to it). */
export function openRecentMix(filePath: string): void {
  requestNavigate(() => requestOpen('mix', () => {
    useUIStore.getState().setPendingMixOpenPath(filePath)
    useUIStore.getState().setSurface('mix')
  }), 'mix')
}

export function openRecordedSession(id: string): void {
  requestNavigate(() => requestOpen('session', () => {
    const lib = useLibraryStore.getState()
    lib.loadSession(id)
    lib.enterMixMode()
    useUIStore.getState().setSurface('library')
  }), 'session')
}

export function openTemplate(id: string): void {
  requestNavigate(() => requestOpen('session', () => {
    const lib = useLibraryStore.getState()
    lib.loadMix(id)
    lib.enterMixMode()
    useUIStore.getState().setSurface('library')
  }), 'session')
}

export function openSessionsView(section?: SessionsSection): void {
  requestNavigate(() => {
    useLibraryStore.getState().exitMixMode()
    useUIStore.getState().openSessions(section)
  }, 'playlists')
}
