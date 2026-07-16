import { useState, useEffect, useCallback, useRef } from 'react'
import type { SpotifySearchCandidate } from '../types'

interface Props {
  /** Seed the query and show a duration reference for the user to match against. */
  fileName: string
  artist: string
  folderArtist: string
  duration: number
  /** Apply the imported MFB track to the file; resolves when done. */
  onImported: (mfbTrackId: number) => Promise<void>
  onClose: () => void
}

function fmt(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Build a sensible default search from the filename + artist. */
function defaultQuery(fileName: string, artist: string, folderArtist: string): string {
  const title = fileName.replace(/\.[^.]+$/, '').replace(/^\d+[\s._-]+/, '').trim()
  return [artist || folderArtist, title].filter(Boolean).join(' ').trim()
}

/**
 * Search Music for Breathwork (via Spotify, server-side) and let the user pick
 * the exact track to import — auto-matching can't reliably disambiguate similar
 * tracks by one artist, so the human picks from Spotify's own ranked results.
 */
export function SpotifyImportModal({ fileName, artist, folderArtist, duration, onImported, onClose }: Props): JSX.Element {
  const [query, setQuery] = useState(() => defaultQuery(fileName, artist, folderArtist))
  const [candidates, setCandidates] = useState<SpotifySearchCandidate[]>([])
  const [status, setStatus] = useState<'idle' | 'searching' | 'error' | 'importing'>('searching')
  const [error, setError] = useState('')
  const [importingId, setImportingId] = useState<string | null>(null)
  const reqIdRef = useRef(0)

  const runSearch = useCallback(async (q: string): Promise<void> => {
    const term = q.trim()
    if (!term) { setCandidates([]); setStatus('idle'); return }
    const reqId = ++reqIdRef.current
    setStatus('searching')
    setError('')
    try {
      const { candidates: results, error: err } = await window.electronAPI.spotifySearch(term)
      if (reqId !== reqIdRef.current) return // a newer search superseded this one
      if (err) { setError('Music for Breathwork search is unavailable — try again shortly.'); setStatus('error'); return }
      setCandidates(results)
      setStatus('idle')
    } catch {
      if (reqId !== reqIdRef.current) return
      setError('Search failed — please try again.')
      setStatus('error')
    }
  }, [])

  // Initial search with the seeded query.
  useEffect(() => { runSearch(defaultQuery(fileName, artist, folderArtist)) }, [fileName, artist, folderArtist, runSearch])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function pick(c: SpotifySearchCandidate): Promise<void> {
    if (status === 'importing') return
    setStatus('importing')
    setImportingId(c.spotify_id)
    setError('')
    try {
      const res = await window.electronAPI.spotifyImport({ spotify_id: c.spotify_id })
      if (res?.id) {
        await onImported(res.id)
        onClose()
      } else {
        setError(res?.reason === 'exists_private'
          ? 'That track is privately owned by another user.'
          : 'Could not import that track.')
        setStatus('idle')
        setImportingId(null)
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : ''
      setError(m.includes('429') ? 'Music for Breathwork is busy — try again in a few seconds.' : 'Import failed — please try again.')
      setStatus('idle')
      setImportingId(null)
    }
  }

  return (
    <div className="flex fixed inset-0 z-[100] justify-center items-start pt-24 bg-black/50" onClick={onClose}>
      <div
        className="w-[440px] max-w-[90vw] max-h-[70vh] flex flex-col bg-surface-panel border border-surface-border rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-4 py-3 border-b border-surface-border shrink-0">
          <div className="min-w-0">
            <h2 className="text-[12px] font-medium text-gray-200">Find on Music for Breathwork</h2>
            <p className="text-[10px] text-gray-500 truncate">Your file: {fmt(duration)} · {fileName}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-300 shrink-0 ml-2" title="Close">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13" /></svg>
          </button>
        </div>

        {/* Search box */}
        <form
          className="flex gap-2 items-center px-4 py-2.5 border-b border-surface-border shrink-0"
          onSubmit={(e) => { e.preventDefault(); runSearch(query) }}
        >
          <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="7" cy="7" r="4.5" /><path d="M11 11l3 3" />
          </svg>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by artist and title…"
            className="flex-1 min-w-0 bg-transparent text-[12px] text-gray-200 placeholder-gray-600 outline-none"
          />
          <button type="submit" className="px-2 py-1 text-[10px] rounded border border-surface-border text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors shrink-0">
            Search
          </button>
        </form>

        {/* Results */}
        <div className="overflow-y-auto flex-1 min-h-0">
          {status === 'searching' && <p className="px-4 py-4 text-[11px] text-gray-500">Searching…</p>}
          {status === 'error' && <p className="px-4 py-4 text-[11px] text-yellow-500">{error}</p>}
          {status !== 'searching' && status !== 'error' && candidates.length === 0 && (
            <p className="px-4 py-4 text-[11px] text-gray-500">No results — try refining the search.</p>
          )}
          {candidates.map((c) => {
            const isImporting = importingId === c.spotify_id
            const closeDur = c.duration != null && Math.abs(c.duration - duration) <= 2
            return (
              <button
                key={c.spotify_id}
                type="button"
                disabled={status === 'importing'}
                onClick={() => pick(c)}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-surface-hover transition-colors disabled:opacity-50 border-b border-surface-border/40"
              >
                {c.image_url
                  ? <img src={c.image_url} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                  : <div className="w-8 h-8 rounded bg-surface-hover shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-gray-200 truncate">{c.title}</p>
                  <p className="text-[10px] text-gray-500 truncate">{c.artist}{c.album ? ` · ${c.album}` : ''}</p>
                </div>
                <span className={`text-[10px] tabular-nums shrink-0 ${closeDur ? 'text-accent' : 'text-gray-500'}`} title={closeDur ? 'Duration matches your file' : undefined}>
                  {isImporting ? 'Importing…' : fmt(c.duration)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
