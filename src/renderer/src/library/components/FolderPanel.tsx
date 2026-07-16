import { useEffect, useRef, useState } from 'react'
import { useLibraryStore } from '../store/libraryStore'
import { phaseColorForTag } from '../types'
import { syncLibraryToMfb } from '../lib/syncLibrary'
import { runCueScan } from '../lib/cueScan'
import { runFeatureScan } from '../lib/featureScan'
import { getMixEngine } from '../lib/mixEngineSingleton'
import type { MixSession } from '../store/libraryStore'

interface Props {
  onAddFolder: (folderPath?: string) => void
  onRescan: () => void
}

type PanelMode = 'tags' | 'playlists' | 'sessions' | 'folders'

/** Compact "42m" / "1h 5m" duration label for the session list. */
function fmtSessionDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 60) return `${totalMin}m`
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`
}

/** Story-structure hour tags shown in sidebar order; counts come from library files */
const PRESET_HOUR_TAGS = [
  'Call to adventure',
  'Jumpstart',
  'First Hour',
  'Second Hour Transition',
  'Second Hour',
  'Breakthrough Tension',
  'Breakthrough',
  'Breakthrough Release',
  'Third Hour Transition',
  'Third Hour',
] as const

function buildSidebarTags(files: { tags: readonly string[] }[]): [string, number][] {
  // Count case-insensitively; preserve original casing from first occurrence in files
  const counts = new Map<string, number>()
  const display = new Map<string, string>() // lower → display label

  for (const f of files) {
    for (const t of f.tags) {
      const lower = t.toLowerCase()
      counts.set(lower, (counts.get(lower) ?? 0) + 1)
      if (!display.has(lower)) display.set(lower, t)
    }
  }

  const presetLower = new Set(PRESET_HOUR_TAGS.map((t) => t.toLowerCase()))
  const ordered: [string, number][] = PRESET_HOUR_TAGS.map((tag) => {
    const lower = tag.toLowerCase()
    return [display.get(lower) ?? tag, counts.get(lower) ?? 0]
  })

  const extras = Array.from(counts.keys())
    .filter((lower) => !presetLower.has(lower))
    .sort((a, b) => a.localeCompare(b))
    .map((lower): [string, number] => [display.get(lower)!, counts.get(lower)!])

  return [...ordered, ...extras]
}

export function FolderPanel({ onAddFolder, onRescan }: Props): JSX.Element {
  const [mode, setMode] = useState<PanelMode>('tags')
  const [isDragOver, setIsDragOver] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; folderId: string } | null>(null)
  const [tagQuery, setTagQuery] = useState('')
  const [folderQuery, setFolderQuery] = useState('')
  const [playlistSearch, setPlaylistSearch] = useState('')
  const [playlistSort, setPlaylistSort] = useState<'name' | 'date'>('date')
  const [playlistSortDir, setPlaylistSortDir] = useState<'asc' | 'desc'>('desc')
  const [loadingPlaylists, setLoadingPlaylists] = useState(false)
  const [dropWarning, setDropWarning] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncDone, setSyncDone] = useState(false)
  const syncDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [contextMenu])

  const watchedFolders = useLibraryStore((s) => s.watchedFolders)
  const selectedFolderId = useLibraryStore((s) => s.selectedFolderId)
  const selectedTags = useLibraryStore((s) => s.selectedTags)
  const selectedPlaylistId = useLibraryStore((s) => s.selectedPlaylistId)

  // Auto-switch to tags tab when a tag is selected from outside this panel
  useEffect(() => {
    if (selectedTags.length > 0 && mode !== 'tags') setMode('tags')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTags.length])
  const selectFolder = useLibraryStore((s) => s.selectFolder)
  const toggleSelectedTag = useLibraryStore((s) => s.toggleSelectedTag)
  const clearSelectedTags = useLibraryStore((s) => s.clearSelectedTags)
  const removeWatchedFolder = useLibraryStore((s) => s.removeWatchedFolder)
  const unmatchedOnly = useLibraryStore((s) => s.unmatchedOnly)
  const setUnmatchedOnly = useLibraryStore((s) => s.setUnmatchedOnly)
  const files = useLibraryStore((s) => s.files)
  const scanning = useLibraryStore((s) => s.scanning)
  const userAccount = useLibraryStore((s) => s.userAccount)
  const playlists = useLibraryStore((s) => s.playlists)
  const setPlaylists = useLibraryStore((s) => s.setPlaylists)
  const selectPlaylist = useLibraryStore((s) => s.selectPlaylist)
  const playlistTrackQuery = useLibraryStore((s) => s.playlistTrackQuery)
  const setPlaylistTrackQuery = useLibraryStore((s) => s.setPlaylistTrackQuery)
  const cueScan = useLibraryStore((s) => s.cueScan)
  const featureScan = useLibraryStore((s) => s.featureScan)
  const mixSessions = useLibraryStore((s) => s.mixSessions)
  const enterMixMode = useLibraryStore((s) => s.enterMixMode)
  const loadSession = useLibraryStore((s) => s.loadSession)

  // Clicking a session: load its tracklist, switch to playback (mix) mode, and
  // start playing. This click is a valid audio gesture so play() can begin.
  function openSession(session: MixSession): void {
    loadSession(session.id)
    enterMixMode()
    const e = getMixEngine()
    e.xfadeMs = session.skeleton.mixFadeMs
    e.play()
  }

  const totalFiles = files.length
  const matchedFiles = files.filter((f) => f.mfbTrackId !== null).length
  const unmatchedCount = totalFiles - matchedFiles
  const sidebarTags = buildSidebarTags(files)

  // Fetch playlists whenever the user logs in
  useEffect(() => {
    if (!userAccount) {
      setPlaylists([])
      return
    }
    setLoadingPlaylists(true)
    window.electronAPI.getUserPlaylists()
      .then(setPlaylists)
      .finally(() => setLoadingPlaylists(false))
  }, [userAccount, setPlaylists])

  function switchMode(next: PanelMode): void {
    setMode(next)
    if (next === 'folders') {
      clearSelectedTags()
      setTagQuery('')
      setPlaylistSearch('')
      setPlaylistTrackQuery('')
      selectPlaylist(null)
    } else if (next === 'tags') {
      selectFolder(null)
      setFolderQuery('')
      setPlaylistSearch('')
      setPlaylistTrackQuery('')
      selectPlaylist(null)
    } else if (next === 'sessions') {
      selectFolder(null)
      setFolderQuery('')
      clearSelectedTags()
      setTagQuery('')
      setPlaylistSearch('')
      setPlaylistTrackQuery('')
      selectPlaylist(null)
    } else {
      selectFolder(null)
      setFolderQuery('')
      clearSelectedTags()
      setTagQuery('')
    }
  }

  const folderFilter = folderQuery.trim().toLowerCase()
  const filteredFolders = folderFilter
    ? watchedFolders.filter((f) => f.label.toLowerCase().includes(folderFilter))
    : watchedFolders

  const tagFilter = tagQuery.trim().toLowerCase()
  const filteredTags = tagFilter
    ? sidebarTags.filter(([tag]) => tag.toLowerCase().includes(tagFilter))
    : sidebarTags

  const playlistFilter = playlistSearch.trim().toLowerCase()
  const filteredPlaylists = playlists
    .filter((p) => !playlistFilter || p.title.toLowerCase().includes(playlistFilter))
    .slice()
    .sort((a, b) => {
      const base = playlistSort === 'name' ? a.title.localeCompare(b.title) : b.id - a.id
      return playlistSortDir === 'asc' ? base : -base
    })

  function handleDragOver(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent): void {
    e.preventDefault()
    setIsDragOver(false)
  }

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const paths: string[] = []

    // Prefer items (better directory support in Electron)
    if (e.dataTransfer.items?.length > 0) {
      for (const item of Array.from(e.dataTransfer.items)) {
        const file = item.getAsFile()
        const path = (file as unknown as { path: string } | null)?.path
        if (path) paths.push(path)
      }
    }

    // Fallback to files
    if (paths.length === 0) {
      for (const file of Array.from(e.dataTransfer.files)) {
        const path = (file as unknown as { path: string }).path
        if (path) paths.push(path)
      }
    }

    for (const path of paths) {
      const existing = watchedFolders.find((f) => f.path === path)
      if (existing) {
        setDropWarning(`"${existing.label}" is already in your library`)
        setTimeout(() => setDropWarning(null), 3000)
      } else {
        onAddFolder(path)
      }
    }
  }

  return (
    <div
      data-tour="folder-panel"
      className={`relative flex flex-col w-96 shrink-0 border-r border-surface-border bg-surface-panel transition-colors ${isDragOver ? 'bg-accent/10' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dropWarning && (
        <div className="absolute bottom-12 left-2 right-2 z-20 px-2.5 py-2 rounded border border-yellow-600/40 bg-yellow-900/60 text-[10px] text-yellow-300 leading-snug pointer-events-none">
          {dropWarning}
        </div>
      )}

      {isDragOver && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded pointer-events-none border-accent/60">
          <svg className="w-6 h-6 text-accent/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 012-2h3l2 2h9a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
          <span className="text-[11px] text-accent/70">Drop folder</span>
        </div>
      )}
      {/* Mode toggle */}
      <div className="flex border-b border-surface-border shrink-0">
        {(['tags', 'playlists', 'sessions', 'folders'] as PanelMode[]).map((m) => (
          <button
            key={m}
            data-tour={m === 'playlists' ? 'playlists-tab' : undefined}
            onClick={() => switchMode(m)}
            className={`flex-1 py-2 text-[10px] uppercase tracking-wider transition-colors ${
              mode === m
                ? 'text-gray-200 bg-surface-hover border-b-2 border-accent -mb-px'
                : 'text-gray-200 hover:text-gray-400'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === 'folders' && (
        <>
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-surface-border shrink-0">
            <svg className="w-3 h-3 text-gray-600 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5" cy="5" r="3.5" />
              <path d="M8 8l2.5 2.5" />
            </svg>
            <input
              type="text"
              value={folderQuery}
              onChange={(e) => setFolderQuery(e.target.value)}
              placeholder="Filter folders…"
              className="flex-1 min-w-0 bg-transparent text-[11px] text-gray-300 placeholder-gray-700 outline-none"
            />
            {folderQuery ? (
              <button type="button" onClick={() => setFolderQuery('')} className="text-gray-600 transition-colors hover:text-gray-400 shrink-0" title="Clear filter">
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => { selectFolder(null); setUnmatchedOnly(false) }}
            className={`flex items-center justify-between px-3 py-1.5 text-left transition-colors ${
              selectedFolderId === null && !unmatchedOnly
                ? 'bg-accent/15 text-gray-200'
                : 'text-gray-400 hover:bg-surface-hover hover:text-gray-200'
            }`}
          >
            <span className="text-[11px] font-medium">All Files</span>
            <span className="text-[10px] text-gray-600 tabular-nums">{totalFiles}</span>
          </button>
          {userAccount && unmatchedCount > 0 && (
            <button
              type="button"
              onClick={() => { selectFolder(null); setUnmatchedOnly(!unmatchedOnly) }}
              className={`flex items-center justify-between px-3 py-1.5 text-left transition-colors ${
                unmatchedOnly
                  ? 'bg-accent/15 text-gray-200'
                  : 'text-gray-400 hover:bg-surface-hover hover:text-gray-200'
              }`}
            >
              <span className="text-[11px]">Unmatched</span>
              <span className="text-[10px] tabular-nums text-yellow-600">{unmatchedCount}</span>
            </button>
          )}
        </>
      )}

      <div className="flex flex-col flex-1 min-h-0">
        {mode === 'tags' && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-surface-border shrink-0">
            <svg className="w-3 h-3 text-gray-600 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5" cy="5" r="3.5" />
              <path d="M8 8l2.5 2.5" />
            </svg>
            <input
              type="text"
              value={tagQuery}
              onChange={(e) => setTagQuery(e.target.value)}
              placeholder="Filter tags…"
              className="flex-1 min-w-0 bg-transparent text-[11px] text-gray-300 placeholder-gray-700 outline-none"
            />
            {tagQuery ? (
              <button type="button" onClick={() => setTagQuery('')} className="text-gray-600 transition-colors hover:text-gray-400 shrink-0" title="Clear filter">
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </button>
            ) : null}
          </div>
        )}

        {mode === 'playlists' && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-surface-border shrink-0">
            <svg className="w-3 h-3 text-gray-600 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5" cy="5" r="3.5" />
              <path d="M8 8l2.5 2.5" />
            </svg>
            <input
              type="text"
              value={playlistSearch}
              onChange={(e) => setPlaylistSearch(e.target.value)}
              placeholder="Search playlists…"
              className="flex-1 min-w-0 bg-transparent text-[11px] text-gray-300 placeholder-gray-700 outline-none"
            />
            {playlistSearch ? (
              <button type="button" onClick={() => setPlaylistSearch('')} className="text-gray-600 transition-colors hover:text-gray-400 shrink-0" title="Clear search">
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </button>
            ) : null}
          </div>
        )}

        {/* List */}
        <div className="flex-1 min-h-0 overflow-y-auto">
        {mode === 'folders' ? (
          filteredFolders.length === 0 && folderQuery ? (
            <p className="px-3 py-3 text-[10px] text-gray-500">No matching folders</p>
          ) : filteredFolders.map((folder) => {
            const count = files.filter((f) => f.filePath.startsWith(folder.path)).length
            return (
              <button
                key={folder.id}
                title={folder.path}
                onClick={() => selectFolder(folder.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setContextMenu({ x: e.clientX, y: e.clientY, folderId: folder.id })
                }}
                className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors ${
                  selectedFolderId === folder.id
                    ? 'bg-accent/15 text-gray-200'
                    : 'text-gray-400 hover:bg-surface-hover hover:text-gray-200'
                }`}
              >
                <div className="flex items-center min-w-0 gap-2">
                  <svg className="w-3 h-3 text-gray-600 shrink-0" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M1 3.5A1.5 1.5 0 012.5 2h2l1.5 1.5H9.5A1.5 1.5 0 0111 5v4A1.5 1.5 0 019.5 10.5h-7A1.5 1.5 0 011 9V3.5z" />
                  </svg>
                  <span className="text-[11px] truncate">{folder.label}</span>
                </div>
                <span className="text-[10px] text-gray-600 tabular-nums shrink-0 ml-1">{count}</span>
              </button>
            )
          })
        ) : mode === 'tags' ? (
          filteredTags.length === 0 ? (
            <p className="px-3 py-3 text-[10px] text-gray-500">No matching tags</p>
          ) : (
            filteredTags.map(([tag, count]) => {
              const isOn = selectedTags.includes(tag)
              const phaseColor = phaseColorForTag(tag)
              return (
              <button
                key={tag}
                type="button"
                aria-pressed={isOn}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-limina-tag', tag)
                  e.dataTransfer.setData('text/plain', tag)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => toggleSelectedTag(tag)}
                className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors ${
                  isOn
                    ? 'text-gray-200 bg-accent/15'
                    : 'text-gray-400 hover:bg-surface-hover hover:text-gray-200'
                }`}
              >
                <div className="flex items-center min-w-0 gap-2">
                  <svg
                    className="w-3 h-3 shrink-0"
                    viewBox="0 0 12 12"
                    fill="currentColor"
                    style={{ color: phaseColor ?? '#4b5563' }}
                  >
                    <path d="M1.5 2A1.5 1.5 0 013 .5h3.879a1.5 1.5 0 011.06.44l3.122 3.12a1.5 1.5 0 010 2.122L7.94 9.31a1.5 1.5 0 01-2.122 0L2.44 5.94A1.5 1.5 0 012 4.879V2zM4 3.5a.5.5 0 100 1 .5.5 0 000-1z" />
                  </svg>
                  <span className="text-[11px] truncate">{tag}</span>
                </div>
                <span className="text-[10px] text-gray-600 tabular-nums shrink-0 ml-1">{count}</span>
              </button>
              )
            })
          )
        ) : mode === 'sessions' ? (
          !userAccount ? (
            <p className="px-3 py-4 text-[11px] text-gray-600 text-center leading-relaxed">
              Build and play a mix for free.<br />Recording &amp; saving sessions<br />is a Pro feature.
            </p>
          ) : mixSessions.length === 0 ? (
            <p className="px-3 py-4 text-[11px] text-gray-600 text-center leading-relaxed">
              No sessions yet.<br />Create one to build a mix.
            </p>
          ) : mixSessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => openSession(s)}
              title="Load this session and play"
              className="flex flex-col items-start w-full px-3 py-2 text-left text-gray-400 transition-colors border-b hover:bg-surface-hover hover:text-gray-200 border-surface-border/40"
            >
              <div className="flex items-center w-full min-w-0 gap-2">
                <svg className="w-3 h-3 text-accent shrink-0" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3h2.5a4 4 0 013.2 1.6L9 6.5l1.3 1.9A4 4 0 0013.5 10M2 10h2.5a4 4 0 002.8-1.2M13.5 4h-1.5a4 4 0 00-3.2 1.6" />
                </svg>
                <span className="text-[11px] truncate">{s.name}</span>
              </div>
              <span className="text-[10px] text-gray-600 mt-0.5 pl-5">
                {new Date(s.startedAt).toLocaleDateString()} · {fmtSessionDuration(s.durationMs)} · {s.played.length} tracks
              </span>
            </button>
          ))
        ) : !userAccount ? (
          <p className="px-3 py-4 text-[11px] text-gray-600 text-center leading-relaxed">
            Sign in to view your<br /> Music for Breathwork playlists
          </p>
        ) : loadingPlaylists ? (
          <p className="px-3 py-3 text-[10px] text-gray-500">Loading…</p>
        ) : playlists.length === 0 ? (
          <p className="px-3 py-3 text-[10px] text-gray-300">No playlists found</p>
        ) : (
          <>
            <div className="flex gap-px px-2 py-1.5 border-b border-surface-border sticky top-0 bg-surface-panel z-10">
              {(['date', 'name'] as const).map((s, i) => {
                const active = playlistSort === s
                const label = s === 'date' ? 'Newest' : 'Name'
                const dir = active ? playlistSortDir : (s === 'date' ? 'desc' : 'asc')
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      if (active) {
                        setPlaylistSortDir((d) => d === 'asc' ? 'desc' : 'asc')
                      } else {
                        setPlaylistSort(s)
                        setPlaylistSortDir(s === 'date' ? 'desc' : 'asc')
                      }
                    }}
                    className={`flex-1 flex items-center justify-center gap-1 py-0.5 text-[9px] uppercase tracking-wider border transition-colors ${
                      i === 0 ? 'rounded-l' : 'rounded-r'
                    } ${
                      active
                        ? 'border-accent/50 bg-accent/15 text-accent'
                        : 'border-surface-border text-gray-600 hover:text-gray-400 hover:bg-surface-hover'
                    }`}
                  >
                    {label}
                    <svg
                      className="w-2.5 h-2.5 shrink-0"
                      viewBox="0 0 10 10"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ opacity: active ? 1 : 0.3 }}
                    >
                      {dir === 'asc'
                        ? <path d="M2 7l3-4 3 4" />
                        : <path d="M2 3l3 4 3-4" />
                      }
                    </svg>
                  </button>
                )
              })}
            </div>
            {/* Track search across all playlists */}
            <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-surface-border/50 shrink-0 bg-surface-panel/60 sticky top-[1.625rem] z-10">
              <svg className="w-3 h-3 text-gray-700 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="5" cy="5" r="3.5" />
                <path d="M8 8l2.5 2.5" />
              </svg>
              <input
                type="text"
                value={playlistTrackQuery}
                onChange={(e) => setPlaylistTrackQuery(e.target.value)}
                placeholder="Find track in playlists…"
                className="flex-1 min-w-0 bg-transparent text-[11px] text-gray-400 placeholder-gray-700 outline-none"
              />
              {playlistTrackQuery ? (
                <button type="button" onClick={() => setPlaylistTrackQuery('')} className="text-gray-600 transition-colors hover:text-gray-400 shrink-0" title="Clear">
                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M2 2l8 8M10 2l-8 8" />
                  </svg>
                </button>
              ) : null}
            </div>
            {filteredPlaylists.length === 0 ? (
              <p className="px-3 py-3 text-[10px] text-gray-500">No matching playlists</p>
            ) : filteredPlaylists.map((playlist) => {
            const trackIdSet = new Set(playlist.trackIds)
            const inLibrary = new Set(
              files.flatMap((f) => f.mfbTrackId !== null && trackIdSet.has(f.mfbTrackId) ? [f.mfbTrackId] : [])
            ).size
            const total = trackIdSet.size
            return (
              <button
                key={playlist.id}
                type="button"
                onClick={() => selectPlaylist(selectedPlaylistId === playlist.id ? null : playlist.id)}
                className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors ${
                  selectedPlaylistId === playlist.id
                    ? 'bg-accent/15 text-gray-200'
                    : 'text-gray-400 hover:bg-surface-hover hover:text-gray-200'
                }`}
              >
                <div className="flex items-center min-w-0 gap-2">
                  {playlist.image_url ? (
                    <img src={playlist.image_url} alt="" className="object-cover w-4 h-4 rounded shrink-0" />
                  ) : (
                    <svg className="w-3 h-3 text-gray-600 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 3h8M1 6h6M1 9h4" />
                    </svg>
                  )}
                  <span className="text-[11px] truncate">{playlist.title}</span>
                </div>
                <span className={`text-[10px] tabular-nums shrink-0 ml-1 ${inLibrary > 0 ? 'text-accent' : 'text-gray-300'}`}>
                  {inLibrary}/{total}
                </span>
              </button>
            )
          })}
          </>
        )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-col gap-1 p-2 border-t border-surface-border shrink-0">
        {mode === 'sessions' && (
          <button
            type="button"
            onClick={() => enterMixMode()}
            className="w-full flex items-center justify-center gap-1.5 h-7 text-[11px] font-medium rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            title="Create a new session — build a crossfading mix from tags"
          >
            <svg className="w-3 h-3 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M6 2v8M2 6h8" />
            </svg>
            Create session
          </button>
        )}
        {mode === 'tags' && selectedTags.length > 0 && (
          <button
            type="button"
            onClick={() => clearSelectedTags()}
            className="w-full flex items-center justify-center gap-1.5 min-h-[1.5rem] px-2 text-[11px] text-gray-500 hover:text-gray-300 transition-colors rounded hover:bg-surface-hover"
            title="Remove all selected tag filters"
          >
            <svg className="w-3 h-3 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
            Clear tags ({selectedTags.length})
          </button>
        )}
        {mode === 'tags' && selectedTags.length === 0 && sidebarTags.length > 0 && (
          <p className="text-center text-[10px] text-gray-600 py-0.5">
            {sidebarTags.length} tag{sidebarTags.length === 1 ? '' : 's'}
          </p>
        )}

        {/* Folders mode: Sync + Add in compact 2-column grid */}
        {mode === 'folders' && (
          <div className="grid gap-1" style={{ gridTemplateColumns: userAccount && matchedFiles > 0 ? '1fr 1fr' : '1fr' }}>
            {userAccount && matchedFiles > 0 && (
              <button
                type="button"
                disabled={syncing}
                onClick={async () => {
                  setSyncing(true)
                  setSyncDone(false)
                  await syncLibraryToMfb()
                  setSyncing(false)
                  setSyncDone(true)
                  if (syncDoneTimerRef.current) clearTimeout(syncDoneTimerRef.current)
                  syncDoneTimerRef.current = setTimeout(() => setSyncDone(false), 2500)
                }}
                className="flex items-center justify-center gap-1 h-6 text-[10px] transition-colors rounded border border-surface-border bg-surface-hover hover:bg-surface-border disabled:opacity-40 text-accent/70 hover:text-accent"
                title="Sync library matches to Music for Breathwork"
              >
                {syncDone ? (
                  <>
                    <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 6l3 3 5-5" />
                    </svg>
                    Synced
                  </>
                ) : syncing ? (
                  <>
                    <svg className="w-2.5 h-2.5 animate-spin shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M6 1v2M6 9v2M1 6h2M9 6h2" />
                    </svg>
                    Syncing…
                  </>
                ) : (
                  <>
                    <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.5 6A4.5 4.5 0 1 1 6 1.5" />
                      <path d="M6 1.5l2.5-1M6 1.5l1 2.5" />
                    </svg>
                    Sync M4B
                  </>
                )}
              </button>
            )}
            <button
              onClick={() => onAddFolder()}
              disabled={scanning}
              className="flex items-center justify-center gap-1 h-6 text-[10px] text-gray-400 hover:text-gray-300 transition-colors rounded border border-surface-border bg-surface-hover hover:bg-surface-border disabled:opacity-40"
            >
              <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
                <path d="M6 2v8M2 6h8" />
              </svg>
              Add Folder
            </button>
          </div>
        )}

        {/* Bottom row: refresh button */}
        {(mode === 'folders' || (mode === 'playlists' && userAccount)) && (
          <button
            type="button"
            title={mode === 'folders' ? 'Rescan folders' : 'Refresh playlists'}
            disabled={mode === 'folders' ? scanning : loadingPlaylists}
            onClick={() => {
              if (mode === 'folders') {
                onRescan()
              } else if (mode === 'playlists' && userAccount) {
                setLoadingPlaylists(true)
                window.electronAPI.getUserPlaylists()
                  .then(setPlaylists)
                  .finally(() => setLoadingPlaylists(false))
              }
            }}
            className="w-full flex items-center justify-center gap-1 h-6 text-[10px] text-gray-400 hover:text-gray-300 transition-colors rounded border border-surface-border bg-surface-hover hover:bg-surface-border disabled:opacity-40"
          >
            <svg
              className={`w-2.5 h-2.5 shrink-0 ${(mode === 'folders' && scanning) || (mode === 'playlists' && loadingPlaylists) ? 'animate-spin' : ''}`}
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.5 6A4.5 4.5 0 1 1 6 1.5" />
              <path d="M6 1.5l2.5-1M6 1.5l1 2.5" />
            </svg>
            Refresh
          </button>
        )}
      </div>

      {contextMenu && (() => {
        const folder = watchedFolders.find((f) => f.id === contextMenu.folderId)
        if (!folder) return null
        return (
          <div
            className="fixed z-50 min-w-[160px] rounded border border-surface-border bg-surface-panel shadow-lg py-0.5 text-[11px]"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="w-full px-3 py-1.5 text-left text-gray-300 hover:bg-surface-hover transition-colors"
              onClick={() => { window.electronAPI.showInFolder(folder.path); setContextMenu(null) }}
            >
              Show in Finder
            </button>
            <button
              type="button"
              disabled={cueScan.running}
              className="w-full px-3 py-1.5 text-left text-gray-300 hover:bg-surface-hover transition-colors disabled:opacity-50"
              onClick={() => { runCueScan({ force: true }); setContextMenu(null) }}
            >
              {cueScan.running ? `Scanning cue points… ${cueScan.done}/${cueScan.total}` : 'Scan track cue points'}
            </button>
            <button
              type="button"
              disabled={featureScan.running}
              className="w-full px-3 py-1.5 text-left text-gray-300 hover:bg-surface-hover transition-colors disabled:opacity-50"
              onClick={() => { runFeatureScan({ force: true }); setContextMenu(null) }}
            >
              {featureScan.running ? `Estimating audio features… ${featureScan.done}/${featureScan.total}` : 'Estimate audio features'}
            </button>
            <div className="my-0.5 border-t border-surface-border" />
            <button
              type="button"
              className="w-full px-3 py-1.5 text-left text-red-400 hover:bg-surface-hover transition-colors"
              onClick={() => { removeWatchedFolder(folder.id); setContextMenu(null) }}
            >
              Remove Folder
            </button>
          </div>
        )
      })()}
    </div>
  )
}
