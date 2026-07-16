import { useEffect, useMemo, useState } from 'react'
import { useLibraryStore } from '../../../library/store/libraryStore'
import { phaseColorForTag } from '../../../library/types'
import type { LibraryFile } from '../../../library/types'

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
export function LibraryDock(): JSX.Element {
  const [open, setOpen] = useState(true)
  const [query, setQuery] = useState('')
  // Local filter state — independent of Library's own browse filter.
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const files = useLibraryStore((s) => s.files)
  const toggleSelectedTag = (t: string): void =>
    setSelectedTags((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]))
  const clearSelectedTags = (): void => setSelectedTags([])

  useEffect(() => { ensureCatalogue() }, [])

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

  if (!open) {
    return (
      <div className="flex flex-col items-center py-2 w-8 border-r shrink-0 bg-surface-panel border-surface-border">
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Show library"
          className="flex justify-center items-center w-6 h-6 text-gray-400 rounded transition-colors hover:text-gray-100 hover:bg-surface-hover"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5h11l3 3v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" /><path d="M7 9h7M7 12h7M7 15h4" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col w-64 border-r shrink-0 bg-surface-panel border-surface-border min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between h-8 px-2 border-b shrink-0 border-surface-border">
        <span className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase select-none pl-1">Library</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          title="Hide library"
          className="flex justify-center items-center w-5 h-5 text-gray-500 rounded transition-colors hover:text-gray-200 hover:bg-surface-hover"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
      </div>

      {/* Search */}
      <div className="p-2 border-b shrink-0 border-surface-border">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title or artist…"
          className="w-full px-2 py-1 text-[11px] text-gray-200 rounded border bg-surface-base border-surface-border placeholder:text-gray-600 focus:outline-none focus:border-accent/50"
        />
      </div>

      {/* Tag filter */}
      <div className="p-2 border-b shrink-0 border-surface-border max-h-32 overflow-y-auto">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] font-semibold tracking-wider text-gray-600 uppercase">Tags</span>
          {selectedTags.length > 0 && (
            <button type="button" onClick={clearSelectedTags} className="text-[9px] text-gray-500 hover:text-gray-300">clear</button>
          )}
        </div>
        {tagCounts.length === 0 ? (
          <p className="text-[10px] leading-relaxed text-gray-600">Tags appear once tracks are matched to Music for Breathwork in the Library.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {tagCounts.map(([tag, count]) => {
              const active = selectedTags.includes(tag)
              const phase = phaseColorForTag(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleSelectedTag(tag)}
                  className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${active ? 'border-accent bg-accent/20 text-accent' : 'border-surface-border text-gray-400 hover:bg-surface-hover'}`}
                  style={phase && !active ? { color: phase, borderColor: `${phase}55` } : undefined}
                >
                  {tag} <span className="opacity-50">{count}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {files.length === 0 ? (
          <p className="p-3 text-[10px] leading-relaxed text-gray-600 text-center">Your library is empty. Add folders in the Library view.</p>
        ) : visible.length === 0 ? (
          <p className="p-3 text-[10px] text-gray-600 text-center">No tracks match.</p>
        ) : (
          visible.map((f) => (
            <div
              key={f.id}
              draggable
              onDragStart={(e) => { e.preventDefault(); window.electronAPI.startDrag(f.filePath) }}
              title={`Drag onto a track\n${f.filePath}`}
              className="flex flex-col gap-0.5 px-2.5 py-1.5 border-b cursor-grab border-surface-border/40 hover:bg-surface-hover active:cursor-grabbing"
            >
              <span className="text-[11px] text-gray-200 truncate">{displayTitle(f)}</span>
              <span className="text-[10px] text-gray-500 truncate">{f.artist || '—'} · {fmtDuration(f.duration)}</span>
            </div>
          ))
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
