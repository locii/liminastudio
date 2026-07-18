import React, { useEffect, useRef, useState } from 'react'
import { useLibraryStore } from '../store/libraryStore'
import type { LibraryFile, MfbPlaylistDetail, MfbPlaylistTrack } from '../types'
import { appleMusicDeepLink } from '../types'
import { useUIStore } from '../../uiStore'
import { openInMix } from '../../openInMix'
import { requestOpen } from '../../openGuard'
import { requestNavigate } from '../../navigate'
import { buildTwoTrackMix, type MixItem, type SegmentSpan } from '../../buildLiminaMix'

function formatDuration(seconds: number): string {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// Map an MFB playlist detail onto the shared two-track Mix builder: matched files
// in playlist order (segments preserved as named markers), with the playlist's
// authoritative title/artist/artwork carried through.
async function buildLiminaSession(detail: MfbPlaylistDetail, files: LibraryFile[]): Promise<object> {
  const fileByMfbId = new Map(
    files.filter((f) => f.mfbTrackId !== null).map((f) => [f.mfbTrackId!, f])
  )
  const items: MixItem[] = []
  const spans: SegmentSpan[] = []
  for (const segment of detail.segments) {
    let count = 0
    for (const track of segment.tracks) {
      const file = fileByMfbId.get(track.id)
      if (!file) continue
      items.push({
        file,
        mfbTrackId: track.id,
        title: track.title,
        artist: track.artist,
        albumImageUrl: track.album_image_url || file.albumImageUrl || null,
      })
      count++
    }
    spans.push({ name: segment.name, count })
  }
  return buildTwoTrackMix(items, spans)
}

function flatTracks(detail: MfbPlaylistDetail): MfbPlaylistTrack[] {
  return detail.segments.flatMap((s) => s.tracks)
}

export function PlaylistPanel(): JSX.Element {
  const playlists = useLibraryStore((s) => s.playlists)
  const selectedPlaylistId = useLibraryStore((s) => s.selectedPlaylistId)
  const allFiles = useLibraryStore((s) => s.files)
  const watchedFolders = useLibraryStore((s) => s.watchedFolders)
  const selectFile = useLibraryStore((s) => s.selectFile)
  const showFileInLibrary = useLibraryStore((s) => s.showFileInLibrary)
  const selectMissingTrack = useLibraryStore((s) => s.selectMissingTrack)
  const selectedFileId = useLibraryStore((s) => s.selectedFileId)
  const selectedMissingTrackId = useLibraryStore((s) => s.selectedMissingTrackId)
  const playlistSessions = useLibraryStore((s) => s.playlistSessions)
  const setPlaylistSession = useLibraryStore((s) => s.setPlaylistSession)
  const previewFileId = useLibraryStore((s) => s.previewFileId)
  const setPreview = useLibraryStore((s) => s.setPreview)

  const setPlaylistDetail = useLibraryStore((s) => s.setPlaylistDetail)
  const patchPlaylist = useLibraryStore((s) => s.patchPlaylist)
  const detail = useLibraryStore((s) => s.selectedPlaylistDetail)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [saving, setSaving] = useState(false)
  const [opening, setOpening] = useState(false)
  const openCancelledRef = useRef(false)
  const addQueueTrack = useLibraryStore((s) => s.addQueueTrack)
  const clearQueue = useLibraryStore((s) => s.clearQueue)
  const enterMixMode = useLibraryStore((s) => s.enterMixMode)
  const setSurface = useUIStore((s) => s.setSurface)
  const [contextMenu, setContextMenu] = useState<{ filePath: string; fileId: string; x: number; y: number } | null>(null)
  const [ellipsisOpen, setEllipsisOpen] = useState(false)
  const [ellipsisBusy, setEllipsisBusy] = useState(false)
  const ellipsisRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!contextMenu) return
    function close(): void { setContextMenu(null) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [contextMenu])

  useEffect(() => {
    if (!ellipsisOpen) return
    function closeMenu(e: MouseEvent): void {
      if (ellipsisRef.current && !ellipsisRef.current.contains(e.target as Node)) setEllipsisOpen(false)
    }
    window.addEventListener('mousedown', closeMenu)
    return () => window.removeEventListener('mousedown', closeMenu)
  }, [ellipsisOpen])

  const playlist = selectedPlaylistId !== null
    ? playlists.find((p) => p.id === selectedPlaylistId) ?? null
    : null

  useEffect(() => {
    if (selectedPlaylistId === null) { setPlaylistDetail(null); return }
    setPlaylistDetail(null)
    setLoadingDetail(true)
    window.electronAPI.getPlaylist(selectedPlaylistId)
      .then((d) => {
        setPlaylistDetail(d)
        const firstImage = d?.segments.flatMap((s) => s.tracks).find((t) => t.album_image_url)?.album_image_url
        if (firstImage) patchPlaylist(selectedPlaylistId, { image_url: firstImage })
      })
      .finally(() => setLoadingDetail(false))
  }, [selectedPlaylistId])

  if (!playlist) return <></>

  if (loadingDetail) {
    return (
      <div className="flex flex-1 items-center justify-center text-[11px] text-gray-600">
        Loading…
      </div>
    )
  }

  if (!detail) return <></>

  const allTracks = flatTracks(detail)
  const fileByMfbId = new Map(
    allFiles.filter((f) => f.mfbTrackId !== null).map((f) => [f.mfbTrackId!, f])
  )

  const matchedCount = allTracks.filter((t) => fileByMfbId.has(t.id)).length
  const missingCount = allTracks.length - matchedCount
  const totalDuration = allTracks.reduce((sum, t) => sum + (fileByMfbId.get(t.id)?.duration ?? 0), 0)

  const matchedQueue = allTracks
    .map((t) => fileByMfbId.get(t.id)?.id)
    .filter((id): id is string => id !== undefined)

  function togglePreview(fileId: string, e: React.MouseEvent): void {
    e.stopPropagation()
    if (previewFileId === fileId) {
      setPreview(null, [])
    } else {
      setPreview(fileId, matchedQueue)
    }
  }

  const savedPath = selectedPlaylistId !== null ? (playlistSessions[selectedPlaylistId] ?? null) : null

  async function handleCreateSession(): Promise<void> {
    setSaving(true)
    try {
      const session = await buildLiminaSession(detail!, allFiles)
      const path = await window.electronAPI.studioSaveSession(
        JSON.stringify(session, null, 2),
        detail!.title,
      )
      if (path) setPlaylistSession(detail!.id, path)
    } finally {
      setSaving(false)
    }
  }

  // Open the playlist as an editable timeline in the Mix workspace (in-app).
  async function handleOpenInMix(): Promise<void> {
    openCancelledRef.current = false
    setOpening(true)
    try {
      const session = await buildLiminaSession(detail!, allFiles)
      if (!openCancelledRef.current) {
        requestOpen('mix', () => openInMix(JSON.stringify(session)))
      }
    } finally {
      setOpening(false)
    }
  }

  function cancelOpenInMix(): void {
    openCancelledRef.current = true
    setOpening(false)
  }

  // Open the playlist's matched tracks as an Auto-Mix queue in Session mode.
  function handleOpenInSession(): void {
    requestNavigate(() => {
      requestOpen('session', () => {
        clearQueue()
        for (const fileId of matchedQueue) addQueueTrack(fileId)
        enterMixMode()
        setSurface('library')
      })
    }, 'session')
  }

  function buildPlaylistHTML(): string {
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    let counter = 0
    const groupBlocks = detail!.segments.map((segment) => {
      const segHeader = `<tr class="seg-header"><td colspan="4"><span class="seg-name">${segment.name}</span></td></tr>`
      const rows = segment.tracks.map((track) => {
        counter++
        const file = fileByMfbId.get(track.id) ?? null
        const title = file?.trackTitle || track.title
        const artist = file?.artist || track.artist
        const dur = file ? formatDuration(file.duration) : (track.duration ? formatDuration(track.duration / 1000) : '—')
        return `<tr><td class="num">${counter}</td><td class="name">${title}</td><td class="artist">${artist}</td><td class="dur">${dur}</td></tr>`
      }).join('')
      return segHeader + rows
    }).join('')
    const total = allTracks.length
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box;margin:0;padding:0}body{font-family:'Helvetica Neue',Arial,sans-serif;color:#111;padding:48px 56px;font-size:13px}
      h1{font-size:26px;font-weight:700;letter-spacing:-0.02em;margin-bottom:4px}.session-date{color:#999;font-size:12px;margin-bottom:32px}
      table{width:100%;border-collapse:collapse;margin-bottom:32px}thead th{text-align:left;border-bottom:2px solid #222;padding:6px 10px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#444}
      tbody td{padding:9px 10px;border-bottom:1px solid #e8e8e8;vertical-align:top}tbody tr:last-child td{border-bottom:none}
      tr.seg-header td{padding:14px 10px 6px;border-bottom:1px solid #ccc}.seg-name{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#222}
      .num{color:#aaa;width:32px}.name{font-weight:500}.artist{color:#555;width:160px}.dur{font-family:'Courier New',monospace;color:#888;width:64px}
      .footer{font-size:10px;color:#bbb;border-top:1px solid #e8e8e8;padding-top:12px}
    </style></head><body>
      <h1>${detail!.title}</h1><div class="session-date">${date}</div>
      <table><thead><tr><th>#</th><th>Title</th><th>Artist</th><th>Duration</th></tr></thead><tbody>${groupBlocks}</tbody></table>
      <div class="totals" style="font-size:12px;color:#666;border-top:1px solid #ccc;padding-top:16px;margin-bottom:24px">${total} track${total !== 1 ? 's' : ''}</div>
      <div class="footer">Generated by Limina Studio</div>
    </body></html>`
  }

  async function handleExportPDF(): Promise<void> {
    setEllipsisOpen(false)
    setEllipsisBusy(true)
    try {
      const html = buildPlaylistHTML()
      await window.electronAPI.exportTracklistPDF(html)
    } finally {
      setEllipsisBusy(false)
    }
  }

  // Ensure a .limina file exists for this playlist (auto-save if needed).
  // Returns the file path on success, null if the user cancelled the save dialog.
  async function ensureSaved(sessionJson: string): Promise<string | null> {
    if (savedPath) return savedPath
    const path = await window.electronAPI.studioSaveSession(sessionJson, detail!.title)
    if (path) setPlaylistSession(detail!.id, path)
    return path
  }

  async function handleCollect(): Promise<void> {
    setEllipsisOpen(false)
    setEllipsisBusy(true)
    try {
      const session = await buildLiminaSession(detail!, allFiles)
      const json = JSON.stringify(session, null, 2)
      const path = await ensureSaved(json)
      if (!path) return
      await window.electronAPI.collectProject(json, path)
    } finally {
      setEllipsisBusy(false)
    }
  }

  async function handleExportZip(): Promise<void> {
    setEllipsisOpen(false)
    setEllipsisBusy(true)
    try {
      const session = await buildLiminaSession(detail!, allFiles)
      const json = JSON.stringify(session, null, 2)
      const path = await ensureSaved(json)
      if (!path) return
      await window.electronAPI.exportProjectZip(json, path)
    } finally {
      setEllipsisBusy(false)
    }
  }

  let trackIndex = 0

  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0 border-surface-border bg-surface-panel">
        {/* Album art */}
        {(() => {
          const imgUrl = allTracks[0]?.album_image_url
          const isPlayingPlaylist = previewFileId !== null && matchedQueue.includes(previewFileId)
          return (
            <div className="relative w-10 h-10 overflow-hidden rounded shrink-0 bg-surface-hover">
              {imgUrl ? (
                <img src={imgUrl} alt="" className="object-cover w-full h-full" />
              ) : (
                <div className="flex items-center justify-center w-full h-full">
                  <svg className="w-5 h-5 text-gray-700" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 3h8M1 6h6M1 9h4" />
                  </svg>
                </div>
              )}
              {matchedQueue.length > 0 && (
                <button
                  type="button"
                  title={isPlayingPlaylist ? 'Stop' : 'Play playlist'}
                  onClick={() => isPlayingPlaylist ? setPreview(null, []) : setPreview(matchedQueue[0], matchedQueue)}
                  className={`absolute inset-0 flex items-center justify-center transition-colors ${isPlayingPlaylist ? 'bg-black/60 text-accent' : 'text-white opacity-0 bg-black/0 hover:bg-black/50 hover:opacity-100'}`}
                >
                  {isPlayingPlaylist ? (
                    <svg className="w-4 h-4" viewBox="0 0 10 10" fill="currentColor">
                      <rect x="1.5" y="1" width="2.5" height="8" rx="0.5" />
                      <rect x="6" y="1" width="2.5" height="8" rx="0.5" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 10 10" fill="currentColor">
                      <path d="M2 1.5l7 3.5-7 3.5V1.5z" />
                    </svg>
                  )}
                </button>
              )}
            </div>
            
          )
        })()}
        {/* Title + stats + actions */}
        <div className="flex flex-col flex-1 min-w-0 gap-1">
        <div className="flex items-center gap-2">
          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex gap-4">
              <h2 className="text-[12px] font-semibold text-gray-200 truncate min-w-0">{detail.title}</h2>
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); window.open(`https://musicforbreathwork.com/dashboard/playlists/edit/${detail.id}`) }}
                title="Edit on Music for Breathwork"
                className="shrink-0 flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-300 transition-colors"
              >
                Edit on m4b.com
                <svg className="w-2.5 h-2.5 opacity-60" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 2H2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V6" />
                  <path d="M6.5 1h2.5v2.5M9 1L5.5 4.5" />
                </svg>
              </a>
            </div>
            <div className="flex items-center gap-3">
            <span className="text-[10px] text-gray-500 tabular-nums">
              {matchedCount}/{allTracks.length} tracks
            </span>
            {totalDuration > 0 && (
              <span className="text-[10px] text-gray-600 tabular-nums">{formatDuration(totalDuration)}</span>
            )}
            {missingCount > 0 && (
              <span className="text-[10px] text-gray-600 tabular-nums">{missingCount} tracks missing</span>
            )}
          </div>
            
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {opening ? (
              <span className="flex items-center gap-1.5">
                <span className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] rounded border border-accent/30 text-accent/60">
                  <svg className="w-2.5 h-2.5 animate-spin shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M6 1v2M6 9v2M1 6h2M9 6h2" />
                  </svg>
                  Opening…
                </span>
                <button type="button" onClick={cancelOpenInMix}
                  className="px-2 py-0.5 text-[10px] rounded border border-surface-border text-gray-400 hover:text-gray-200 hover:bg-surface-hover transition-colors">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                disabled={matchedCount === 0}
                onClick={handleOpenInMix}
                title="Open this playlist as an editable timeline in Mix"
                className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] rounded border border-accent/50 text-accent hover:bg-accent/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                Open in Mix
              </button>
            )}
            <button
              type="button"
              disabled={matchedCount === 0}
              onClick={handleOpenInSession}
              title="Load these tracks into Session mode's Auto-Mix queue"
              className="px-2 py-0.5 text-[10px] rounded border border-surface-border text-gray-200 hover:text-gray-200 hover:bg-surface-border transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              Open in Session
            </button>
            {/* Ellipsis dropdown: Save + export actions */}
            <div className="relative" ref={ellipsisRef}>
              <button
                type="button"
                disabled={matchedCount === 0 || ellipsisBusy}
                onClick={() => setEllipsisOpen((v) => !v)}
                title="More actions"
                className="flex items-center justify-center w-6 h-6 text-[12px] rounded border border-surface-border text-gray-400 hover:text-gray-200 hover:bg-surface-border transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                {ellipsisBusy ? (
                  <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 1v2M6 9v2M1 6h2M9 6h2" /></svg>
                ) : '⋯'}
              </button>
              {ellipsisOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 py-1 w-52 rounded border border-surface-border bg-surface-panel shadow-xl text-[11px]">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => { setEllipsisOpen(false); handleCreateSession() }}
                    className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface-hover transition-colors disabled:opacity-40"
                  >
                    {saving ? 'Saving…' : savedPath ? 'Save new .limina…' : 'Save .limina…'}
                  </button>
                  <div className="h-px my-1 bg-surface-border" />
                  <button
                    type="button"
                    onClick={handleExportPDF}
                    className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface-hover transition-colors"
                  >
                    Export track listing PDF…
                  </button>
                  <div className="h-px my-1 bg-surface-border" />
                  <button
                    type="button"
                    onClick={handleCollect}
                    className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface-hover transition-colors"
                  >
                    Collect project files
                  </button>
                  <button
                    type="button"
                    onClick={handleExportZip}
                    className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface-hover transition-colors"
                  >
                    Export project as ZIP…
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
          
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-2 px-3 h-7 border-b shrink-0 border-surface-border bg-surface-panel text-[10px] uppercase tracking-wider text-gray-300 select-none">
        <span className="w-5 text-center shrink-0">#</span>
        <span className="w-7 shrink-0" />
        <span className="flex-1 min-w-0">Title</span>
        <span className="hidden w-28 shrink-0 sm:block">Artist</span>
        <span className="w-10 text-right shrink-0">Dur</span>
      </div>

      {/* Track list with segments */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {detail.segments.map((segment) => (
          <div key={segment.id}>
            {/* Segment header */}
            <div className="flex items-center h-6 gap-2 px-3 border-b select-none bg-surface-panel/60 border-surface-border/50">
              <span className="text-[9px] uppercase tracking-widest text-gray-600 truncate">{segment.name}</span>
            </div>

            {segment.tracks.map((track) => {
              const i = trackIndex++
              const file = fileByMfbId.get(track.id) ?? null
              const isPlaying = file !== null && previewFileId === file.id
              const isSelected = file
                ? selectedFileId === file.id
                : selectedMissingTrackId === track.id

              function handleRowClick(): void {
                if (file) selectFile(file.id)
                else selectMissingTrack(isSelected ? null : track.id)
              }

              return (
                <div
                  key={track.id}
                  draggable={!!file}
                  onDragStart={file ? (e) => { e.preventDefault(); window.electronAPI.startDrag(file.filePath) } : undefined}
                  onContextMenu={file ? (e) => { e.preventDefault(); setContextMenu({ filePath: file.filePath, fileId: file.id, x: e.clientX, y: e.clientY }) } : undefined}
                  onClick={handleRowClick}
                  className={`group flex items-center gap-2 px-3 border-b border-surface-border/50 transition-colors cursor-pointer select-none ${
                    isSelected
                      ? 'bg-accent/15'
                      : file
                      ? 'hover:bg-surface-hover'
                      : 'opacity-70 hover:opacity-75 hover:bg-surface-hover'
                  }`}
                  style={{ height: 36 }}
                >
                  <span className="w-5 shrink-0 text-center text-[10px] text-gray-600 tabular-nums">{i + 1}</span>

                  {/* Album thumbnail with play overlay */}
                  <div className="relative w-5 h-5 overflow-hidden rounded shrink-0 bg-surface-hover">
                    {track.album_image_url ? (
                      <img src={track.album_image_url} alt="" className={`object-cover w-full h-full transition-opacity ${isPlaying ? 'opacity-60' : 'opacity-100 group-hover:opacity-60'}`} />
                    ) : (
                      <div className="w-full h-full" />
                    )}
                    {file && (
                      <button
                        type="button"
                        onClick={(e) => togglePreview(file.id, e)}
                        className={`absolute inset-0 flex items-center justify-center transition-all ${
                          track.album_image_url
                            ? isPlaying
                              ? 'text-white opacity-100'
                              : 'text-white opacity-0 group-hover:opacity-100'
                            : isPlaying
                              ? 'rounded-full border border-accent text-accent opacity-100'
                              : 'rounded-full border border-gray-600 text-gray-600 hover:border-accent hover:text-accent opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        {isPlaying ? (
                          <svg className="w-2.5 h-2.5" viewBox="0 0 8 8" fill="currentColor">
                            <rect x="0.5" y="0" width="2.5" height="8" rx="0.5" />
                            <rect x="5" y="0" width="2.5" height="8" rx="0.5" />
                          </svg>
                        ) : (
                          <svg className="w-2.5 h-2.5" viewBox="0 0 8 8" fill="currentColor">
                            <path d="M1.5 1l5.5 3-5.5 3V1z" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
                    <span className={`text-[11px] truncate shrink min-w-0 ${isSelected ? 'text-gray-100' : file ? 'text-gray-300' : 'text-gray-500'}`}>
                      {file?.trackTitle || track.title}
                    </span>
                    {!file && track.bandcamp_url && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); window.open(track.bandcamp_url!) }}
                        className="shrink-0 px-1.5 py-px text-[9px] font-medium rounded border transition-colors text-[#1da0c3] border-[#1da0c3]/40 bg-[#1da0c3]/10 hover:bg-[#1da0c3]/20 leading-tight"
                      >
                        Buy at Bandcamp
                      </button>
                    )}
                    {!file && track.beatport_url && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); window.open(track.beatport_url!) }}
                        className="shrink-0 px-1.5 py-px text-[9px] font-medium rounded border transition-colors text-[#97f04f] border-[#97f04f]/40 bg-[#97f04f]/10 hover:bg-[#97f04f]/20 leading-tight"
                      >
                        Buy at Beatport
                      </button>
                    )}
                    {!file && track.apple_music_url && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); window.open(appleMusicDeepLink(track.apple_music_url!)) }}
                        className="shrink-0 px-1.5 py-px text-[9px] font-medium rounded border transition-colors text-[#fc3c44] border-[#fc3c44]/40 bg-[#fc3c44]/10 hover:bg-[#fc3c44]/20 leading-tight"
                      >
                        Buy on Apple Music
                      </button>
                    )}
                  </div>

                  <span className={`w-28 shrink-0 text-[10px] truncate hidden sm:block ${isSelected ? 'text-gray-400' : 'text-gray-600'}`}>
                    {file?.artist || track.artist}
                  </span>

                  <span className="w-10 shrink-0 text-right text-[10px] text-gray-600 tabular-nums">
                    {file ? formatDuration(file.duration) : track.duration ? formatDuration(track.duration / 1000) : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {missingCount > 0 && (
        <div className="px-3 py-2 border-t shrink-0 border-surface-border bg-surface-panel">
          <p className="text-[10px] text-gray-600">
            {missingCount} track{missingCount === 1 ? '' : 's'} not in library will be skipped.
          </p>
        </div>
      )}

      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded border border-surface-border bg-surface-panel shadow-lg py-1 text-[11px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface-hover transition-colors"
            onClick={() => { window.electronAPI.copyFile(contextMenu.filePath); setContextMenu(null) }}
          >
            Copy
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface-hover transition-colors"
            onClick={() => { window.electronAPI.showInFolder(contextMenu.filePath); setContextMenu(null) }}
          >
            Show in Finder
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface-hover transition-colors"
            onClick={() => {
              const folder = watchedFolders.find((wf) => contextMenu.filePath.startsWith(wf.path))
              showFileInLibrary(folder?.id ?? null, contextMenu.fileId)
              setContextMenu(null)
            }}
          >
            Show in Library
          </button>
        </div>
      )}
    </div>
  )
}
