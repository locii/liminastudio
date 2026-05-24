import { useCallback, useEffect, useState } from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { useToastStore } from '../../store/toastStore'
import { ClipBlock } from './ClipBlock'
import { AutomationLane } from './AutomationLane'
import { useDragContext } from './DragContext'
import type { Clip, Track } from '../../types'

const TARGET_PEAK_LINEAR = Math.pow(10, -0.5 / 20)

function peaksForClip(duration: number, zoom: number): number {
  return Math.min(Math.ceil(duration * zoom), 50_000)
}

interface Props {
  track: Track
  tracks: Track[]
  clips: Clip[]
  zoom: number
  height: number
  onHeightChange: (h: number) => void
  laneHeight: number
  onLaneHeightChange: (h: number) => void
}

export function TimelineTrack({ track, tracks, clips, zoom, height, onHeightChange, laneHeight, onLaneHeightChange }: Props): JSX.Element {
  const addClipToTrack = useSessionStore((s) => s.addClipToTrack)
  const updateClip = useSessionStore((s) => s.updateClip)
  const setWaveform = useSessionStore((s) => s.setWaveform)
  const selectClip = useSessionStore((s) => s.selectClip)
  const toast = useToastStore((s) => s.add)
  const { getDragState, subscribe } = useDragContext()

  // Re-render when drag state changes so placeholder appears/disappears
  const [, forceUpdate] = useState(0)
  useEffect(() => subscribe(() => forceUpdate((n) => n + 1)), [subscribe])

  const dragState = getDragState()
  const showPlaceholder =
    dragState.clipId !== null &&
    dragState.targetTrackId === track.id &&
    !clips.some((c) => c.id === dragState.clipId)

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; atTime: number } | null>(null)

  useEffect(() => {
    if (!ctxMenu) return
    const close = (): void => setCtxMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close) }
  }, [ctxMenu])

  const handlePasteFromClipboard = useCallback(async (atTime: number) => {
    setCtxMenu(null)
    const filePath = await window.electronAPI.readClipboardPath()
    if (!filePath) { toast('No valid audio file on clipboard', 'error'); return }
    const meta = await window.electronAPI.getAudioMetadata(filePath)
    if (!meta) { toast(`Could not read: ${filePath.split('/').pop()}`, 'error'); return }
    const clip = addClipToTrack({
      trackId: track.id,
      name: filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'clip',
      filePath,
      duration: meta.duration,
      startTime: atTime,
    })
    window.electronAPI.getWaveformPeaks(filePath, peaksForClip(meta.duration, zoom))
      .then((peaks) => setWaveform(filePath, { peaks, loading: false }))
      .catch(console.error)
    window.electronAPI.getPeakLevel(filePath)
      .then((peak) => { if (peak > 0) updateClip(clip.id, { volume: Math.min(2, TARGET_PEAK_LINEAR / peak) }) })
      .catch(() => {})
  }, [track.id, zoom, addClipToTrack, updateClip, setWaveform, toast])

  const handleBgClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) selectClip(null)
  }, [selectClip])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const hasFiles = e.dataTransfer.types.includes('Files')
    const hasLibraryPath = e.dataTransfer.types.includes('application/x-limina-filepath') || e.dataTransfer.types.includes('text/plain')
    if (hasFiles || hasLibraryPath) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const audioExts = new Set(['mp3', 'wav', 'flac', 'aiff', 'aif', 'm4a', 'ogg'])

    const rect = e.currentTarget.getBoundingClientRect()
    // rect.left already shifts with scroll, so e.clientX - rect.left = correct content pixel position
    const dropTime = Math.max(0, Math.round(((e.clientX - rect.left) / zoom) * 100) / 100)

    // Native file drop (from Finder)
    const nativeFiles = Array.from(e.dataTransfer.files).filter((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      return audioExts.has(ext)
    })

    // Cross-app drag from Limina Library (path in dataTransfer text)
    const libraryPath =
      e.dataTransfer.getData('application/x-limina-filepath') ||
      e.dataTransfer.getData('text/plain')

    const sources: Array<{ filePath: string; fileName: string }> = []

    if (nativeFiles.length > 0) {
      for (const f of nativeFiles) {
        const fp = (f as File & { path?: string }).path
        if (fp) sources.push({ filePath: fp, fileName: f.name })
      }
    } else if (libraryPath) {
      const ext = libraryPath.split('.').pop()?.toLowerCase() ?? ''
      if (audioExts.has(ext)) {
        const fileName = libraryPath.split('/').pop() ?? libraryPath
        sources.push({ filePath: libraryPath, fileName })
      }
    }

    if (sources.length === 0) return

    let offsetTime = dropTime
    for (const { filePath, fileName } of sources) {
      const meta = await window.electronAPI.getAudioMetadata(filePath)
      if (!meta) { toast(`Could not read: ${fileName}`, 'error'); continue }
      const clip = addClipToTrack({
        trackId: track.id,
        name: fileName.replace(/\.[^.]+$/, ''),
        filePath,
        duration: meta.duration,
        startTime: offsetTime,
      })
      window.electronAPI
        .getWaveformPeaks(filePath, peaksForClip(meta.duration, zoom))
        .then((peaks) => setWaveform(filePath, { peaks, loading: false }))
        .catch(console.error)
      window.electronAPI
        .getPeakLevel(filePath)
        .then((peak) => { if (peak > 0) updateClip(clip.id, { volume: Math.min(2, TARGET_PEAK_LINEAR / peak) }) })
        .catch(() => {})
      window.electronAPI
        .lookupLibraryFile(filePath)
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
      offsetTime += meta.duration
    }
  }, [track.id, zoom, addClipToTrack, updateClip, setWaveform, toast])

  return (
    <div
      className="flex flex-col"
      onClick={handleBgClick}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('[data-clip]')) return
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        const atTime = Math.max(0, Math.round(((e.clientX - rect.left) / zoom) * 100) / 100)
        setCtxMenu({ x: e.clientX, y: e.clientY, atTime })
      }}
    >
      <div className="relative" style={{ height }}>
        {/* Subtle grid lines every 30 s */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `repeating-linear-gradient(90deg, #1f1f1f 0, #1f1f1f 1px, transparent 1px, transparent ${30 * zoom}px)`,
            backgroundSize: `${30 * zoom}px 100%`,
          }}
        />

        {/* Drop placeholder when a clip is being dragged into this row */}
        {showPlaceholder && (
          <div
            className="absolute top-1 bottom-1 rounded border border-dashed border-white/30 bg-white/5 pointer-events-none z-30"
            style={{ left: `${dragState.left}px`, width: `${dragState.width}px` }}
          />
        )}

        {clips.map((clip) => (
          <ClipBlock key={clip.id} clip={clip} track={track} tracks={tracks} zoom={zoom} trackHeight={height} />
        ))}
      </div>
      <AutomationLane clips={clips} zoom={zoom} color={track.color} height={laneHeight} onHeightChange={onLaneHeightChange} trackHeight={height} onTrackHeightChange={onHeightChange} />

      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[180px] rounded border border-surface-border bg-surface-panel shadow-lg py-1 text-[11px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface-hover transition-colors"
            onClick={() => handlePasteFromClipboard(ctxMenu.atTime)}
          >
            Paste from Clipboard
            <span className="float-right text-gray-600 ml-4">⌘V</span>
          </button>
        </div>
      )}
    </div>
  )
}
