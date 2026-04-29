import { useCallback, useEffect, useState } from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { useToastStore } from '../../store/toastStore'
import { ClipBlock } from './ClipBlock'
import { AutomationLane } from './AutomationLane'
import { useDragContext } from './DragContext'
import type { Clip, Track } from '../../types'

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

  const handleBgClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) selectClip(null)
  }, [selectClip])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const audioExts = new Set(['mp3', 'wav', 'flac', 'aiff', 'aif', 'm4a', 'ogg'])
    const files = Array.from(e.dataTransfer.files).filter((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      return audioExts.has(ext)
    })
    if (files.length === 0) return

    // Compute the timeline position from the drop x coordinate
    const rect = e.currentTarget.getBoundingClientRect()
    const scrollLeft = e.currentTarget.closest('.overflow-auto')?.scrollLeft ?? 0
    const dropTime = Math.max(0, Math.round(((e.clientX - rect.left + scrollLeft) / zoom) * 100) / 100)

    let offsetTime = dropTime
    for (const file of files) {
      const filePath = (file as File & { path?: string }).path
      if (!filePath) continue
      const meta = await window.electronAPI.getAudioMetadata(filePath)
      if (!meta) { toast(`Could not read: ${file.name}`, 'error'); continue }
      addClipToTrack({
        trackId: track.id,
        name: file.name.replace(/\.[^.]+$/, ''),
        filePath,
        duration: meta.duration,
        startTime: offsetTime,
      })
      window.electronAPI
        .getWaveformPeaks(filePath, 1200)
        .then((peaks) => setWaveform(filePath, { peaks, loading: false }))
        .catch(console.error)
      // If multiple files dropped at once, stagger them sequentially
      offsetTime += meta.duration
    }
  }, [track.id, zoom, addClipToTrack, setWaveform, toast])

  return (
    <div
      className="flex flex-col"
      onClick={handleBgClick}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
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
    </div>
  )
}
