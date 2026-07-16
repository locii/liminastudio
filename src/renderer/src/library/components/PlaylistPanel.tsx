import React, { useEffect, useState } from 'react'
import { useLibraryStore } from '../store/libraryStore'
import type { LibraryFile, MfbPlaylistDetail, MfbPlaylistTrack } from '../types'
import { appleMusicDeepLink } from '../types'

const SEGMENT_COLORS = [
  '#6366f1', '#3b82f6', '#14b8a6', '#22c55e',
  '#f59e0b', '#ef4444', '#a855f7', '#ec4899',
]

function formatDuration(seconds: number): string {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

const ANALYSIS_WINDOW_S = 0.5
const FADE_OUT_THRESHOLD = 0.025   // ~-32 dBFS: below = silence tail
const CONTENT_THRESHOLD_RATIO = 0.25  // main content starts when RMS exceeds 25% of track peak
const MAX_FADEOUT_S = 20
const MAX_FADEIN_S = 30
const MIN_FADE_S = 0.5
const ANALYZE_TIMEOUT_MS = 15_000
const NON_CUE_FADEIN_BUFFER_S = 3  // extra fade-in time beyond detected content start for tracks without manual cue points

function windowRMS(data: Float32Array, startSample: number, windowSamples: number): number {
  let sum = 0
  const end = Math.min(startSample + windowSamples, data.length)
  for (let i = startSample; i < end; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / (end - startSample))
}

async function analyzeTransitions(filePath: string, sampleRate: number, port: number): Promise<{ fadeIn: number; fadeOut: number }> {
  const defaults = { fadeIn: 3, fadeOut: 8 }
  const work = async (): Promise<{ fadeIn: number; fadeOut: number }> => {
    const res = await fetch(`http://127.0.0.1:${port}${encodeURI(filePath)}?sr=${sampleRate}`)
    const arrayBuffer = await res.arrayBuffer()
    const ctx = new AudioContext()
    const audio = await ctx.decodeAudioData(arrayBuffer)
    ctx.close()

    const sr = audio.sampleRate
    const winSamples = Math.floor(ANALYSIS_WINDOW_S * sr)

    // Mix to mono
    const mono = new Float32Array(audio.length)
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
      const chData = audio.getChannelData(ch)
      for (let i = 0; i < audio.length; i++) mono[i] += chData[i] / audio.numberOfChannels
    }

    // Find peak RMS of the track body (skip first/last 5% to avoid artifacts)
    const bodyStart = Math.floor(mono.length * 0.05)
    const bodyEnd = Math.floor(mono.length * 0.95)
    let peakRms = 0
    for (let i = bodyStart; i < bodyEnd; i += winSamples) {
      const rms = windowRMS(mono, i, winSamples)
      if (rms > peakRms) peakRms = rms
    }
    // Main content threshold: relative to the track's own peak level
    const contentThreshold = Math.max(peakRms * CONTENT_THRESHOLD_RATIO, FADE_OUT_THRESHOLD)

    // Scan from end backwards — find last window with signal above silence threshold
    let fadeOut = MAX_FADEOUT_S
    const outScanStart = Math.max(0, mono.length - Math.floor(MAX_FADEOUT_S * sr))
    for (let i = mono.length - winSamples; i >= outScanStart; i -= winSamples) {
      if (windowRMS(mono, i, winSamples) > FADE_OUT_THRESHOLD) {
        fadeOut = (mono.length - i) / sr
        break
      }
    }

    // Find main content start — first window that clears the relative threshold
    let fadeIn: number
    const inScanEnd = Math.min(mono.length, Math.floor(MAX_FADEIN_S * sr))
    if (windowRMS(mono, 0, winSamples) >= contentThreshold) {
      fadeIn = MIN_FADE_S  // track opens at full content immediately
    } else {
      fadeIn = MAX_FADEIN_S
      for (let i = winSamples; i < inScanEnd; i += winSamples) {
        if (windowRMS(mono, i, winSamples) >= contentThreshold) {
          fadeIn = i / sr
          break
        }
      }
    }

    const name = filePath.split('/').pop() ?? filePath
    // Log first 30s of RMS values to diagnose detection
    const diagWindows = Math.floor(30 / ANALYSIS_WINDOW_S)
    const diagRms = Array.from({ length: diagWindows }, (_, i) =>
      +windowRMS(mono, i * winSamples, winSamples).toFixed(4)
    )
    console.log('[analyzeTransitions]', name, {
      sampleRate: sr,
      durationS: +(mono.length / sr).toFixed(1),
      peakRms: +peakRms.toFixed(4),
      contentThreshold: +contentThreshold.toFixed(4),
      fadeIn: +fadeIn.toFixed(2),
      fadeOut: +fadeOut.toFixed(2),
      rmsFirst30s: diagRms,
    })

    return { fadeIn, fadeOut }
  }

  const timeout = new Promise<{ fadeIn: number; fadeOut: number }>((resolve) =>
    setTimeout(() => resolve(defaults), ANALYZE_TIMEOUT_MS)
  )
  return Promise.race([work().catch(() => defaults), timeout])
}

async function buildLiminaSession(detail: MfbPlaylistDetail, files: LibraryFile[]): Promise<object> {
  const fileByMfbId = new Map(
    files.filter((f) => f.mfbTrackId !== null).map((f) => [f.mfbTrackId!, f])
  )

  // Collect matched files in playlist order and analyze all in parallel
  const orderedFiles = detail.segments
    .flatMap((s) => s.tracks)
    .map((t) => fileByMfbId.get(t.id))
    .filter((f): f is LibraryFile => f !== undefined)

  const port = await window.electronAPI.getAudioServerPort()

  // Get true durations via ffmpeg for all files — bypasses wrong WAV RIFF header sizes.
  // Run in parallel with waveform analyses.
  const [trueDurations, analyses] = await Promise.all([
    Promise.all(orderedFiles.map((f) =>
      window.electronAPI.getFileDuration(f.filePath).then((d) => d > 0 ? d : f.duration)
    )),
    Promise.all(
      orderedFiles.map((f) => {
        if (f.introEndMs != null && f.outroStartMs != null) {
          const clipStartMs = f.clipStartMs ?? 0
          const clipEndMs = f.clipEndMs ?? Math.round(f.duration * 1000)
          return Promise.resolve({
            fadeIn: (f.introEndMs - clipStartMs) / 1000,
            fadeOut: (clipEndMs - f.outroStartMs) / 1000,
          })
        }
        return analyzeTransitions(f.filePath, f.sampleRate, port)
      })
    ),
  ])

  const trackAId = crypto.randomUUID()
  const trackBId = crypto.randomUUID()

  const tracks = [
    { id: trackAId, name: 'Track A', color: '#75f264', volume: 1, muted: false, solo: false, order: 0 },
    { id: trackBId, name: 'Track B', color: '#4946ec', volume: 1, muted: false, solo: false, order: 1 },
  ]

  let clipIndex = 0
  let cursor = 0

  const clips: object[] = []
  const segments: object[] = []

  detail.segments.forEach((segment, segIdx) => {
    const segStart = cursor
    let segLastClipEnd = segStart

    for (const track of segment.tracks) {
      const file = fileByMfbId.get(track.id)
      if (!file) continue
      const analysis = analyses[clipIndex] ?? { fadeIn: 3, fadeOut: 8 }
      // ffmpeg-measured duration is authoritative — catalogue duration can be wrong for some WAV formats
      const trueDuration = trueDurations[clipIndex] ?? file.duration

      // Clip trim bounds clamped to true audio duration
      const clipStartMs = file.clipStartMs ?? 0
      const clipEndMs = file.clipEndMs ?? Math.round(trueDuration * 1000)
      const clipStartS = Math.min(clipStartMs / 1000, trueDuration)
      const clipEndS = Math.min(clipEndMs / 1000, trueDuration)
      const effectiveDuration = Math.max(0.1, clipEndS - clipStartS)

      // Manual cues take priority over waveform analysis (relative to clip bounds)
      const rawFadeIn = file.introEndMs != null
        ? Math.max(0, (file.introEndMs - clipStartMs) / 1000)
        : analysis.fadeIn + NON_CUE_FADEIN_BUFFER_S
      const rawFadeOut = file.outroStartMs != null
        ? Math.max(0, (clipEndMs - file.outroStartMs) / 1000)
        : analysis.fadeOut

      const fadeOut = Math.min(rawFadeOut, effectiveDuration * 0.5)
      const fadeIn = Math.min(rawFadeIn, effectiveDuration * 0.5)

      const nextFile = orderedFiles[clipIndex + 1] ?? null
      const nextAnalysis = nextFile ? (analyses[clipIndex + 1] ?? null) : null
      const nextTrueDuration = (trueDurations[clipIndex + 1] ?? nextFile?.duration) ?? 0
      const nextClipStartMs = nextFile?.clipStartMs ?? 0
      const nextClipEndMs = nextFile
        ? Math.min(nextFile.clipEndMs ?? Math.round(nextTrueDuration * 1000), Math.round(nextTrueDuration * 1000))
        : 0
      const nextRawFadeIn = nextFile?.introEndMs != null
        ? Math.max(0, (nextFile.introEndMs - nextClipStartMs) / 1000)
        : (nextAnalysis?.fadeIn ?? 0) + NON_CUE_FADEIN_BUFFER_S
      const nextEffectiveDuration = nextFile
        ? Math.max(0.1, (nextClipEndMs - nextClipStartMs) / 1000)
        : 0
      // Cap nextFadeIn against both the next clip's duration and this clip's remaining playable time
      const nextFadeIn = nextFile
        ? Math.min(nextRawFadeIn, nextEffectiveDuration * 0.5, effectiveDuration * 0.5)
        : 0

      const fadeInCurveVal = file.fadeInCurve
      const fadeOutCurveVal = file.fadeOutCurve

      const startTime = cursor
      segLastClipEnd = startTime + effectiveDuration
      clips.push({
        id: crypto.randomUUID(),
        trackId: clipIndex % 2 === 0 ? trackAId : trackBId,
        filePath: file.filePath,
        fileName: file.fileName.replace(/\.[^.]+$/, ''),
        startTime,
        duration: trueDuration,
        trimStart: clipStartS,
        trimEnd: trueDuration - clipEndS,
        fadeIn,
        fadeOut,
        fadeInCurve: fadeInCurveVal,
        fadeOutCurve: fadeOutCurveVal,
        crossfadeIn: 0,
        crossfadeOut: 0,
        volume: 1,
        automation: [],
        // MFB metadata — used by Limina Mix for the Now Playing overlay and clip properties
        mfbTrackId: track.id,
        mfbTrackTitle: track.title,
        mfbArtist: track.artist,
        mfbAlbumImageUrl: track.album_image_url || file.albumImageUrl || null,
        mfbTags: file.tags.length > 0 ? file.tags : [],
        mfbBreathworkPhase: file.breathworkPhase ?? null,
      })

      // With cue points: next clip's fade-in ends exactly when this clip ends.
      // Without cue points: next clip's fade-in ends exactly when this clip begins to fade out.
      const hasCuePoints = file.introEndMs != null || file.outroStartMs != null
      cursor = hasCuePoints
        ? startTime + effectiveDuration - nextFadeIn
        : startTime + effectiveDuration - fadeOut - nextFadeIn
      clipIndex++
    }

    if (segLastClipEnd > segStart) {
      segments.push({
        id: crypto.randomUUID(),
        name: segment.name,
        startTime: segStart,
        endTime: segLastClipEnd,
        color: SEGMENT_COLORS[segIdx % SEGMENT_COLORS.length],
      })
    }
  })

  return { tracks, clips, segments, sessionLabel: '', trackHeights: {}, laneHeights: {} }
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
  const [contextMenu, setContextMenu] = useState<{ filePath: string; fileId: string; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!contextMenu) return
    function close(): void { setContextMenu(null) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [contextMenu])

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

  let trackIndex = 0

  return (
    <div className="flex overflow-hidden flex-col flex-1 min-w-0">
      {/* Header */}
      <div className="flex gap-3 items-center px-4 py-3 border-b shrink-0 border-surface-border bg-surface-panel">
        {/* Album art */}
        {(() => {
          const imgUrl = allTracks[0]?.album_image_url
          const isPlayingPlaylist = previewFileId !== null && matchedQueue.includes(previewFileId)
          return (
            <div className="overflow-hidden relative w-10 h-10 rounded shrink-0 bg-surface-hover">
              {imgUrl ? (
                <img src={imgUrl} alt="" className="object-cover w-full h-full" />
              ) : (
                <div className="flex justify-center items-center w-full h-full">
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
        <div className="flex flex-col flex-1 gap-1 min-w-0">
        <div className="flex gap-2 items-center">
          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex gap-4">
              <h2 className="text-[12px] font-semibold text-gray-200 truncate min-w-0">{detail.title}</h2>
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); window.open(`https://musicforbreathwork.com/dashboard/playlists/edit/${detail.id}`) }}
                title="Edit on Music for Breathwork"
                className="shrink-0 text-[10px] text-gray-600 hover:text-gray-300 transition-colors"
              >
                Edit
              </a>
            </div>
            <div className="flex gap-3 items-center">
            <span className="text-[10px] text-gray-500 tabular-nums">
              {matchedCount}/{allTracks.length} tracks
            </span>
            {totalDuration > 0 && (
              <span className="text-[10px] text-gray-600 tabular-nums">{formatDuration(totalDuration)}</span>
            )}
            {missingCount > 0 && (
              <span className="text-[10px] text-gray-600 tabular-nums">{missingCount} missing</span>
            )}
          </div>
            
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={matchedCount === 0 || saving}
              onClick={handleCreateSession}
              className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] rounded border border-surface-border text-gray-200 hover:text-gray-200 hover:bg-surface-border transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              {saving && (
                <svg className="w-2.5 h-2.5 animate-spin shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M6 1v2M6 9v2M1 6h2M9 6h2" />
                </svg>
              )}
              {saving ? 'Creating…' : savedPath ? 'Create New Version for Limina Mix' : 'Export playlist to Limina Mix'}
            </button>
            {savedPath && (
              <button
                type="button"
                onClick={() => window.electronAPI.studioOpenFile(savedPath)}
                className="px-2 py-0.5 text-[10px] rounded border border-surface-border text-gray-200 hover:text-gray-200 hover:bg-surface-border transition-colors"
              >
                Open in Limina Mix
              </button>
            )}
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
      <div className="overflow-y-auto flex-1 min-h-0">
        {detail.segments.map((segment) => (
          <div key={segment.id}>
            {/* Segment header */}
            <div className="flex gap-2 items-center px-3 h-6 border-b select-none bg-surface-panel/60 border-surface-border/50">
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
                  <div className="overflow-hidden relative w-5 h-5 rounded shrink-0 bg-surface-hover">
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
