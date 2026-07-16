import { useEffect, useMemo, useState } from 'react'
import { useLibraryStore } from './library/store/libraryStore'
import { PlaylistPanel } from './library/components/PlaylistPanel'
import { PlayerBar } from './library/components/PlayerBar'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { GlobalControls } from './GlobalControls'
import { useUIStore } from './uiStore'

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/**
 * Playlists workspace — a left-aligned index of the signed-in user's Music for
 * Breathwork playlists; selecting one shows its detail (reuses PlaylistPanel).
 */
export function PlaylistsSurface(): JSX.Element {
  const setSurface = useUIStore((s) => s.setSurface)
  const userAccount = useLibraryStore((s) => s.userAccount)
  const playlists = useLibraryStore((s) => s.playlists)
  const setPlaylists = useLibraryStore((s) => s.setPlaylists)
  const selectedPlaylistId = useLibraryStore((s) => s.selectedPlaylistId)
  const selectPlaylist = useLibraryStore((s) => s.selectPlaylist)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? playlists.filter((p) => p.title.toLowerCase().includes(q)) : playlists
  }, [playlists, query])

  // Fetch the user's playlists when signed in (auth is populated app-wide by the
  // global profile button).
  useEffect(() => {
    if (!userAccount) { setPlaylists([]); return }
    window.electronAPI.getUserPlaylists().then(setPlaylists).catch(() => {})
  }, [userAccount, setPlaylists])

  // `selectedPlaylistId` is shared store state; clear it on leaving so the
  // Library workspace doesn't open into the playlist detail we selected here.
  useEffect(() => {
    return () => { useLibraryStore.getState().selectPlaylist(null) }
  }, [])

  return (
    <div className="flex flex-col h-full text-gray-200 bg-surface-base">
      {/* macOS traffic-light drag region */}
      <div className="h-7 shrink-0 bg-surface-panel" style={drag} />

      {/* App toolbar — consistent across all workspaces */}
      <div className="flex items-center justify-between px-3 h-10 border-b shrink-0 bg-surface-panel border-surface-border" style={drag}>
        <div className="flex items-center gap-2" style={noDrag}>
          <button
            type="button"
            onClick={() => setSurface('home')}
            title="Back to Home"
            className="flex items-center justify-center w-6 h-6 text-gray-400 rounded border transition-colors bg-surface-hover hover:bg-surface-border border-surface-border"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
            </svg>
          </button>
          <span className="text-gray-600 select-none">›</span>
          <WorkspaceSwitcher />
        </div>
        <GlobalControls />
      </div>

      {/* Index (left) + detail */}
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-col w-72 min-h-0 border-r shrink-0 border-surface-border">
          <p className="px-3 py-2 text-[10px] font-semibold tracking-wider text-gray-500 uppercase border-b shrink-0 border-surface-border">
            Playlists
          </p>
          {userAccount && playlists.length > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-surface-border shrink-0">
              <svg className="w-3 h-3 text-gray-600 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="5" cy="5" r="3.5" />
                <path d="M8 8l2.5 2.5" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter playlists…"
                className="flex-1 min-w-0 bg-transparent text-[11px] text-gray-300 placeholder-gray-700 outline-none"
              />
              {query ? (
                <button type="button" onClick={() => setQuery('')} className="text-gray-600 transition-colors hover:text-gray-400 shrink-0" title="Clear filter">
                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M2 2l8 8M10 2l-8 8" />
                  </svg>
                </button>
              ) : null}
            </div>
          )}
          <div className="overflow-y-auto flex-1 min-h-0">
            {!userAccount ? (
              <p className="p-3 text-[11px] leading-relaxed text-gray-500">
                Sign in with your Music for Breathwork account (top-right) to see your playlists.
              </p>
            ) : playlists.length === 0 ? (
              <p className="p-3 text-[11px] text-gray-600">No playlists found.</p>
            ) : filtered.length === 0 ? (
              <p className="p-3 text-[11px] text-gray-600">No playlists match.</p>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPlaylist(p.id)}
                  className={`w-full shrink-0 text-left px-3 py-2.5 text-[12px] truncate border-b transition-colors border-surface-border/40 ${selectedPlaylistId === p.id ? 'bg-accent/15 text-accent' : 'text-gray-300 hover:bg-surface-hover'}`}
                >
                  {p.title}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-1 min-w-0">
          {selectedPlaylistId !== null ? (
            <PlaylistPanel />
          ) : (
            <div className="flex flex-1 justify-center items-center text-[11px] text-gray-600 select-none">
              {userAccount ? 'Select a playlist' : ''}
            </div>
          )}
        </div>
      </div>

      {/* Preview player (clip viewer + transport) — renders only while previewing */}
      <PlayerBar />
    </div>
  )
}
