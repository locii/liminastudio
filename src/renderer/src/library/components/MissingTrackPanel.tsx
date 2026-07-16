import { useState } from 'react'
import { useLibraryStore } from '../store/libraryStore'
import { mfbTrackUrl, appleMusicDeepLink } from '../types'
import type { BreathworkPhase, LibraryFile, MfbAudioFeatures } from '../types'

export function MissingTrackPanel(): JSX.Element {
  const selectedMissingTrackId = useLibraryStore((s) => s.selectedMissingTrackId)
  const selectMissingTrack = useLibraryStore((s) => s.selectMissingTrack)
  const allFiles = useLibraryStore((s) => s.files)
  const updateFile = useLibraryStore((s) => s.updateFile)
  const selectFile = useLibraryStore((s) => s.selectFile)

  const [query, setQuery] = useState(() => {
    const id = useLibraryStore.getState().selectedMissingTrackId
    if (id === null) return ''
    const detail = useLibraryStore.getState().selectedPlaylistDetail
    const track = detail?.segments.flatMap((s) => s.tracks).find((t) => t.id === id)
    return track?.title ?? ''
  })
  const addFiles = useLibraryStore((s) => s.addFiles)
  const addWatchedFolder = useLibraryStore((s) => s.addWatchedFolder)
  const [pickedFileId, setPickedFileId] = useState<string | null>(null)
  const [pickedDiskPath, setPickedDiskPath] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [done, setDone] = useState(false)
  const [applyError, setApplyError] = useState('')
  const [searching, setSearching] = useState(false)
  const [diskResults, setDiskResults] = useState<string[]>([])
  const [diskSearched, setDiskSearched] = useState(false)
  const [addingFolder, setAddingFolder] = useState(false)
  const [folderAdded, setFolderAdded] = useState(false)

  const selectedPlaylistDetail = useLibraryStore((s) => s.selectedPlaylistDetail)
  const track = selectedMissingTrackId !== null
    ? selectedPlaylistDetail?.segments.flatMap((s) => s.tracks).find((t) => t.id === selectedMissingTrackId) ?? null
    : null

  if (!track) return <></>

  const q = query.trim().toLowerCase()
  const filteredFiles = allFiles.filter((f) => {
    if (!q) return true
    return (
      (f.fileName ?? '').toLowerCase().includes(q) ||
      (f.artist ?? '').toLowerCase().includes(q) ||
      (f.artistPathGuess ?? '').toLowerCase().includes(q) ||
      (f.trackTitle ?? '').toLowerCase().includes(q)
    )
  })

  async function handleFindOnDisk(): Promise<void> {
    if (!track) return
    setSearching(true)
    setDiskSearched(false)
    try {
      const paths = await window.electronAPI.findOnDisk(track.title, track.artist)
      setDiskResults(paths)
    } catch { /* ignore */ } finally {
      setSearching(false)
      setDiskSearched(true)
    }
  }

  async function handleAddParentFolder(filePath: string): Promise<void> {
    const sep = filePath.includes('\\') ? '\\' : '/'
    const folderPath = filePath.split(sep).slice(0, -1).join(sep)
    if (!folderPath) return
    setAddingFolder(true)
    try {
      const [folder, result] = await Promise.all([
        window.electronAPI.buildWatchedFolder(folderPath),
        window.electronAPI.scanFolder(folderPath),
      ])
      addWatchedFolder(folder)
      addFiles(result.files)
      setFolderAdded(true)
    } catch (err) {
      console.error('[missing track] failed to add folder', err)
    } finally {
      setAddingFolder(false)
    }
  }

  async function handleApply(): Promise<void> {
    const targetId = pickedFileId ?? null
    const diskPath = pickedDiskPath ?? null
    if (!targetId && !diskPath) return
    if (!track) return
    setApplying(true)
    setApplyError('')
    try {
      // If picked from disk, scan the file and add it to the library first
      let resolvedFileId = targetId
      if (!resolvedFileId && diskPath) {
        const scanned = (await window.electronAPI.scanFile(diskPath)) as LibraryFile | null
        if (!scanned) { setApplyError('Could not read file — check it exists and is accessible.'); return }
        addFiles([scanned])
        resolvedFileId = scanned.id
      }
      if (!resolvedFileId) return

      const data = (await window.electronAPI.mfbGetTrack(track.id)) as {
        id: number
        title: string
        description: string
        artists: { id: number; name: string }[]
        album: { id: number; title: string; image_url: string }
        tags: Record<string, { id: number; name: string; slug: { en: string } }[]>
        audio_features?: MfbAudioFeatures
      }
      const tagsData = data.tags ?? {}
      const artist = (data.artists ?? []).map((a) => a.name).join(', ')
      const tags = Object.values(tagsData).flat().map((t) => t.name)
      const hourSlug = tagsData['Hour']?.[0]?.slug?.en
      updateFile(resolvedFileId, {
        artist,
        album: data.album?.title ?? '',
        tags,
        notes: data.description ?? '',
        trackTitle: data.title,
        mfbTrackId: data.id,
        mfbApplied: true,
        appliedPathGuess: true,
        audioFeatures: data.audio_features ?? null,
        bandcampUrl: (data as { bandcamp_url?: string }).bandcamp_url ?? null,
        beatportUrl: (data as { beatport_url?: string }).beatport_url ?? null,
        ...(hourSlug ? { breathworkPhase: hourSlug as BreathworkPhase } : {}),
      })
      setDone(true)
      setTimeout(() => {
        selectFile(resolvedFileId!)
      }, 800)
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Something went wrong — check your connection and try again.')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="flex flex-col w-full h-full border-l border-surface-border bg-surface-panel">
      {/* Header */}
      <div className="flex flex-col gap-2 p-3 border-b border-surface-border shrink-0">
        <div className="flex items-start gap-2">
          {track.album_image_url && (
            <img src={track.album_image_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
          )}
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <p className="text-[11px] text-gray-200 font-medium leading-snug">{track.title}</p>
            <p className="text-[11px] text-gray-500">{track.artist}</p>
          </div>
          
            <button
              type="button"
              onClick={() => window.open(mfbTrackUrl(track.id, track.title))}
              title="View on Music for Breathwork"
              className="flex justify-center items-center w-6 h-6 text-gray-600 rounded transition-colors hover:text-accent hover:bg-surface-hover"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8A1.5 1.5 0 0 0 13 12.5V9M9.5 2H14v4.5M14 2L7.5 8.5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => selectMissingTrack(null)}
              className="flex justify-center items-center w-6 h-6 text-gray-600 rounded transition-colors hover:text-gray-400 hover:bg-surface-hover"
              title="Close"
            >
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </div>
        </div>
        <div className="px-2 py-1.5 rounded bg-surface-hover border border-surface-border">
          <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Not in library</p>
          <p className="text-[10px] text-gray-500 leading-relaxed">
            Find the matching file below and apply to link it.
          </p>
          
        </div>
        <div className="flex gap-2 items-center p-2 shrink-0">
            {track.bandcamp_url && (
              <button
                type="button"
                onClick={() => window.open(track.bandcamp_url!)}
                className="px-2.5 py-1 text-[10px] font-medium rounded border transition-colors text-[#1da0c3] border-[#1da0c3]/40 bg-[#1da0c3]/10 hover:bg-[#1da0c3]/20"
              >
                Buy on Bandcamp
              </button>
            )}
            {track.beatport_url && (
              <button
                type="button"
                onClick={() => window.open(track.beatport_url!)}
                className="px-2.5 py-1 text-[10px] font-medium rounded border transition-colors text-[#97f04f] border-[#97f04f]/40 bg-[#97f04f]/10 hover:bg-[#97f04f]/20"
              >
                Buy on Beatport
              </button>
            )}
            {track.apple_music_url && (
              <button
                type="button"
                onClick={() => window.open(appleMusicDeepLink(track.apple_music_url!))}
                className="px-2.5 py-1 text-[10px] font-medium rounded border transition-colors text-[#fc3c44] border-[#fc3c44]/40 bg-[#fc3c44]/10 hover:bg-[#fc3c44]/20"
              >
                Buy on Apple Music
              </button>
            )}
      </div>

      {/* File search */}
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-1.5 px-3 h-8 border-b border-surface-border shrink-0">
          <svg className="w-3 h-3 text-gray-600 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="5" cy="5" r="3.5" />
            <path d="M8 8l2.5 2.5" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your library…"
            autoFocus
            className="flex-1 bg-transparent text-[11px] text-gray-300 placeholder-gray-700 outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-600 transition-colors hover:text-gray-400">
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={handleFindOnDisk}
            disabled={searching}
            title="Search for this track on disk"
            className="shrink-0 flex items-center gap-1 px-1.5 py-px text-[9px] rounded border border-surface-border text-gray-600 hover:text-gray-300 hover:border-gray-500 transition-colors disabled:opacity-40"
          >
            {searching ? (
              <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 1v1.5M5 7.5V9M1 5h1.5M7.5 5H9" strokeLinecap="round" />
              </svg>
            ) : (
              <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 9L1 8l2-2M1 8l2 1M7 1.5A3.5 3.5 0 1 1 3.5 5" />
              </svg>
            )}
            Find on disk
          </button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0">
          {filteredFiles.length === 0 && !diskSearched ? (
            <p className="px-3 py-3 text-[11px] text-gray-500">{q ? 'No results' : 'No files in library'}</p>
          ) : (
            filteredFiles.map((file) => (
              <LibraryFileRow
                key={file.id}
                file={file}
                picked={pickedFileId === file.id}
                onPick={() => { setPickedFileId(file.id === pickedFileId ? null : file.id); setPickedDiskPath(null) }}
              />
            ))
          )}

          {/* Disk search results */}
          {diskResults.length > 0 && (
            <>
              <p className="px-3 pt-2 pb-1 text-[9px] text-gray-600 uppercase tracking-wider">Found on disk</p>
              {diskResults.map((p) => (
                <DiskFileRow
                  key={p}
                  path={p}
                  picked={pickedDiskPath === p}
                  onPick={() => { setPickedDiskPath(pickedDiskPath === p ? null : p); setPickedFileId(null) }}
                />
              ))}
            </>
          )}
          {diskSearched && diskResults.length === 0 && (
            <p className="px-3 py-2 text-[10px] text-gray-600">No files found on disk</p>
          )}
          {diskSearched && (
            <div className="px-3 py-2">
              <button
                type="button"
                onClick={async () => {
                  const path = await window.electronAPI.pickAudioFile()
                  if (path) { setDiskResults((prev) => [...new Set([...prev, path])]); setPickedDiskPath(path); setPickedFileId(null) }
                }}
                className="w-full py-1 text-[10px] rounded border border-surface-border text-gray-500 hover:text-gray-200 hover:border-gray-500 transition-colors"
              >
                Browse for file…
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Apply footer */}
      <div className="flex flex-col gap-2 p-3 border-t border-surface-border shrink-0">
        {pickedDiskPath && !done && (() => {
          const sep = pickedDiskPath.includes('\\') ? '\\' : '/'
          const folderName = pickedDiskPath.split(sep).slice(-2, -1)[0] ?? ''
          return folderAdded ? (
            <p className="text-[10px] text-accent text-center">Folder added — reindexing…</p>
          ) : (
            <button
              type="button"
              disabled={addingFolder}
              onClick={() => handleAddParentFolder(pickedDiskPath)}
              className="w-full py-1 text-[10px] rounded border border-surface-border text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {addingFolder ? (
                <svg className="w-2.5 h-2.5 animate-spin shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M5 1v1.5M5 7.5V9M1 5h1.5M7.5 5H9" strokeLinecap="round" />
                </svg>
              ) : (
                <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 3.5h8M1 1.5h3.5l1 1H9a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5H1a.5.5 0 0 1-.5-.5v-6a.5.5 0 0 1 .5-.5z" />
                </svg>
              )}
              {addingFolder ? 'Adding…' : `Add "${folderName}" to library`}
            </button>
          )
        })()}
        {applyError && (
          <p className="text-[10px] text-red-400 leading-snug">{applyError}</p>
        )}
        {done ? (
          <p className="text-center text-[11px] text-accent">Matched!</p>
        ) : (
          <button
            type="button"
            disabled={(!pickedFileId && !pickedDiskPath) || applying}
            onClick={handleApply}
            className="w-full py-1.5 text-[11px] font-medium rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {applying ? 'Applying…' : (pickedFileId || pickedDiskPath) ? 'Apply MFB data to this file' : 'Select a file above'}
          </button>
        )}
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${(bytes / 1_000).toFixed(0)} KB`
}

function LibraryFileRow({ file, picked, onPick }: { file: LibraryFile; picked: boolean; onPick: () => void }): JSX.Element {
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  return (
    <button
      type="button"
      onClick={onPick}
      className={`w-full text-left flex flex-col px-3 py-2 border-b border-surface-border/50 transition-colors ${picked ? 'bg-accent/15' : 'hover:bg-surface-hover'}`}
    >
      <div
        className="flex items-center min-w-0"
        onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTooltipPos({ x: r.left, y: r.top }) }}
        onMouseLeave={() => setTooltipPos(null)}
      >
        <span className={`text-[11px] truncate flex-1 min-w-0 ${picked ? 'text-gray-200' : 'text-gray-400'}`}>
          {file.trackTitle || file.fileName}
        </span>
        {tooltipPos && (
          <div
            className="fixed z-[999] bg-black rounded p-2 text-[10px] text-gray-200 shadow-lg pointer-events-none border border-white/10 max-w-xs"
            style={{ left: tooltipPos.x, top: tooltipPos.y - 8, transform: 'translateY(-100%)' }}
          >
            <div className="font-medium break-all">{file.fileName}</div>
            <div className="text-gray-400 mt-0.5 break-all">{file.folderPath}</div>
            <div className="text-gray-500 mt-0.5 uppercase">{file.format} · {(file.sampleRate / 1000).toFixed(0)} kHz · {formatSize(file.fileSize)}</div>
          </div>
        )}
      </div>
      {(file.artist || file.artistPathGuess) && (
        <span className="text-[10px] text-gray-600 truncate">{file.artist || file.artistPathGuess}</span>
      )}
    </button>
  )
}

function DiskFileRow({ path, picked, onPick }: { path: string; picked: boolean; onPick: () => void }): JSX.Element {
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const fileName = path.split(/[\\/]/).pop() ?? path
  return (
    <button
      type="button"
      onClick={onPick}
      className={`w-full text-left flex flex-col px-3 py-2 border-b border-surface-border/50 transition-colors ${picked ? 'bg-accent/15' : 'hover:bg-surface-hover'}`}
    >
      <div
        className="flex items-center min-w-0"
        onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTooltipPos({ x: r.left, y: r.top }) }}
        onMouseLeave={() => setTooltipPos(null)}
      >
        <span className={`text-[11px] truncate flex-1 min-w-0 ${picked ? 'text-gray-200' : 'text-gray-400'}`}>{fileName}</span>
        {tooltipPos && (
          <div
            className="fixed z-[999] bg-black rounded p-2 text-[10px] text-gray-200 shadow-lg pointer-events-none border border-white/10 max-w-xs"
            style={{ left: tooltipPos.x, top: tooltipPos.y - 8, transform: 'translateY(-100%)' }}
          >
            <div className="font-medium break-all">{fileName}</div>
            <div className="text-gray-400 mt-0.5 break-all">{path}</div>
          </div>
        )}
      </div>
      <span className="text-[10px] text-gray-600 truncate">{path}</span>
    </button>
  )
}
