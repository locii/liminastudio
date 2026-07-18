import { useEffect, useMemo, useState, useCallback } from 'react'
import { useLibraryStore } from '../../../library/store/libraryStore'
import type { LibraryFile } from '../../../library/types'
import { useSessionStore } from '../../store/sessionStore'
import { useTransportStore } from '../../store/transportStore'
import { useToastStore } from '../../store/toastStore'

// Ensure the catalogue is loaded once per app run, even if the user opens Mix
// before ever visiting Library (Library's App loads it on its own mount).
let catalogueEnsured = false
async function ensureCatalogue(): Promise<void> {
  if (catalogueEnsured) return
  catalogueEnsured = true
  try {
    const { data } = await window.electronAPI.loadCatalogue()
    if (data && useLibraryStore.getState().files.length === 0) {
      useLibraryStore.getState().loadCatalogue(data)
    }
  } catch { /* leave empty; user can add folders in Library */ }
}

function fmtDuration(sec: number): string {
  if (!sec || !Number.isFinite(sec)) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function displayTitle(f: LibraryFile): string {
  return f.trackTitle || f.fileName.replace(/\.[^.]+$/, '')
}

/**
 * Collapsible library browser docked in the Mix view — a searchable,
 * tag-filterable list of catalogue tracks you can drag onto the timeline.
 * (Mix's TimelineTrack already ingests the native file drag + MFB enrichment.)
 */
const TARGET_PEAK_LINEAR = Math.pow(10, -0.5 / 20)
function peaksForClip(duration: number, zoom: number): number {
  return Math.min(Math.ceil(duration * zoom), 50_000)
}

export function LibraryDock({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element | null {
  const [query, setQuery] = useState('')
  // Local filter state — independent of Library's own browse filter.
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState('')
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())

  const addToABTracks = useSessionStore((s) => s.addToABTracks)
  const setWaveform = useSessionStore((s) => s.setWaveform)
  const updateClip = useSessionStore((s) => s.updateClip)
  const updateClipSilent = useSessionStore((s) => s.updateClipSilent)
  const toast = useToastStore((s) => s.add)

  const handleAdd = useCallback(async (f: LibraryFile) => {
    const zoom = useTransportStore.getState().zoom
    const name = (f.trackTitle || f.fileName).replace(/\.[^.]+$/, '')

    // Compute cue points upfront so fadeIn can inform the placement startTime
    const hasCues = f.clipStartMs != null || f.clipEndMs != null || f.introEndMs != null || f.outroStartMs != null
    const clipStartSec = (f.clipStartMs ?? 0) / 1000
    const clipEndSec = f.clipEndMs != null ? f.clipEndMs / 1000 : f.duration
    const fadeIn = hasCues && f.introEndMs != null ? Math.max(0, f.introEndMs / 1000 - clipStartSec) : 0

    const { clip } = addToABTracks({ name, filePath: f.filePath, duration: f.duration, fadeIn })

    if (hasCues) {
      updateClipSilent(clip.id, {
        trimStart: clipStartSec,
        trimEnd: Math.max(0, f.duration - clipEndSec),
        fadeIn,
        fadeOut: f.outroStartMs != null ? Math.max(0, clipEndSec - f.outroStartMs / 1000) : 0,
        fadeInCurve: f.fadeInCurve,
        fadeOutCurve: f.fadeOutCurve,
      })
    }

    setAddedIds((prev) => new Set(prev).add(f.id))
    setTimeout(() => setAddedIds((prev) => { const next = new Set(prev); next.delete(f.id); return next }), 1200)
    window.electronAPI
      .getWaveformPeaks(f.filePath, peaksForClip(f.duration, zoom))
      .then((peaks) => setWaveform(f.filePath, { peaks, loading: false }))
      .catch(() => setWaveform(f.filePath, { peaks: [], loading: false }))
    window.electronAPI
      .getPeakLevel(f.filePath)
      .then((peak) => { if (peak > 0) updateClip(clip.id, { volume: Math.min(2, TARGET_PEAK_LINEAR / peak) }) })
      .catch(() => {})
    window.electronAPI
      .lookupLibraryFile(f.filePath)
      .then((data) => {
        if (data) updateClip(clip.id, {
          mfbTrackId: data.mfbTrackId,
          mfbTrackTitle: data.trackTitle || undefined,
          mfbArtist: data.artist || undefined,
          mfbAlbumImageUrl: data.albumImageUrl ?? undefined,
          mfbTags: data.tags,
          mfbBreathworkPhase: data.breathworkPhase,
        })
      })
      .catch(() => {})
    toast(`Added "${f.trackTitle || f.fileName}"`, 'success', 2000)
  }, [addToABTracks, setWaveform, updateClip, updateClipSilent, toast])
  // Cap the number of rendered rows (lazy-loaded on scroll). Rendering the whole
  // catalogue at once makes a huge sibling chain that overflows React Fast
  // Refresh's recursive fiber walk on hot-reload.
  const [visibleCount, setVisibleCount] = useState(100)
  const files = useLibraryStore((s) => s.files)
  const toggleSelectedTag = (t: string): void =>
    setSelectedTags((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]))
  const clearSelectedTags = (): void => setSelectedTags([])

  useEffect(() => { ensureCatalogue() }, [])
  useEffect(() => { setVisibleCount(100) }, [query, selectedTags])

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of files) for (const t of f.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [files])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return files.filter((f) => {
      if (!f.filePath) return false
      if (selectedTags.length > 0 && !selectedTags.every((t) => f.tags.includes(t))) return false
      if (q) {
        const hay = `${displayTitle(f)} ${f.artist}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [files, selectedTags, query])

  if (!open) return null

  return (
    <div className="flex flex-col w-64 min-h-0 border-l shrink-0 bg-surface-panel border-surface-border">
      {/* Header */}
      <div className="flex items-center justify-between h-8 px-2 border-b shrink-0 border-surface-border">
        <span className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase select-none pl-1">Library</span>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          title="Hide library"
          className="flex items-center justify-center w-5 h-5 text-gray-500 transition-colors rounded hover:text-gray-200 hover:bg-surface-hover"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>

      {/* Search */}
      <div className="p-2 border-b shrink-0 border-surface-border">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title or artist…"
          className="w-full px-2 py-1 text-[11px] text-gray-200 rounded border bg-surface-border border-surface-border placeholder:text-gray-600 focus:outline-none focus:border-accent/50"
        />
      </div>

      {/* Tag filter — add/remove tags (same pattern as session mode) */}
      <div className="p-2 border-b shrink-0 border-surface-border">
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedTags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-accent/15 border border-accent/30 text-[11px] text-accent">
              {tag}
              <button type="button" onClick={() => toggleSelectedTag(tag)} className="opacity-60 hover:opacity-100" aria-label={`Remove ${tag}`}>
                <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l6 6M8 2l-6 6" /></svg>
              </button>
            </span>
          ))}
          <button type="button" onClick={() => setPickerOpen((v) => !v)}
            className="inline-flex items-center gap-1 pl-2 pr-2.5 py-1 rounded-full border border-dashed border-surface-border text-[11px] text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
            title={pickerOpen ? 'Close tag panel' : 'Filter by tags'}>
            <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">{pickerOpen ? <path d="M2 2l6 6M8 2l-6 6" /> : <path d="M5 1v8M1 5h8" />}</svg>
            {pickerOpen ? 'Close tags' : 'Add tag'}
          </button>
          {selectedTags.length > 0 && (
            <button type="button" onClick={clearSelectedTags} className="ml-auto text-[10px] text-gray-600 hover:text-gray-400 transition-colors">Clear</button>
          )}
        </div>

        {pickerOpen && (
          <div className="mt-2 border rounded border-surface-border bg-surface-base">
            <input
              type="text" autoFocus value={tagQuery} onChange={(e) => setTagQuery(e.target.value)} placeholder="Filter tags…"
              className="w-full bg-transparent px-2.5 py-1.5 text-[11px] text-gray-300 placeholder-gray-700 outline-none border-b border-surface-border"
            />
            <div className="py-1 overflow-y-auto max-h-40">
              {tagCounts.length === 0 ? (
                <p className="px-2.5 py-1 text-[10px] leading-relaxed text-gray-600">Tags appear once tracks are matched to Music for Breathwork in the Library.</p>
              ) : (
                tagCounts
                  .filter(([t]) => !selectedTags.includes(t) && t.toLowerCase().includes(tagQuery.toLowerCase()))
                  .slice(0, 60)
                  .map(([tag, count]) => (
                    <button
                      key={tag} type="button"
                      onClick={() => { toggleSelectedTag(tag); setTagQuery('') }}
                      className="w-full flex items-center justify-between px-2.5 py-1 text-left text-[11px] text-gray-400 hover:bg-surface-hover hover:text-gray-200 transition-colors"
                    >
                      <span className="truncate">{tag}</span><span className="text-[10px] text-gray-600 tabular-nums ml-2">{count}</span>
                    </button>
                  ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* File list */}
      <div
        className="flex-1 min-h-0 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) {
            setVisibleCount((c) => (c < visible.length ? c + 100 : c))
          }
        }}
      >
        {files.length === 0 ? (
          <p className="p-3 text-[10px] leading-relaxed text-gray-600 text-center">Your library is empty. Add folders in the Library view.</p>
        ) : visible.length === 0 ? (
          <p className="p-3 text-[10px] text-gray-600 text-center">No tracks match.</p>
        ) : (
          visible.slice(0, visibleCount).map((f) => {
            const justAdded = addedIds.has(f.id)
            return (
            <div
              key={f.id}
              draggable
              onDragStart={(e) => { e.preventDefault(); window.electronAPI.startDrag(f.filePath) }}
              title={`Drag onto a track\n${f.filePath}`}
              className="group flex items-center gap-1.5 px-2 py-1.5 border-b cursor-grab border-surface-border/40 hover:bg-surface-hover active:cursor-grabbing"
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void handleAdd(f) }}
                title="Add as new track"
                className={`shrink-0 w-4 h-4 flex items-center justify-center rounded transition-colors ${justAdded ? 'text-accent' : 'text-gray-600 hover:text-accent'}`}
              >
                {justAdded ? (
                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M6 2v8M2 6h8" />
                  </svg>
                )}
              </button>
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <span className="text-[10px] text-gray-200 truncate">{displayTitle(f)}</span>
                <span className="text-[10px] text-gray-500 truncate">{f.artist || '—'} · {fmtDuration(f.duration)}</span>
              </div>
            </div>
            )
          })
        )}
      </div>

      {files.length > 0 && (
        <div className="px-2.5 py-1 border-t text-[10px] text-gray-600 border-surface-border shrink-0">
          {visible.length} of {files.length}
        </div>
      )}
    </div>
  )
}
