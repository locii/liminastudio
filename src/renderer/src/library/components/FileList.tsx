import type { CSSProperties } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'

interface ContextMenuState {
  fileId: string
  filePath: string
  x: number
  y: number
}
import {
  albumGuessPendingItalic,
  albumSortKey,
  artistGuessPendingItalic,
  artistSortKey,
  displayedAlbum,
  displayedArtist,
  hasPendingPathGuess,
} from '../lib/libraryTrackDisplay'
import type { LibraryFile, MfbPlaylistTrack } from '../types'
import { mfbTrackUrl, phaseColorForTag } from '../types'
import { useLibraryStore } from '../store/libraryStore'
import { syncLibraryToMfb } from '../lib/syncLibrary'
import { analyzeFileFeatures, analyzingFeatureIds, subscribeAnalyzing } from '../lib/featureScan'

const COLUMN_STORAGE_KEY = 'library-file-list-column-widths-v7'
const GRIP_PX = 8
const ROW_HEIGHT = 36
const OVERSCAN = 5
const TABLE_HORIZONTAL_PADDING = 24 // px-3 each side

const HOUR_TAGS = new Set([
  'call to adventure', 'jumpstart', 'first hour', 'second hour transition',
  'second hour', 'breakthrough tension', 'breakthrough', 'breakthrough release',
  'third hour transition', 'third hour',
])

function hourTagsForFile(tags: readonly string[]): string[] {
  return tags.filter((t) => HOUR_TAGS.has(t.toLowerCase()))
}

type ColumnWidths = {
  name: number
  artist: number
  album: number
  intensity: number
  affective: number
  activation: number
  spaciousness: number
  tension: number
  energy: number
  valence: number
  danceability: number
  duration: number
  hour: number
  format: number
  size: number
  added: number
}

const COLUMN_DEFAULTS: ColumnWidths = {
  name: 300,
  artist: 200,
  album: 200,
  hour: 350, // overridden by auto-fit until user drags
  intensity: 70,
  affective: 70,
  activation: 78,
  spaciousness: 92,
  tension: 60,
  energy: 56,
  valence: 60,
  danceability: 92,
  duration: 68,
  format: 60,
  size: 64,
  added: 72,
}

const COLUMN_MIN: ColumnWidths = {
  name: 120,
  artist: 60,
  album: 60,
  hour: 60,
  intensity: 32,
  affective: 32,
  activation: 32,
  spaciousness: 32,
  tension: 32,
  energy: 32,
  valence: 32,
  danceability: 32,
  duration: 42,
  format: 32,
  size: 46,
  added: 52,
}

// Width needed for the hour cell to show all chips inline.
// Each chip: ~5.5px/char + 10px h-padding + 2px border; gap: 4px between chips; cell: 8px h-padding.
function hourCellWidth(tags: readonly string[]): number {
  if (tags.length === 0) return 0
  let w = 8
  for (let i = 0; i < tags.length; i++) {
    w += tags[i].length * 5.5 + 12
    if (i > 0) w += 4
  }
  return Math.ceil(w)
}

type StoredWidths = ColumnWidths & { hourUserSet?: boolean }

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function readStoredColumnWidths(): StoredWidths {
  if (typeof localStorage === 'undefined') return { ...COLUMN_DEFAULTS, hourUserSet: false }
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY)
    if (!raw) return { ...COLUMN_DEFAULTS, hourUserSet: false }
    const p = JSON.parse(raw) as Partial<Record<keyof StoredWidths, unknown>>
    const next: StoredWidths = { ...COLUMN_DEFAULTS, hourUserSet: false }
    for (const k of Object.keys(COLUMN_DEFAULTS) as (keyof ColumnWidths)[]) {
      const v = p[k]
      if (typeof v === 'number' && Number.isFinite(v)) next[k] = Math.round(v)
    }
    if (typeof p.hourUserSet === 'boolean') next.hourUserSet = p.hourUserSet
    return next
  } catch {
    return { ...COLUMN_DEFAULTS, hourUserSet: false }
  }
}

const GRIP_PAIRS: [keyof ColumnWidths, keyof ColumnWidths][] = [
  ['name', 'artist'],
  ['artist', 'album'],
  ['album', 'hour'],
  ['hour', 'intensity'],
  ['intensity', 'affective'],
  ['affective', 'activation'],
  ['activation', 'spaciousness'],
  ['spaciousness', 'tension'],
  ['tension', 'energy'],
  ['energy', 'valence'],
  ['valence', 'danceability'],
  ['danceability', 'duration'],
  ['duration', 'format'],
  ['format', 'size'],
  ['size', 'added'],
]

function applyColumnGrip(gripIdx: number, base: ColumnWidths, dx: number): ColumnWidths {
  if (dx === 0) return base
  const pair = GRIP_PAIRS[gripIdx]
  if (!pair) return base
  const [L, R] = pair
  const minL = COLUMN_MIN[L]
  const minR = COLUMN_MIN[R]
  const sum = base[L] + base[R]
  const nl = clamp(base[L] + dx, minL, sum - minR)
  const nr = sum - nl
  if (nl === base[L] && nr === base[R]) return base
  return { ...base, [L]: nl, [R]: nr }
}

type SortKey = 'fileName' | 'artist' | 'album' | 'hour' | 'duration' | 'format' | 'fileSize' | 'dateAdded' | 'intensity' | 'affective' | 'activation' | 'spaciousness' | 'tension' | 'energy' | 'valence' | 'danceability'
type SortDir = 'asc' | 'desc'
type SortEntry = { key: SortKey; dir: SortDir }

function afValue(f: LibraryFile, key: SortKey): number | null {
  const af = f.audioFeatures
  if (!af) return null
  switch (key) {
    case 'intensity': return af.intensity
    case 'affective': return af.affective_intensity
    case 'activation': return af.activation_intensity
    case 'spaciousness': return af.spaciousness
    case 'tension': return af.tension
    case 'energy': return af.energy
    case 'valence': return af.valence
    case 'danceability': return af.danceability
    default: return null
  }
}

function sortFiles(files: LibraryFile[], sorts: SortEntry[]): LibraryFile[] {
  if (sorts.length === 0) return files
  return [...files].sort((a, b) => {
    for (const { key, dir } of sorts) {
      const mul = dir === 'asc' ? 1 : -1
      let c = 0
      switch (key) {
        case 'fileName':
          c = (a.trackTitle || a.fileName).localeCompare(b.trackTitle || b.fileName, undefined, { sensitivity: 'base' }) * mul
          break
        case 'artist':
          c = artistSortKey(a).localeCompare(artistSortKey(b), undefined, { sensitivity: 'base' }) * mul
          break
        case 'album':
          c = albumSortKey(a).localeCompare(albumSortKey(b), undefined, { sensitivity: 'base' }) * mul
          break
        case 'hour':
          c = (hourTagsForFile(a.tags)[0] ?? '').localeCompare(hourTagsForFile(b.tags)[0] ?? '', undefined, { sensitivity: 'base' }) * mul
          break
        case 'duration': c = (a.duration - b.duration) * mul; break
        case 'format': c = a.format.localeCompare(b.format, undefined, { sensitivity: 'base' }) * mul; break
        case 'fileSize': c = (a.fileSize - b.fileSize) * mul; break
        case 'dateAdded': {
          const ta = Date.parse(a.dateAdded) || 0
          const tb = Date.parse(b.dateAdded) || 0
          c = (ta - tb) * mul
          break
        }
        default: {
          const va = afValue(a, key)
          const vb = afValue(b, key)
          if (va === null && vb === null) break
          if (va === null) return 1   // nulls always last
          if (vb === null) return -1
          c = (va - vb) * mul
        }
      }
      if (c !== 0) return c
    }
    return a.id.localeCompare(b.id)
  })
}

function formatAf(v: number | null | undefined): string {
  if (v == null || typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return v.toFixed(2)
}

function formatDuration(seconds: number): string {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`
  return `${bytes} B`
}

// Compact "date added" for the column: relative for the last week, else a
// short date. Full ISO date is exposed via the cell's title attribute.
function formatDateAdded(iso: string): string {
  const t = Date.parse(iso)
  if (!t) return '—'
  const now = Date.now()
  const days = Math.floor((now - t) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  const d = new Date(t)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString(undefined, sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: '2-digit' })
}

function formatDateAddedFull(iso: string): string {
  const t = Date.parse(iso)
  if (!t) return 'Date added unknown'
  return `Added ${new Date(t).toLocaleString()}`
}

export function FileList(): JSX.Element {
  const [query, setQuery] = useState('')
  const [pendingOnly, setPendingOnly] = useState(false)
  const [duplicateOnly, setDuplicateOnly] = useState(false)
  const unmatchedOnly = useLibraryStore((s) => s.unmatchedOnly)
  const setUnmatchedOnly = useLibraryStore((s) => s.setUnmatchedOnly)
  const [showRemoved, setShowRemoved] = useState(false)
  const [sortState, setSortState] = useState<SortEntry[]>([{ key: 'fileName', dir: 'asc' }])

  const [storedWidths, setStoredWidths] = useState<StoredWidths>(readStoredColumnWidths)

  useEffect(() => {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(storedWidths))
  }, [storedWidths])

  const visibleWidthsRef = useRef<ColumnWidths | null>(null)
  const colDragRef = useRef<{ gripIdx: number; startX: number; snapshot: ColumnWidths } | null>(null)

  const beginColResize = useCallback((gripIdx: number, clientX: number) => {
    const cur = visibleWidthsRef.current
    if (!cur) return
    colDragRef.current = { gripIdx, startX: clientX, snapshot: { ...cur } }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    function move(e: globalThis.MouseEvent): void {
      const drag = colDragRef.current
      if (!drag) return
      const dx = e.clientX - drag.startX
      const next = applyColumnGrip(drag.gripIdx, drag.snapshot, dx)
      const pair = GRIP_PAIRS[drag.gripIdx]
      const touchesHour = pair && (pair[0] === 'hour' || pair[1] === 'hour')
      setStoredWidths((prev) => ({
        ...prev,
        ...next,
        hourUserSet: prev.hourUserSet || !!touchesHour,
      }))
    }
    function up(): void {
      if (!colDragRef.current) return
      colDragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  // Re-render when on-demand feature analysis starts/finishes so per-row state updates.
  const [, forceAnalyzingTick] = useState(0)
  useEffect(() => subscribeAnalyzing(() => forceAnalyzingTick((n) => n + 1)), [])
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set())
  const [rowTooltip, setRowTooltip] = useState<{ file: LibraryFile; x: number; y: number } | null>(null)
  const rowTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rowTooltipCursorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const lastClickedIdRef = useRef<string | null>(null)
  const previewFileId = useLibraryStore((s) => s.previewFileId)
  const setPreview = useLibraryStore((s) => s.setPreview)
  const removeFiles = useLibraryStore((s) => s.removeFiles)
  const [removedSort, setRemovedSort] = useState<'name' | 'artist' | 'file'>('name')
  const [removedSortDir, setRemovedSortDir] = useState<'asc' | 'desc'>('asc')

  const scrollRef = useRef<HTMLDivElement>(null)
  const filesRef = useRef<LibraryFile[]>([])
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(400)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setContainerHeight(el.clientHeight)
    const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [showRemoved])

  const allFiles = useLibraryStore((s) => s.files)
  const removedFiles = useLibraryStore((s) => s.removedFiles)
  const restoreFile = useLibraryStore((s) => s.restoreFile)
  const pendingMatches = useLibraryStore((s) => s.pendingMatches)
  const watchedFolders = useLibraryStore((s) => s.watchedFolders)
  const selectedFolderId = useLibraryStore((s) => s.selectedFolderId)
  const selectedTags = useLibraryStore((s) => s.selectedTags)
  const selectedFileId = useLibraryStore((s) => s.selectedFileId)
  const selectFile = useLibraryStore((s) => s.selectFile)
  const removeFile = useLibraryStore((s) => s.removeFile)
  const scanning = useLibraryStore((s) => s.scanning)
  const playlists = useLibraryStore((s) => s.playlists)
  const selectedPlaylistId = useLibraryStore((s) => s.selectedPlaylistId)
  const selectedMissingTrackId = useLibraryStore((s) => s.selectedMissingTrackId)
  const selectMissingTrack = useLibraryStore((s) => s.selectMissingTrack)
  const applyPendingMatch = useLibraryStore((s) => s.applyPendingMatch)

  // Cmd+C copies the selected file to clipboard
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selectedFileId) {
        const f = allFiles.find((x) => x.id === selectedFileId)
        if (f) window.electronAPI.copyFile(f.filePath)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedFileId, allFiles])

  useEffect(() => {
    if (!selectedFileId) return
    const idx = filesRef.current.findIndex((f) => f.id === selectedFileId)
    if (idx < 0) return
    const el = scrollRef.current
    if (!el) return
    const rowTop = idx * ROW_HEIGHT
    const rowBottom = rowTop + ROW_HEIGHT
    if (rowTop < el.scrollTop || rowBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, rowTop - el.clientHeight / 2 + ROW_HEIGHT / 2)
    }
  }, [selectedFileId])

  useEffect(() => {
    if (!contextMenu) return
    function close(): void { setContextMenu(null) }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [contextMenu])

  // Build set of file IDs that share an mfbTrackId with at least one other file
  const duplicateIds = (() => {
    const byMfbId = new Map<number, string[]>()
    for (const f of allFiles) {
      if (f.mfbTrackId !== null) {
        const arr = byMfbId.get(f.mfbTrackId) ?? []
        arr.push(f.id)
        byMfbId.set(f.mfbTrackId, arr)
      }
    }
    const result = new Set<string>()
    for (const ids of byMfbId.values()) {
      if (ids.length > 1) for (const id of ids) result.add(id)
    }
    return result
  })()

  // Compute playlist missing tracks (before filtering modifies `files`)
  const selectedPlaylistDetail = useLibraryStore((s) => s.selectedPlaylistDetail)
  const missingPlaylistTracks: MfbPlaylistTrack[] = (() => {
    if (selectedPlaylistId === null || !selectedPlaylistDetail) return []
    const libraryIds = new Set(allFiles.map((f) => f.mfbTrackId).filter((id): id is number => id !== null))
    return selectedPlaylistDetail.segments.flatMap((s) => s.tracks).filter((t) => !libraryIds.has(t.id))
  })()

  // Apply folder, tag, or playlist filter
  let files = allFiles
  if (selectedPlaylistId !== null) {
    const playlist = playlists.find((p) => p.id === selectedPlaylistId)
    files = playlist
      ? files.filter((f) => f.mfbTrackId !== null && playlist.trackIds.includes(f.mfbTrackId))
      : []
  } else if (selectedFolderId !== null) {
    const folder = watchedFolders.find((w) => w.id === selectedFolderId)
    files = folder ? files.filter((f) => f.filePath.startsWith(folder.path)) : []
  } else if (selectedTags.length > 0) {
    files = files.filter((f) => selectedTags.every((t) => f.tags.includes(t)))
  }

  const unmatchedCount = allFiles.filter((f) => f.mfbTrackId == null).length

  // Apply pending filter
  if (pendingOnly) files = files.filter((f) => !!pendingMatches[f.id])

  // Apply duplicate filter
  if (duplicateOnly) files = files.filter((f) => duplicateIds.has(f.id))

  // Apply unmatched filter
  if (unmatchedOnly) files = files.filter((f) => f.mfbTrackId == null)

  // Apply search query
  const q = query.trim().toLowerCase()
  if (q) {
    files = files.filter((f) => {
      const nameHit = f.fileName.toLowerCase().includes(q)
      const tagHit = f.tags.some((t) => t.toLowerCase().includes(q))
      const artistBlob = `${f.artist}\n${f.artistPathGuess}\n${displayedArtist(f)}`.toLowerCase()
      const albumBlob = `${f.album}\n${f.albumPathGuess}\n${displayedAlbum(f)}`.toLowerCase()
      return (
        nameHit ||
        tagHit ||
        artistBlob.includes(q) ||
        albumBlob.includes(q)
      )
    })
  }

  files = sortFiles(files, sortState)
  filesRef.current = files
  const multiSort = sortState.length > 1

  // Until the user manually drags the hour column, auto-fit it to all chips.
  let hourAutoFit = COLUMN_MIN.hour
  if (!storedWidths.hourUserSet) {
    for (const f of files) {
      const w = hourCellWidth(hourTagsForFile(f.tags))
      if (w > hourAutoFit) hourAutoFit = w
    }
  }

  const cw: ColumnWidths = {
    name: storedWidths.name,
    artist: storedWidths.artist,
    album: storedWidths.album,
    hour: storedWidths.hourUserSet ? storedWidths.hour : hourAutoFit,
    intensity: storedWidths.intensity,
    affective: storedWidths.affective,
    activation: storedWidths.activation,
    spaciousness: storedWidths.spaciousness,
    tension: storedWidths.tension,
    energy: storedWidths.energy,
    valence: storedWidths.valence,
    danceability: storedWidths.danceability,
    duration: storedWidths.duration,
    format: storedWidths.format,
    size: storedWidths.size,
    added: storedWidths.added,
  }
  visibleWidthsRef.current = cw

  const minTableWidth = TABLE_HORIZONTAL_PADDING + 15 * GRIP_PX
    + cw.name + cw.artist + cw.album + cw.hour
    + cw.intensity + cw.affective + cw.activation + cw.spaciousness
    + cw.tension + cw.energy + cw.valence + cw.danceability
    + cw.duration + cw.format + cw.size + cw.added

  const gripMouseDown = (gripIdx: number) => (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    beginColResize(gripIdx, e.clientX)
  }

  function headerProps(key: SortKey) {
    const idx = sortState.findIndex((e) => e.key === key)
    const entry = sortState[idx] ?? null
    return {
      active: entry !== null,
      dir: (entry?.dir ?? 'asc') as SortDir,
      sortIndex: multiSort && entry !== null ? idx + 1 : null,
      ariaSort: entry !== null ? entry.dir : (null as SortDir | null),
      onSort: (shiftKey: boolean) => {
        setSortState((prev) => {
          const i = prev.findIndex((e) => e.key === key)
          if (shiftKey) {
            if (i === -1) return [...prev, { key, dir: 'asc' }]
            if (prev[i].dir === 'asc') return prev.map((e, j) => j === i ? { ...e, dir: 'desc' as SortDir } : e)
            return prev.filter((_, j) => j !== i)
          }
          if (prev.length === 1 && prev[0].key === key) {
            return [{ key, dir: prev[0].dir === 'asc' ? 'desc' : 'asc' }]
          }
          return [{ key, dir: 'asc' }]
        })
      },
    }
  }

  if (showRemoved) {
    const q = query.trim().toLowerCase()
    const filteredRemoved = (q
      ? removedFiles.filter((f) =>
          f.fileName.toLowerCase().includes(q) ||
          f.trackTitle.toLowerCase().includes(q) ||
          f.artist.toLowerCase().includes(q)
        )
      : removedFiles
    ).slice().sort((a, b) => {
      let va = '', vb = ''
      if (removedSort === 'name') { va = (a.trackTitle || a.fileName).toLowerCase(); vb = (b.trackTitle || b.fileName).toLowerCase() }
      else if (removedSort === 'artist') { va = a.artist.toLowerCase(); vb = b.artist.toLowerCase() }
      else { va = a.fileName.toLowerCase(); vb = b.fileName.toLowerCase() }
      const cmp = va.localeCompare(vb)
      return removedSortDir === 'asc' ? cmp : -cmp
    })

    function toggleRemovedSort(col: typeof removedSort): void {
      if (removedSort === col) { setRemovedSortDir((d) => d === 'asc' ? 'desc' : 'asc') }
      else { setRemovedSort(col); setRemovedSortDir('asc') }
    }

    function SortArrow({ col }: { col: typeof removedSort }): JSX.Element {
      const active = removedSort === col
      return (
        <svg className="w-2.5 h-2.5 shrink-0 ml-0.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: active ? 1 : 0.25 }}>
          {removedSortDir === 'asc' || !active ? <path d="M2 7l3-4 3 4" /> : <path d="M2 3l3 4 3-4" />}
        </svg>
      )
    }

    return (
      <div className="flex overflow-hidden flex-col flex-1 min-w-0">
        <SearchBar query={query} onChange={setQuery} pendingOnly={pendingOnly} onTogglePending={() => setPendingOnly((v) => !v)} pendingCount={Object.keys(pendingMatches).length} duplicateOnly={duplicateOnly} onToggleDuplicate={() => setDuplicateOnly((v) => !v)} duplicateCount={duplicateIds.size} showRemoved={showRemoved} onToggleRemoved={() => setShowRemoved((v) => !v)} removedCount={removedFiles.length} unmatchedOnly={unmatchedOnly} onToggleUnmatched={() => setUnmatchedOnly((v) => !v)} unmatchedCount={unmatchedCount} />
        <div className="flex items-center px-3 h-7 border-b border-surface-border text-[10px] uppercase tracking-wider select-none shrink-0">
          <button type="button" onClick={() => toggleRemovedSort('name')} className={`flex items-center gap-0.5 flex-1 min-w-0 transition-colors ${removedSort === 'name' ? 'text-gray-300' : 'text-gray-600 hover:text-gray-400'}`}>
            Name <SortArrow col="name" />
          </button>
          <button type="button" onClick={() => toggleRemovedSort('artist')} className={`flex items-center gap-0.5 w-[120px] shrink-0 transition-colors ${removedSort === 'artist' ? 'text-gray-300' : 'text-gray-600 hover:text-gray-400'}`}>
            Artist <SortArrow col="artist" />
          </button>
          <button type="button" onClick={() => toggleRemovedSort('file')} className={`flex items-center gap-0.5 w-[120px] shrink-0 transition-colors ${removedSort === 'file' ? 'text-gray-300' : 'text-gray-600 hover:text-gray-400'}`}>
            Filename <SortArrow col="file" />
          </button>
          <div className="w-14 shrink-0" />
        </div>
        <div className="overflow-y-auto flex-1 min-h-0">
          {filteredRemoved.length === 0 ? (
            <p className="px-4 py-4 text-[11px] text-gray-600">{q ? 'No results' : 'No removed files'}</p>
          ) : (
            filteredRemoved.map((f) => {
              const isPreviewing = previewFileId === f.id
              return (
                <div key={f.id} className="flex gap-2 items-center px-3 border-b border-surface-border/50 group" style={{ height: ROW_HEIGHT }}>
                  <button
                    type="button"
                    onClick={() => isPreviewing ? setPreview(null, []) : setPreview(f.id, filteredRemoved.map((r) => r.id))}
                    className={`shrink-0 w-4 h-4 flex items-center justify-center rounded-full border transition-colors ${isPreviewing ? 'opacity-100 border-accent text-accent' : 'text-gray-600 border-gray-600 opacity-0 hover:border-accent hover:text-accent group-hover:opacity-100'}`}
                    title={isPreviewing ? 'Stop preview' : 'Preview'}
                  >
                    {isPreviewing ? (
                      <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor">
                        <rect x="1.5" y="1" width="2.5" height="8" rx="0.5" />
                        <rect x="6" y="1" width="2.5" height="8" rx="0.5" />
                      </svg>
                    ) : (
                      <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor">
                        <path d="M2 1.5l7 3.5-7 3.5V1.5z" />
                      </svg>
                    )}
                  </button>
                  <span className="flex-1 min-w-0 text-[11px] text-gray-500 truncate">{f.trackTitle || f.fileName}</span>
                  <span className="text-[10px] text-gray-600 truncate shrink-0 w-[120px]">{f.artist}</span>
                  <span className="text-[10px] text-gray-600 truncate shrink-0 w-[120px]">{f.fileName}</span>
                  <button
                    type="button"
                    onClick={() => restoreFile(f.id)}
                    className="shrink-0 px-2 py-px text-[9px] font-medium rounded border border-surface-border text-gray-500 hover:text-gray-200 hover:border-gray-500 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    Restore
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    )
  }

  if (scanning && files.length === 0) {
    return (
      <div className="flex overflow-hidden flex-col flex-1 min-w-0">
        <SearchBar query={query} onChange={setQuery} pendingOnly={pendingOnly} onTogglePending={() => setPendingOnly((v) => !v)} pendingCount={Object.keys(pendingMatches).length} duplicateOnly={duplicateOnly} onToggleDuplicate={() => setDuplicateOnly((v) => !v)} duplicateCount={duplicateIds.size} showRemoved={showRemoved} onToggleRemoved={() => setShowRemoved((v) => !v)} removedCount={removedFiles.length} unmatchedOnly={unmatchedOnly} onToggleUnmatched={() => setUnmatchedOnly((v) => !v)} unmatchedCount={unmatchedCount} />
        <div className="flex flex-1 justify-center items-center text-xs text-gray-600">
          Scanning…
        </div>
      </div>
    )
  }

  return (
    <div className="flex overflow-hidden flex-col flex-1 min-w-0">
      <SearchBar query={query} onChange={setQuery} pendingOnly={pendingOnly} onTogglePending={() => setPendingOnly((v) => !v)} pendingCount={Object.keys(pendingMatches).length} duplicateOnly={duplicateOnly} onToggleDuplicate={() => setDuplicateOnly((v) => !v)} duplicateCount={duplicateIds.size} showRemoved={showRemoved} onToggleRemoved={() => setShowRemoved((v) => !v)} removedCount={removedFiles.length} unmatchedOnly={unmatchedOnly} onToggleUnmatched={() => setUnmatchedOnly((v) => !v)} unmatchedCount={unmatchedCount} />

      {/* Scroll container — both axes; header is sticky inside so it scrolls with rows horizontally */}
      <div
        ref={scrollRef}
        className="overflow-auto flex-1"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div style={{ minWidth: minTableWidth }}>

        {/* Column headers — sticky so they stay visible on vertical scroll */}
        <div data-tour="column-headers" className="sticky top-0 z-10 flex items-stretch px-3 h-7 border-b border-surface-border bg-surface-panel text-[10px] uppercase tracking-wider select-none text-grey-500">
          <SortHeader label="Name" {...headerProps('fileName')} className="shrink-0 justify-start text-left min-w-0 py-1.5" style={{ width: cw.name }} />
          <GripSpacer onGripMouseDown={gripMouseDown(0)} />
          <SortHeader label="Artist" {...headerProps('artist')} className="shrink-0 justify-start text-left min-w-0 py-1.5" style={{ width: cw.artist }} />
          <GripSpacer onGripMouseDown={gripMouseDown(1)} />
          <SortHeader label="Album" {...headerProps('album')} className="shrink-0 justify-start text-left min-w-0 py-1.5" style={{ width: cw.album }} />
          <GripSpacer onGripMouseDown={gripMouseDown(2)} />
          <SortHeader label="Hour" {...headerProps('hour')} className="shrink-0 justify-start text-left min-w-0 py-1.5" style={{ width: cw.hour }} />
          <GripSpacer onGripMouseDown={gripMouseDown(3)} />
          <SortHeader label="Intensity" {...headerProps('intensity')} className="shrink-0 text-left py-1.5" style={{ width: cw.intensity }} />
          <GripSpacer onGripMouseDown={gripMouseDown(4)} />
          <SortHeader label="Affective" {...headerProps('affective')} className="shrink-0 text-left py-1.5" style={{ width: cw.affective }} />
          <GripSpacer onGripMouseDown={gripMouseDown(5)} />
          <SortHeader label="Activation" {...headerProps('activation')} className="shrink-0 text-left py-1.5" style={{ width: cw.activation }} />
          <GripSpacer onGripMouseDown={gripMouseDown(6)} />
          <SortHeader label="Spaciousness" {...headerProps('spaciousness')} className="shrink-0 text-left py-1.5" style={{ width: cw.spaciousness }} />
          <GripSpacer onGripMouseDown={gripMouseDown(7)} />
          <SortHeader label="Tension" {...headerProps('tension')} className="shrink-0 text-left py-1.5" style={{ width: cw.tension }} />
          <GripSpacer onGripMouseDown={gripMouseDown(8)} />
          <SortHeader label="Energy" {...headerProps('energy')} className="shrink-0 text-left py-1.5" style={{ width: cw.energy }} />
          <GripSpacer onGripMouseDown={gripMouseDown(9)} />
          <SortHeader label="Valence" {...headerProps('valence')} className="shrink-0 text-left py-1.5" style={{ width: cw.valence }} />
          <GripSpacer onGripMouseDown={gripMouseDown(10)} />
          <SortHeader label="Danceability" {...headerProps('danceability')} className="shrink-0 text-left py-1.5" style={{ width: cw.danceability }} />
          <GripSpacer onGripMouseDown={gripMouseDown(11)} />
          <SortHeader label="Duration" {...headerProps('duration')} className="shrink-0 text-left py-1.5" style={{ width: cw.duration }} />
          <GripSpacer onGripMouseDown={gripMouseDown(12)} />
          <SortHeader label="Format" {...headerProps('format')} className="shrink-0 text-left py-1.5" style={{ width: cw.format }} />
          <GripSpacer onGripMouseDown={gripMouseDown(13)} />
          <SortHeader label="Size" {...headerProps('fileSize')} className="shrink-0 text-left py-1.5" style={{ width: cw.size }} />
          <GripSpacer onGripMouseDown={gripMouseDown(14)} />
          <SortHeader label="Added" {...headerProps('dateAdded')} className="shrink-0 text-left py-1.5" style={{ width: cw.added }} />
        </div>

        {files.length === 0 ? (
          <div className="flex justify-center items-center h-16 text-xs text-gray-600">
            {q ? 'No results' : 'No files'}
          </div>
        ) : (() => {
          const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
          const endIdx = Math.min(files.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN)
          const paddingTop = startIdx * ROW_HEIGHT
          const paddingBottom = (files.length - endIdx) * ROW_HEIGHT
          return (
            <div style={{ paddingTop, paddingBottom }}>
              {files.slice(startIdx, endIdx).map((file) => (
                <div
                  key={file.id}
                  draggable
                  onDragStart={(e) => {
                    e.preventDefault()
                    window.electronAPI.startDrag(file.filePath)
                  }}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey) {
                      setMultiSelectedIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(file.id)) next.delete(file.id)
                        else next.add(file.id)
                        return next
                      })
                      lastClickedIdRef.current = file.id
                    } else if (e.shiftKey && lastClickedIdRef.current) {
                      const lastIdx = files.findIndex((f) => f.id === lastClickedIdRef.current)
                      const thisIdx = files.findIndex((f) => f.id === file.id)
                      if (lastIdx >= 0) {
                        const [from, to] = [Math.min(lastIdx, thisIdx), Math.max(lastIdx, thisIdx)]
                        setMultiSelectedIds(new Set(files.slice(from, to + 1).map((f) => f.id)))
                      }
                    } else {
                      setMultiSelectedIds(new Set())
                      lastClickedIdRef.current = file.id
                      selectFile(file.id === selectedFileId ? null : file.id)
                    }
                  }}
                  onDoubleClick={() => window.electronAPI.showInFolder(file.filePath)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setContextMenu({ fileId: file.id, filePath: file.filePath, x: e.clientX, y: e.clientY })
                  }}
                  style={{ height: ROW_HEIGHT }}
                  className={`group flex items-center px-3 text-left transition-colors border-b border-surface-border/50 cursor-grab active:cursor-grabbing select-none overflow-hidden ${
                    multiSelectedIds.has(file.id)
                      ? 'bg-accent/10 text-gray-200'
                      : selectedFileId === file.id
                        ? 'bg-accent/15 text-gray-200'
                        : 'hover:bg-surface-hover text-gray-400'
                  }`}
                  onMouseEnter={(e) => {
                    rowTooltipCursorRef.current = { x: e.clientX, y: e.clientY }
                    if (rowTooltipTimerRef.current) clearTimeout(rowTooltipTimerRef.current)
                    rowTooltipTimerRef.current = setTimeout(() => {
                      const { x, y } = rowTooltipCursorRef.current
                      setRowTooltip({ file, x, y })
                    }, 1000)
                  }}
                  onMouseMove={(e) => {
                    rowTooltipCursorRef.current = { x: e.clientX, y: e.clientY }
                  }}
                  onMouseLeave={() => {
                    if (rowTooltipTimerRef.current) clearTimeout(rowTooltipTimerRef.current)
                    setRowTooltip(null)
                  }}
                >
                  <div className="flex overflow-hidden gap-2 items-center min-w-0 shrink-0" style={{ width: cw.name }}>
                    <div className="overflow-hidden relative w-5 h-5 rounded shrink-0">
                      {file.albumImageUrl && (
                        <img src={file.albumImageUrl} alt="" className={`object-cover absolute inset-0 w-full h-full transition-opacity ${previewFileId === file.id ? 'opacity-60' : 'opacity-100 group-hover:opacity-60'}`} />
                      )}
                      <button
                        type="button"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation()
                          if (previewFileId === file.id) {
                            setPreview(null, [])
                          } else {
                            setPreview(file.id, files.map((f) => f.id))
                          }
                        }}
                        className={`absolute inset-0 flex items-center justify-center transition-all ${
                          file.albumImageUrl
                            ? previewFileId === file.id
                              ? 'text-white opacity-100'
                              : 'text-white opacity-0 group-hover:opacity-100'
                            : previewFileId === file.id
                              ? 'rounded-full border border-accent text-accent opacity-100'
                              : 'rounded-full border border-gray-600 text-gray-600 hover:border-accent hover:text-accent opacity-0 group-hover:opacity-100'
                        }`}
                        title={previewFileId === file.id ? 'Stop preview' : 'Preview'}
                      >
                        {previewFileId === file.id ? (
                          <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor">
                            <rect x="1.5" y="1" width="2.5" height="8" rx="0.5" />
                            <rect x="6" y="1" width="2.5" height="8" rx="0.5" />
                          </svg>
                        ) : (
                          <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor">
                            <path d="M2 1.5l7 3.5-7 3.5V1.5z" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
                      <span className="text-[11px] truncate shrink min-w-0">
                        {file.trackTitle || file.fileName}
                      </span>
                      {analyzingFeatureIds.has(file.id) ? (
                        <span className="shrink-0 text-[10px] text-accent animate-pulse" title="Estimating audio features…">≈…</span>
                      ) : file.audioFeaturesEstimated ? (
                        <span className="shrink-0 text-[10px] text-accent/70" title="Audio features estimated locally (not in the MFB catalogue)">≈</span>
                      ) : null}
                      {file.bandcampUrl && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); window.open(file.bandcampUrl!) }}
                          className="shrink-0 inline-flex items-center px-1.5 py-px text-[9px] font-medium rounded border transition-colors text-[#1da0c3] border-[#1da0c3]/40 bg-[#1da0c3]/10 hover:bg-[#1da0c3]/20 leading-tight"
                        >
                          Buy at Bandcamp
                        </button>
                      )}
                      {file.beatportUrl && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); window.open(file.beatportUrl!) }}
                          className="shrink-0 inline-flex items-center px-1.5 py-px text-[9px] font-medium rounded border transition-colors text-[#97f04f] border-[#97f04f]/40 bg-[#97f04f]/10 hover:bg-[#97f04f]/20 leading-tight"
                        >
                          Buy at Beatport
                        </button>
                      )}

                    </div>
                    {pendingMatches[file.id] && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); applyPendingMatch(file.id); syncLibraryToMfb() }}
                        className="shrink-0 inline-flex justify-center items-center w-[46px] py-px text-[9px] font-medium rounded bg-accent/20 text-accent leading-tight hover:bg-accent/40 transition-colors"
                        title="Click to apply MFB match"
                      >
                        <span className="group-hover:hidden">pending</span>
                        <span className="hidden group-hover:inline">apply</span>
                      </button>
                    )}
                    {!pendingMatches[file.id] && duplicateIds.has(file.id) && (
                      <span className="shrink-0 inline-flex justify-center items-center w-[46px] py-px text-[9px] font-medium rounded bg-yellow-500/15 text-yellow-400/80 leading-tight border border-yellow-500/20">
                        dupe
                      </span>
                    )}
                  </div>
                  <GripSpacer />
                  {(() => {
                    const pm = pendingMatches[file.id]
                    const suggestedArtist = pm?.artists.map((a) => a.name).join(', ')
                    const suggestedAlbum = pm?.album.title
                    return (
                      <>
                        <span
                          className={`text-[11px] truncate shrink-0 min-w-0 ${pm ? 'italic text-accent' : `text-gray-400 ${artistGuessPendingItalic(file) ? 'italic' : ''}`}`}
                          style={{ width: cw.artist }}
                        >
                          {pm ? suggestedArtist : displayedArtist(file)}
                        </span>
                        <GripSpacer />
                        <span
                          className={`text-[11px] truncate shrink-0 min-w-0 ${pm ? 'italic text-accent' : `text-gray-400 ${albumGuessPendingItalic(file) ? 'italic' : ''}`}`}
                          style={{ width: cw.album }}
                        >
                          {pm ? suggestedAlbum : displayedAlbum(file)}
                        </span>
                      </>
                    )
                  })()}
                  <GripSpacer />
                  <div className="flex overflow-x-auto overflow-y-hidden gap-1 items-center px-1 hour-cell shrink-0" style={{ width: cw.hour, minWidth: 0 }}>
                    {hourTagsForFile(file.tags).map((tag) => {
                      const color = phaseColorForTag(tag) ?? '#4b5563'
                      return (
                        <span
                          key={tag}
                          className="shrink-0 rounded-lg px-1 py-px text-[9px] font-medium leading-tight whitespace-nowrap"
                          style={{ backgroundColor: color + '28', color, border: `1px solid ${color}55` }}
                        >
                          {tag}
                        </span>
                      )
                    })}
                  </div>
                  <GripSpacer />
                  <span className="text-[11px] text-left shrink-0 tabular-nums text-gray-500" style={{ width: cw.intensity }}>{formatAf(file.audioFeatures?.intensity)}</span>
                  <GripSpacer />
                  <span className="text-[11px] text-left shrink-0 tabular-nums text-gray-500" style={{ width: cw.affective }}>{formatAf(file.audioFeatures?.affective_intensity)}</span>
                  <GripSpacer />
                  <span className="text-[11px] text-left shrink-0 tabular-nums text-gray-500" style={{ width: cw.activation }}>{formatAf(file.audioFeatures?.activation_intensity)}</span>
                  <GripSpacer />
                  <span className="text-[11px] text-left shrink-0 tabular-nums text-gray-500" style={{ width: cw.spaciousness }}>{formatAf(file.audioFeatures?.spaciousness)}</span>
                  <GripSpacer />
                  <span className="text-[11px] text-left shrink-0 tabular-nums text-gray-500" style={{ width: cw.tension }}>{formatAf(file.audioFeatures?.tension)}</span>
                  <GripSpacer />
                  <span className="text-[11px] text-left shrink-0 tabular-nums text-gray-500" style={{ width: cw.energy }}>{formatAf(file.audioFeatures?.energy)}</span>
                  <GripSpacer />
                  <span className="text-[11px] text-left shrink-0 tabular-nums text-gray-500" style={{ width: cw.valence }}>{formatAf(file.audioFeatures?.valence)}</span>
                  <GripSpacer />
                  <span className="text-[11px] text-left shrink-0 tabular-nums text-gray-500" style={{ width: cw.danceability }}>{formatAf(file.audioFeatures?.danceability)}</span>
                  <GripSpacer />
                  <span className="text-[11px] text-left shrink-0 tabular-nums" style={{ width: cw.duration }}>
                    {formatDuration(file.duration)}
                  </span>
                  <GripSpacer />
                  <span className="text-[10px] text-left shrink-0 uppercase text-gray-600" style={{ width: cw.format }}>
                    {file.format}
                  </span>
                  <GripSpacer />
                  <span className="text-[11px] text-left shrink-0 tabular-nums text-gray-600" style={{ width: cw.size }}>
                    {formatSize(file.fileSize)}
                  </span>
                  <GripSpacer />
                  <span
                    className="text-[11px] text-left shrink-0 tabular-nums text-gray-600"
                    style={{ width: cw.added }}
                    title={formatDateAddedFull(file.dateAdded)}
                  >
                    {formatDateAdded(file.dateAdded)}
                  </span>
                </div>
              ))}
            </div>
          )
        })()}

        {/* Missing playlist tracks — not in library */}
        {missingPlaylistTracks.length > 0 && (
          <>
            <div className="flex gap-2 items-center px-3 h-6 border-t border-b select-none border-surface-border bg-surface-panel/50">
              <span className="text-[10px] uppercase tracking-wider text-gray-500">Not in library</span>
              <span className="text-[10px] text-gray-500 tabular-nums">{missingPlaylistTracks.length}</span>
            </div>
            {missingPlaylistTracks.map((track) => (
              <div
                key={track.id}
                style={{ height: ROW_HEIGHT }}
                onClick={() => selectMissingTrack(selectedMissingTrackId === track.id ? null : track.id)}
                className={`group flex items-center px-3 border-b cursor-pointer select-none border-surface-border/50 transition-colors overflow-hidden ${
                  selectedMissingTrackId === track.id
                    ? 'bg-accent/10 opacity-100'
                    : 'opacity-100 hover:opacity-80 hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-[120px] basis-[6rem]">
                  {track.album_image_url ? (
                    <img src={track.album_image_url} alt="" className="object-cover w-4 h-4 rounded opacity-60 shrink-0" />
                  ) : (
                    <div className="flex justify-center items-center w-4 h-4 text-gray-600 rounded-full border border-gray-700 shrink-0">
                      <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor">
                        <path d="M2 1.5l7 3.5-7 3.5V1.5z" />
                      </svg>
                    </div>
                  )}
                  <span className="text-[11px] truncate min-w-0 flex-1 text-gray-400">{track.title}</span>
                </div>
                <GripSpacer />
                <span className="text-[11px] truncate shrink-0 min-w-0 text-gray-500" style={{ width: cw.artist }}>
                  {track.artist}
                </span>
                <GripSpacer />
                <span className="min-w-0 shrink-0" style={{ width: cw.album }} />
                <GripSpacer />
                <span className="shrink-0" style={{ width: cw.hour }} />
                <GripSpacer />
                <span className="shrink-0" style={{ width: cw.intensity }} />
                <GripSpacer />
                <span className="shrink-0" style={{ width: cw.affective }} />
                <GripSpacer />
                <span className="shrink-0" style={{ width: cw.activation }} />
                <GripSpacer />
                <span className="shrink-0" style={{ width: cw.spaciousness }} />
                <GripSpacer />
                <span className="shrink-0" style={{ width: cw.tension }} />
                <GripSpacer />
                <span className="shrink-0" style={{ width: cw.energy }} />
                <GripSpacer />
                <span className="shrink-0" style={{ width: cw.valence }} />
                <GripSpacer />
                <span className="shrink-0" style={{ width: cw.danceability }} />
                <GripSpacer />
                <span className="shrink-0" style={{ width: cw.duration }} />
                <GripSpacer />
                <span className="shrink-0" style={{ width: cw.format }} />
                <GripSpacer />
                <div className="flex justify-end shrink-0" style={{ width: cw.size }}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); window.open(mfbTrackUrl(track.id, track.title)) }}
                    title="View on Music for Breathwork"
                    className="flex justify-center items-center w-4 h-4 text-gray-600 opacity-0 transition-all group-hover:opacity-100 hover:text-accent"
                  >
                    <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5.5 2.5H3A1.5 1.5 0 0 0 1.5 4v5A1.5 1.5 0 0 0 3 10.5h5A1.5 1.5 0 0 0 9.5 9V6.5M7 1.5H10.5V5M10.5 1.5L5.5 6.5" />
                    </svg>
                  </button>
                </div>
                <GripSpacer />
                <span className="shrink-0" style={{ width: cw.added }} />
              </div>
            ))}
          </>
        )}
        </div>{/* end minWidth wrapper */}
      </div>{/* end scrollRef / overflow-auto */}

      {/* Context menu */}
      {contextMenu && (() => {
        const isMulti = multiSelectedIds.size > 1 && multiSelectedIds.has(contextMenu.fileId)
        return (
          <div
            className="fixed z-50 min-w-[160px] rounded border border-surface-border bg-surface-panel shadow-lg py-1 text-[11px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {!isMulti && (
              <>
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface-hover transition-colors"
                  onClick={() => {
                    window.electronAPI.copyFile(contextMenu.filePath)
                    setContextMenu(null)
                  }}
                >
                  Copy
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface-hover transition-colors"
                  onClick={() => {
                    window.electronAPI.showInFolder(contextMenu.filePath)
                    setContextMenu(null)
                  }}
                >
                  Show in Folder
                </button>
                {(() => {
                  const cf = allFiles.find((f) => f.id === contextMenu.fileId)
                  // Only offer for files without real MFB features.
                  if (!cf || (cf.audioFeatures && !cf.audioFeaturesEstimated)) return null
                  const busy = analyzingFeatureIds.has(cf.id)
                  return (
                    <button
                      type="button"
                      disabled={busy}
                      className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface-hover transition-colors disabled:opacity-50"
                      onClick={() => { analyzeFileFeatures(cf.id); setContextMenu(null) }}
                    >
                      {busy ? 'Estimating audio features…' : cf.audioFeaturesEstimated ? 'Re-estimate audio features' : 'Estimate audio features'}
                    </button>
                  )
                })()}
                <div className="mx-2 my-1 h-px bg-surface-border" />
              </>
            )}
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-surface-hover transition-colors"
              onClick={() => {
                if (isMulti) {
                  removeFiles([...multiSelectedIds])
                  setMultiSelectedIds(new Set())
                } else {
                  removeFile(contextMenu.fileId)
                }
                setContextMenu(null)
              }}
            >
              {isMulti ? `Remove ${multiSelectedIds.size} files from Library` : 'Remove from Library'}
            </button>
          </div>
        )
      })()}

      {/* Row hover tooltip */}
      {rowTooltip && (() => {
        const { file: f, x, y } = rowTooltip
        const hourTags = hourTagsForFile(f.tags)
        const af = f.audioFeatures
        const afFields: [string, number | null | undefined][] = af ? [
          ['Intensity', af.intensity],
          ['Affective', af.affective_intensity],
          ['Activation', af.activation_intensity],
          ['Energy', af.energy],
          ['Valence', af.valence],
          ['Danceability', af.danceability],
          ['Spaciousness', af.spaciousness],
          ['Tension', af.tension],
          ['Tempo', af.tempo],
        ] : []
        return (
          <div
            className="fixed z-[999] bg-black rounded p-2 text-[10px] leading-snug border border-white/10 max-w-xs pointer-events-none"
            style={{ left: x + 12, top: y - 8, transform: 'translateY(-100%)' }}
          >
            {f.trackTitle && <div className="font-medium text-gray-100 break-all">{f.trackTitle}</div>}
            {(f.artist || f.album) && (
              <div className="text-gray-400 mt-0.5">{[f.artist, f.album].filter(Boolean).join(' — ')}</div>
            )}
            {hourTags.length > 0 && (
              <div className="text-gray-500 mt-0.5">{hourTags.join(', ')}</div>
            )}
            <div className="text-gray-500 mt-0.5 break-all">{f.folderPath}</div>
            {afFields.length > 0 && (
              <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
                {afFields.map(([label, val]) => (
                  val != null && Number.isFinite(val) ? (
                    <div key={label} className="flex gap-1 items-center">
                      <span className="w-16 text-gray-600 shrink-0">{label}</span>
                      <div className="overflow-hidden flex-1 h-1 rounded bg-white/10">
                        <div className="h-full rounded bg-accent/60" style={{ width: `${Math.min(100, Math.max(0, (val as number) * 100))}%` }} />
                      </div>
                      <span className="tabular-nums text-gray-500">{(val as number).toFixed(2)}</span>
                    </div>
                  ) : null
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {/* Footer count */}
      <div className="h-6 shrink-0 flex items-center justify-between px-3 border-t border-surface-border text-[10px] text-gray-600 select-none">
        <span>
          {files.length} file{files.length === 1 ? '' : 's'}
          {q && allFiles.length > files.length && (
            <span className="ml-1">of {allFiles.length}</span>
          )}
          {scanning && <span className="ml-2 text-accent">Scanning…</span>}
        </span>
        {allFiles.length > 0 && (
          <span className="text-gray-600">
            <span className={allFiles.length - unmatchedCount === allFiles.length ? 'text-accent' : 'text-gray-400'}>{allFiles.length - unmatchedCount}</span>
            {' / '}{allFiles.length} matched
          </span>
        )}
      </div>
    </div>
  )
}

function GripSpacer({
  onGripMouseDown,
}: {
  onGripMouseDown?: (e: React.MouseEvent) => void
}): JSX.Element {
  const interactive = onGripMouseDown !== undefined
  return (
    <div className="shrink-0 flex justify-center items-stretch -my-[1px]" style={{ width: GRIP_PX }}>
      {interactive ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize column"
          tabIndex={-1}
          className="min-w-[5px] max-w-full flex-1 self-stretch cursor-col-resize rounded-full bg-transparent hover:bg-accent/60 active:bg-accent"
          onMouseDown={onGripMouseDown}
        />
      ) : (
        <div className="self-stretch w-px opacity-0 pointer-events-none shrink-0" aria-hidden />
      )}
    </div>
  )
}

function SortHeader({
  label,
  active,
  dir,
  sortIndex,
  className,
  style,
  ariaSort,
  onSort,
}: {
  label: string
  active: boolean
  dir: SortDir
  sortIndex?: number | null
  className: string
  style?: CSSProperties
  ariaSort: SortDir | null
  onSort: (shiftKey: boolean) => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="columnheader"
      title="Shift+click to add secondary sort"
      aria-sort={ariaSort === null ? 'none' : ariaSort === 'asc' ? 'ascending' : 'descending'}
      style={style}
      onClick={(e) => onSort(e.shiftKey)}
      className={`group flex items-center gap-0.5 min-w-0 text-gray-300 hover:text-gray-300 transition-colors ${className}`}
    >
      <span className="truncate">{label}</span>
      {active && sortIndex !== null && sortIndex !== undefined && (
        <span className="shrink-0 text-[8px] text-accent/60 tabular-nums leading-none">{sortIndex}</span>
      )}
      <span
        className={`shrink-0 tabular-nums text-[9px] leading-none ${
          active ? 'text-accent' : 'text-transparent group-hover:text-gray-600'
        }`}
        aria-hidden
      >
        {active ? (dir === 'asc' ? '↑' : '↓') : '↑'}
      </span>
    </button>
  )
}

function SearchBar({ query, onChange, pendingOnly, onTogglePending, pendingCount, duplicateOnly, onToggleDuplicate, duplicateCount, unmatchedOnly, onToggleUnmatched, unmatchedCount, showRemoved, onToggleRemoved, removedCount }: {
  query: string
  onChange: (v: string) => void
  pendingOnly: boolean
  onTogglePending: () => void
  pendingCount: number
  duplicateOnly: boolean
  onToggleDuplicate: () => void
  duplicateCount: number
  unmatchedOnly: boolean
  onToggleUnmatched: () => void
  unmatchedCount: number
  showRemoved: boolean
  onToggleRemoved: () => void
  removedCount: number
}): JSX.Element {
  return (
    <div data-tour="search-bar" className="flex gap-2 items-center px-3 h-8 border-b border-surface-border bg-surface-panel shrink-0">
      <svg className="w-3 h-3 text-gray-600 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="5" r="3.5" />
        <path d="M8 8l2.5 2.5" />
      </svg>
      <input
        type="text"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search files, artists, albums, tags…"
        className="flex-1 bg-transparent text-[11px] text-gray-300 placeholder-gray-500 outline-none"
      />
      {query && (
        <button onClick={() => onChange('')} className="text-gray-600 transition-colors hover:text-gray-400">
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      )}
      {pendingCount > 0 && (
        <button
          type="button"
          onClick={onTogglePending}
          className={`shrink-0 flex items-center gap-1 px-1.5 py-px text-[9px] font-medium rounded transition-colors ${
            pendingOnly
              ? 'bg-accent/30 text-accent border border-accent/40'
              : 'bg-surface-hover text-gray-600 border border-surface-border hover:text-gray-300'
          }`}
        >
          pending
          <span className="tabular-nums">{pendingCount}</span>
        </button>
      )}
      {duplicateCount > 0 && (
        <button
          type="button"
          onClick={onToggleDuplicate}
          className={`shrink-0 flex items-center gap-1 px-1.5 py-px text-[9px] font-medium rounded transition-colors ${
            duplicateOnly
              ? 'bg-yellow-500/25 text-yellow-300 border border-yellow-500/40'
              : 'bg-surface-hover text-gray-600 border border-surface-border hover:text-gray-300'
          }`}
        >
          dupes
          <span className="tabular-nums">{duplicateCount}</span>
        </button>
      )}
      {unmatchedCount > 0 && (
        <button
          type="button"
          onClick={onToggleUnmatched}
          className={`shrink-0 flex items-center gap-1 px-1.5 py-px text-[9px] font-medium rounded transition-colors ${
            unmatchedOnly
              ? 'bg-gray-500/25 text-gray-300 border border-gray-500/40'
              : 'bg-surface-hover text-gray-600 border border-surface-border hover:text-gray-300'
          }`}
        >
          unlinked
          <span className="tabular-nums">{unmatchedCount}</span>
        </button>
      )}
      {removedCount > 0 && (
        <button
          type="button"
          onClick={onToggleRemoved}
          className={`shrink-0 flex items-center gap-1 px-1.5 py-px text-[9px] font-medium rounded transition-colors ${
            showRemoved
              ? 'bg-red-500/20 text-red-400 border border-red-500/40'
              : 'bg-surface-hover text-gray-600 border border-surface-border hover:text-gray-300'
          }`}
        >
          removed
          <span className="tabular-nums">{removedCount}</span>
        </button>
      )}
    </div>
  )
}
