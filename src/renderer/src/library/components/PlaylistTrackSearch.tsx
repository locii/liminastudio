import { useEffect, useState } from 'react'
import { useLibraryStore } from '../store/libraryStore'
import type { PlaylistTrackSearchResult } from '../types'
import { appleMusicDeepLink } from '../types'

function formatDuration(ms: number): string {
  if (!ms) return '—'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function PlaylistTrackSearch(): JSX.Element {
  const query = useLibraryStore((s) => s.playlistTrackQuery)
  const setPlaylistTrackQuery = useLibraryStore((s) => s.setPlaylistTrackQuery)
  const selectPlaylist = useLibraryStore((s) => s.selectPlaylist)
  const allFiles = useLibraryStore((s) => s.files)

  const [results, setResults] = useState<PlaylistTrackSearchResult[]>([])
  const [loading, setLoading] = useState(false)

  const inLibraryIds = new Set(
    allFiles.filter((f) => f.mfbTrackId !== null).map((f) => f.mfbTrackId!)
  )

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const data = await window.electronAPI.searchPlaylistTracks(query)
        setResults(data)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => { clearTimeout(t); setLoading(false) }
  }, [query])

  function handlePlaylistClick(id: number): void {
    selectPlaylist(id)
    setPlaylistTrackQuery('')
  }

  return (
    <div className="flex overflow-hidden flex-col flex-1 min-w-0">
      {/* Header */}
      <div className="flex gap-2 items-center px-4 h-10 border-b shrink-0 border-surface-border bg-surface-panel">
        <svg className="w-3.5 h-3.5 text-gray-600 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5" cy="5" r="3.5" />
          <path d="M8 8l2.5 2.5" />
        </svg>
        <span className="text-[11px] text-gray-400 flex-1 min-w-0 truncate">
          {loading ? 'Searching…' : results.length > 0 ? `${results.length} track${results.length === 1 ? '' : 's'} found` : query.trim() ? 'No tracks found' : 'Find a track across all playlists'}
        </span>
        {loading && (
          <svg className="w-3 h-3 text-gray-600 animate-spin shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M6 1v2M6 9v2M1 6h2M9 6h2" />
          </svg>
        )}
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-2 px-3 h-7 border-b shrink-0 border-surface-border bg-surface-panel text-[10px] uppercase tracking-wider text-gray-600 select-none">
        <span className="w-5 shrink-0" />
        <span className="flex-1 min-w-0">Title</span>
        <span className="hidden w-28 shrink-0 sm:block">Artist</span>
        <span className="w-10 text-right shrink-0">Dur</span>
      </div>

      {/* Results */}
      <div className="overflow-y-auto flex-1 min-h-0">
        {!query.trim() ? (
          <p className="px-4 py-6 text-[11px] text-gray-600 text-center">
            Type a track name in the sidebar to search
          </p>
        ) : !loading && results.length === 0 ? (
          <p className="px-4 py-6 text-[11px] text-gray-600 text-center">No tracks found</p>
        ) : results.map((track) => {
          const inLibrary = inLibraryIds.has(track.id)
          return (
            <div
              key={track.id}
              className="flex flex-col px-3 py-2 border-b border-surface-border/50 hover:bg-surface-hover transition-colors"
            >
              <div className="flex items-center gap-2">
                {/* Album thumbnail */}
                <div className="overflow-hidden relative w-5 h-5 rounded shrink-0 bg-surface-hover">
                  {track.album_image_url ? (
                    <img src={track.album_image_url} alt="" className="object-cover w-full h-full" />
                  ) : (
                    <div className="w-full h-full" />
                  )}
                </div>

                {/* Title */}
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <span className="text-[11px] text-gray-300 truncate">{track.title}</span>
                  {inLibrary && (
                    <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent" title="In library" />
                  )}
                </div>

                {/* Artist */}
                <span className="hidden w-28 shrink-0 text-[10px] text-gray-600 truncate sm:block">{track.artist}</span>

                {/* Duration */}
                <span className="w-10 shrink-0 text-right text-[10px] text-gray-600 tabular-nums">
                  {track.duration ? formatDuration(track.duration) : '—'}
                </span>
              </div>

              {/* Playlist chips + buy links */}
              <div className="flex flex-wrap gap-1 mt-1.5 pl-7">
                {track.playlists.map((pl) => (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => handlePlaylistClick(pl.id)}
                    className="px-1.5 py-px text-[9px] rounded border border-surface-border text-gray-500 hover:text-gray-200 hover:border-gray-500 transition-colors leading-tight truncate max-w-[140px]"
                    title={pl.title}
                  >
                    {pl.title}
                  </button>
                ))}
                {!inLibrary && track.bandcamp_url && (
                  <button
                    type="button"
                    onClick={() => window.open(track.bandcamp_url!)}
                    className="px-1.5 py-px text-[9px] font-medium rounded border transition-colors text-[#1da0c3] border-[#1da0c3]/40 bg-[#1da0c3]/10 hover:bg-[#1da0c3]/20 leading-tight"
                  >
                    Bandcamp
                  </button>
                )}
                {!inLibrary && track.beatport_url && (
                  <button
                    type="button"
                    onClick={() => window.open(track.beatport_url!)}
                    className="px-1.5 py-px text-[9px] font-medium rounded border transition-colors text-[#97f04f] border-[#97f04f]/40 bg-[#97f04f]/10 hover:bg-[#97f04f]/20 leading-tight"
                  >
                    Beatport
                  </button>
                )}
                {!inLibrary && track.apple_music_url && (
                  <button
                    type="button"
                    onClick={() => window.open(appleMusicDeepLink(track.apple_music_url!))}
                    className="px-1.5 py-px text-[9px] font-medium rounded border transition-colors text-[#fc3c44] border-[#fc3c44]/40 bg-[#fc3c44]/10 hover:bg-[#fc3c44]/20 leading-tight"
                  >
                    Apple Music
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
