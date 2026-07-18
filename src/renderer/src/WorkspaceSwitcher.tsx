import { useUIStore } from './uiStore'
import { useLibraryStore } from './library/store/libraryStore'
import { useTransportStore } from './mix/store/transportStore'
import { requestNavigate } from './navigate'

type Workspace = 'library' | 'playlists' | 'session' | 'mix'

const LABELS: Record<Workspace, string> = {
  library: 'Library',
  playlists: 'Collections',
  session: 'Session Mode',
  mix: 'Mix Mode',
}
const ORDER: Workspace[] = ['library', 'playlists', 'session', 'mix']

function NowPlayingBars(): JSX.Element {
  return (
    <span className="inline-flex items-end gap-0.5 mb-px ml-1" aria-hidden>
      <span className="w-px h-1.5 bg-accent rounded-full animate-pulse" style={{ animationDelay: '0ms', animationDuration: '900ms' }} />
      <span className="w-px h-2.5 bg-accent rounded-full animate-pulse" style={{ animationDelay: '300ms', animationDuration: '900ms' }} />
      <span className="w-px h-1.5 bg-accent rounded-full animate-pulse" style={{ animationDelay: '600ms', animationDuration: '900ms' }} />
      <span className="w-px h-2 rounded-full bg-accent animate-pulse" style={{ animationDelay: '900ms', animationDuration: '900ms' }} />
    </span>
  )
}

/**
 * Horizontal tab-style workspace switcher shown in the toolbar of every workspace.
 */
export function WorkspaceSwitcher(): JSX.Element {
  const surface = useUIStore((s) => s.surface)
  const setSurface = useUIStore((s) => s.setSurface)
  const mixMode = useLibraryStore((s) => s.mixMode)
  const mixPlaying = useTransportStore((s) => s.playing)
  const sessionPlaying = useLibraryStore((s) => s.mixPlayback.playing)

  const current: Workspace =
    surface === 'mix' ? 'mix' : surface === 'playlists' ? 'playlists' : mixMode ? 'session' : 'library'

  // Which workspace tab should show the now-playing indicator
  const playingWorkspace: Workspace | null = mixPlaying ? 'mix' : sessionPlaying ? 'session' : null

  const goTo = (w: Workspace): void => {
    if (w === current) return
    const lib = useLibraryStore.getState()
    requestNavigate(() => {
      if (w === 'library') { lib.exitMixMode(); setSurface('library') }
      else if (w === 'session') { lib.enterMixMode(); setSurface('library') }
      else if (w === 'playlists') { lib.exitMixMode(); setSurface('playlists') }
      else setSurface('mix')
    }, w)
  }

  return (
    <div
      className="flex items-center gap-1.5"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {ORDER.map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => goTo(w)}
          className={`flex items-center px-2.5 py-1 text-[10px] font-semibold tracking-widest uppercase rounded transition-colors select-none ${
            current === w
              ? 'text-accent bg-accent/10'
              : 'text-gray-500 hover:text-gray-200 hover:bg-surface-hover'
          }`}
        >
          {LABELS[w]}
          {w === playingWorkspace && <NowPlayingBars />}
        </button>
      ))}
    </div>
  )
}
