import { useState, useEffect, useRef, useCallback } from 'react'
import { BREATHWORK_PHASES, mfbTrackUrl } from '../types'
import type { BreathworkPhase, MfbAudioFeatures } from '../types'
import { useLibraryStore } from '../store/libraryStore'
import type { MfbRankResult } from '../../../../preload/index.d'

interface ApiArtist { id: number; name: string }
interface ApiAlbum { id: number; title: string; image_url: string }
interface ApiTag { id: number; name: string; slug: { en: string } }
interface SearchResult { id: number; title: string; artist: string; album: string }

interface TrackDetail {
  id: number
  title: string
  description: string
  preview_url: string | null
  artists: ApiArtist[]
  album: ApiAlbum
  tags: Record<string, ApiTag[]>
  audio_features?: MfbAudioFeatures
  bandcamp_url?: string
  beatport_url?: string
  apple_music_url?: string
}

const VALID_PHASES = new Set(BREATHWORK_PHASES.map((p) => p.value))

function toPhase(slug: string | undefined): BreathworkPhase | null {
  return slug && VALID_PHASES.has(slug as BreathworkPhase) ? (slug as BreathworkPhase) : null
}

interface Props {
  fileId: string
  fileName: string
  artist: string
  folderArtist: string
  folderAlbum: string
  alreadyMatched?: boolean
}

type Status = 'loading' | 'idle' | 'fetching' | 'done' | 'error'

export function TrackLookup({ fileId, fileName, artist, folderArtist, folderAlbum, alreadyMatched }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(!alreadyMatched)
  const [status, setStatus] = useState<Status>(alreadyMatched ? 'idle' : 'loading')
  const [results, setResults] = useState<MfbRankResult[]>([])
  const [detail, setDetail] = useState<TrackDetail | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updateFile = useLibraryStore((s) => s.updateFile)
  const userAccount = useLibraryStore((s) => s.userAccount)
  const setShowLoginModal = useLibraryStore((s) => s.setShowLoginModal)

  useEffect(() => {
    if (!expanded) return
    setStatus('loading')
    setResults([])
    setDetail(null)
    setErrorMsg('')
    setSearchQuery('')
    setSearchResults([])
    window.electronAPI
      .mfbRankMatches({ id: fileId, filename: fileName, artist, folder_artist: folderArtist, folder_album: folderAlbum })
      .then((res) => { setResults(res); setStatus('idle') })
      .catch((e) => { setErrorMsg(String(e)); setStatus('error') })
  }, [expanded, fileId, fileName, artist, folderArtist, folderAlbum])

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    const q = searchQuery.trim()
    if (!q) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await window.electronAPI.mfbCatalogueSearch(q) as SearchResult[]
        setSearchResults(res)
      } catch { setSearchResults([]) }
      finally { setSearching(false) }
    }, 350)
  }, [searchQuery])

  async function selectResult(id: number): Promise<void> {
    setStatus('fetching')
    setDetail(null)
    setErrorMsg('')
    try {
      const data = (await window.electronAPI.mfbGetTrack(id)) as TrackDetail
      setDetail(data)
      setStatus('done')
    } catch (e) {
      setErrorMsg(String(e))
      setStatus('error')
    }
  }

  function apply(): void {
    if (!detail) return
    const artistName = detail.artists.map((a) => a.name).join(', ')
    const albumName = detail.album.title
    const tags = Object.values(detail.tags).flat().map((t) => t.name)
    const hourSlug = detail.tags['Hour']?.[0]?.slug?.en
    const breathworkPhase = toPhase(hourSlug)
    updateFile(fileId, {
      artist: artistName,
      album: albumName,
      tags,
      notes: detail.description ?? '',
      trackTitle: detail.title,
      mfbTrackId: detail.id,
      mfbApplied: true,
      appliedPathGuess: true,
      audioFeatures: detail.audio_features ?? null,
      bandcampUrl: detail.bandcamp_url ?? null,
      beatportUrl: detail.beatport_url ?? null,
      appleMusicUrl: detail.apple_music_url ?? null,
      ...(breathworkPhase !== null ? { breathworkPhase } : {}),
    })
    setDetail(null)
    setStatus('idle')
  }

  const busy = status === 'loading' || status === 'fetching'

  if (!userAccount) {
    return (
      <div className="flex flex-col gap-2.5 p-3 border-b border-surface-border">
        <span className="text-[10px] text-gray-600 uppercase tracking-wider font-medium">Music for Breathwork Match</span>
        <div className="flex flex-col gap-2 rounded border border-surface-border bg-surface-base/50 px-3 py-3">
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Sign in to match this track against the Music for Breathwork catalogue and unlock phase tags, audio features, and artist data.
          </p>
          <button
            type="button"
            onClick={() => setShowLoginModal(true)}
            className="self-start text-[10px] text-accent hover:text-accent/70 transition-colors underline underline-offset-2"
          >
            Sign in to Music for Breathwork →
          </button>
        </div>
      </div>
    )
  }

  if (!expanded) {
    return (
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-border">
        <span className="text-[10px] text-gray-600 uppercase tracking-wider font-medium">Music for Breathwork Match</span>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[10px] text-gray-600 hover:text-accent transition-colors"
        >
          Find a different match →
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3 border-b border-surface-border">
      <div className="flex flex-col gap-1">
        <div className="flex justify-between items-center">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="flex items-center gap-1 text-[10px] text-gray-500 uppercase tracking-wider font-medium hover:text-gray-300 transition-colors group"
            title="Collapse"
          >
            <svg className="w-2.5 h-2.5 text-gray-600 group-hover:text-gray-400 transition-colors" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 6.5l3-3 3 3" />
            </svg>
            Music for Breathwork Match
          </button>
          <div className="flex items-center gap-2">
            {status === 'idle' && results.length > 0 && !detail && (
              <button
                type="button"
                onClick={() => {
                  setStatus('loading')
                  setResults([])
                  window.electronAPI
                    .mfbRankMatches({ id: fileId, filename: fileName, artist, folder_artist: folderArtist, folder_album: folderAlbum })
                    .then((res) => { setResults(res); setStatus('idle') })
                    .catch((e) => { setErrorMsg(String(e)); setStatus('error') })
                }}
                className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
              >
                Re-run
              </button>
            )}
            {detail && (
              <button
                type="button"
                onClick={() => { setDetail(null); setStatus('idle') }}
                className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
              >
                ← Back
              </button>
            )}
          </div>
        </div>
        {!detail && status !== 'loading' && (
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Possible matches from the Music for Breathwork catalogue.<br />click one to apply its metadata to this file.
          </p>
        )}
      </div>

      {busy && (
        <div className="flex gap-2 items-center py-1">
          <svg className="w-3 h-3 text-gray-600 animate-spin shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M6 1v2M6 9v2M1 6h2M9 6h2" strokeLinecap="round" />
            <path d="M2.5 2.5l1.4 1.4M8.1 8.1l1.4 1.4M9.5 2.5L8.1 3.9M3.9 8.1L2.5 9.5" strokeLinecap="round" opacity="0.4" />
          </svg>
          <span className="text-[10px] text-gray-600">{status === 'fetching' ? 'Loading…' : 'Matching…'}</span>
        </div>
      )}

      {status === 'error' && (
        <p className="text-[10px] text-red-400 leading-snug">{errorMsg}</p>
      )}

      {/* Search input — visible when ranked results are in and not showing detail */}
      {!detail && status !== 'loading' && (
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search catalogue by title or artist…"
            className="w-full text-[11px] bg-surface-hover border border-surface-border rounded px-2.5 py-1.5 outline-none focus:border-accent/50 text-gray-200 placeholder-gray-600"
          />
          {searching && (
            <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-600 animate-spin" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 1v2M6 9v2M1 6h2M9 6h2" strokeLinecap="round" />
              <path d="M2.5 2.5l1.4 1.4M8.1 8.1l1.4 1.4M9.5 2.5L8.1 3.9M3.9 8.1L2.5 9.5" strokeLinecap="round" opacity="0.4" />
            </svg>
          )}
          {searchQuery && !searching && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors"
            >
              <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2l6 6M8 2l-6 6" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Search results */}
      {searchQuery && !searching && searchResults.length > 0 && !detail && (
        <div className="flex overflow-hidden overflow-y-auto flex-col max-h-52 rounded border divide-y border-surface-border divide-surface-border">
          {searchResults.map((r) => (
            <ResultRow key={r.id} title={r.title} sub={`${r.artist} · ${r.album}`} onSelect={() => selectResult(r.id)} />
          ))}
        </div>
      )}

      {searchQuery && !searching && searchResults.length === 0 && !detail && (
        <p className="text-[10px] text-gray-500">No results for &ldquo;{searchQuery}&rdquo;</p>
      )}

      {/* Ranked results (shown when no search query) */}
      {!searchQuery && status === 'idle' && results.length === 0 && !detail && (
        <p className="text-[10px] text-gray-500">No automatic matches — try searching above</p>
      )}

      {!searchQuery && results.length > 0 && !detail && status === 'idle' && (
        <div className="flex overflow-hidden overflow-y-auto flex-col max-h-52 rounded border divide-y border-surface-border divide-surface-border">
          {results.map((r) => (
            <ResultRow key={r.id} title={r.title} sub={`${r.artist} · ${r.album}`} score={r.score} onSelect={() => selectResult(r.id)} />
          ))}
        </div>
      )}

      {detail && status === 'done' && (
        <div className="flex flex-col gap-2 p-2 rounded border border-surface-border bg-surface-hover/50">
          <div className="flex flex-col gap-1">
            <DetailRow label="Title" value={detail.title} />
            <DetailRow label="Artist" value={detail.artists.map((a) => a.name).join(', ')} />
            <DetailRow label="Album" value={detail.album.title} />
          </div>

          {Object.entries(detail.tags).map(([cat, tags]) => (
            <div key={cat} className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-600 uppercase tracking-wider">{cat}</span>
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <span
                    key={t.id}
                    className="px-1.5 py-0.5 text-[10px] rounded bg-surface-panel border border-surface-border text-gray-400"
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            </div>
          ))}

          {detail.description && (
            <p className="text-[10px] text-gray-600 leading-relaxed line-clamp-3">{detail.description}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={apply}
              className="flex-1 py-1.5 text-[11px] rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              Apply to Track
            </button>
            <button
              type="button"
              onClick={() => window.open(mfbTrackUrl(detail.id, detail.title))}
              title="View on Music for Breathwork"
              className="px-2.5 py-1.5 text-[11px] rounded border border-surface-border text-gray-400 hover:text-gray-200 hover:bg-surface-hover transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8A1.5 1.5 0 0 0 13 12.5V9M9.5 2H14v4.5M14 2L7.5 8.5" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ResultRow({ title, sub, score, onSelect }: { title: string; sub: string; score?: number; onSelect: () => void }): JSX.Element {
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex gap-2 items-start px-2 py-2 text-left transition-colors hover:bg-accent/10"
    >
      <div className="flex-1 min-w-0">
        <div
          className="flex items-center min-w-0"
          onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTooltipPos({ x: r.left, y: r.top }) }}
          onMouseLeave={() => setTooltipPos(null)}
        >
          <p className="text-[11px] text-gray-300 truncate flex-1 min-w-0">{title}</p>
          {tooltipPos && (
            <div
              className="fixed z-[999] bg-black rounded p-2 text-[10px] text-gray-200 shadow-lg pointer-events-none border border-white/10 max-w-xs"
              style={{ left: tooltipPos.x, top: tooltipPos.y - 8, transform: 'translateY(-100%)' }}
            >
              <div className="font-medium break-all">{title}</div>
              <div className="text-gray-400 mt-0.5 break-all">{sub}</div>
            </div>
          )}
        </div>
        <p className="text-[10px] text-gray-600 truncate">{sub}</p>
      </div>
      {score !== undefined && (
        <span className="text-[9px] text-gray-600 font-mono tabular-nums pt-0.5 shrink-0">
          {Math.round(score * 100)}%
        </span>
      )}
    </button>
  )
}

function DetailRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex gap-2 justify-between items-baseline">
      <span className="text-[10px] text-gray-600 uppercase tracking-wider shrink-0">{label}</span>
      <span className="text-[11px] text-gray-300 text-right truncate">{value}</span>
    </div>
  )
}
