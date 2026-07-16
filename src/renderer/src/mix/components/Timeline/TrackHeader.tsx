import { useCallback, useRef, useState } from 'react'
import type React from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { useTransportStore } from '../../store/transportStore'
import { useToastStore } from '../../store/toastStore'
import { TrackVUMeter } from './TrackVUMeter'
import type { Track, Clip } from '../../types'

const TARGET_PEAK_LINEAR = Math.pow(10, -0.5 / 20)

function volAtPlayhead(clips: Clip[], playhead: number): number {
  const clip = clips.find((c) => {
    const eff = c.duration - c.trimStart - c.trimEnd
    return playhead >= c.startTime && playhead < c.startTime + eff
  })
  if (!clip) return 1
  const nodes = [...(clip.automation ?? [])].sort((a, b) => a.time - b.time)
  if (nodes.length === 0) return 1
  const t = playhead - clip.startTime
  if (t <= nodes[0].time) return nodes[0].value
  if (t >= nodes[nodes.length - 1].time) return nodes[nodes.length - 1].value
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i]; const b = nodes[i + 1]
    if (t >= a.time && t <= b.time) {
      return a.value + ((t - a.time) / (b.time - a.time)) * (b.value - a.value)
    }
  }
  return 1
}

interface Props {
  track: Track
  clips: Clip[]
  height: number
  onHeightChange: (h: number) => void
  laneHeight: number
  onLaneHeightChange: (h: number) => void
  isFirst?: boolean
}

export function TrackHeader({ track, clips, height, onHeightChange, laneHeight, onLaneHeightChange, isFirst }: Props): JSX.Element {
  const removeTrack = useSessionStore((s) => s.removeTrack)
  const updateTrack = useSessionStore((s) => s.updateTrack)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(track.name)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const commitRename = (): void => {
    const trimmed = draftName.trim()
    if (trimmed) updateTrack(track.id, { name: trimmed })
    else setDraftName(track.name)
    setRenaming(false)
  }

  const startRename = (e: React.MouseEvent): void => {
    e.stopPropagation()
    setDraftName(track.name)
    setRenaming(true)
    setTimeout(() => nameInputRef.current?.select(), 0)
  }
  const addClipToTrack = useSessionStore((s) => s.addClipToTrack)
  const updateClip = useSessionStore((s) => s.updateClip)
  const setWaveform = useSessionStore((s) => s.setWaveform)
  const selectTrack = useSessionStore((s) => s.selectTrack)
  const selectedTrackId = useSessionStore((s) => s.selectedTrackId)
  const toast = useToastStore((s) => s.add)
  const playhead = useTransportStore((s) => s.playhead)
  const volPct = Math.round(volAtPlayhead(clips, playhead) * 100)
  const isSelected = selectedTrackId === track.id

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = height
    const onMove = (me: MouseEvent): void => onHeightChange(startHeight + me.clientY - startY)
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'ns-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [height, onHeightChange])

  const handleAddClip = async (): Promise<void> => {
    const files = await window.electronAPI.openAudioFiles()
    for (const file of files) {
      const clip = addClipToTrack({
        trackId: track.id,
        name: file.name.replace(/\.[^.]+$/, ''),
        filePath: file.path,
        duration: file.duration,
      })
      window.electronAPI
        .getWaveformPeaks(file.path, 1200)
        .then((peaks) => setWaveform(file.path, { peaks, loading: false }))
        .catch(() => toast('Failed to load waveform', 'error'))
      window.electronAPI
        .getPeakLevel(file.path)
        .then((peak) => { if (peak > 0) updateClip(clip.id, { volume: Math.min(2, TARGET_PEAK_LINEAR / peak) }) })
        .catch(() => {})
    }
  }

  return (
    <div
      style={{ borderLeft: `3px solid ${track.color}` }}
      onClick={() => selectTrack(isSelected ? null : track.id)}
      className="cursor-pointer"
      {...(isFirst ? { 'data-tour': 'track-header-first' } : {})}
    >
      <div
        className={`relative flex flex-col justify-between px-2.5 py-2 bg-surface-panel shrink-0 overflow-hidden transition-colors ${isSelected ? 'ring-1 ring-inset ring-accent/60' : ''}`}
        style={{ height }}
      >
        <div className="absolute right-0 top-0 w-2">
          <TrackVUMeter trackId={track.id} height={height} />
        </div>
        {/* Name + colour + remove */}
        <div className="flex items-center gap-1">
          {/* Colour picker swatch */}
          <label className="w-2.5 h-2.5 rounded-sm cursor-pointer shrink-0 hover:ring-1 hover:ring-white/40 transition-all"
            style={{ background: track.color }}
            title="Change track colour">
            <input
              type="color"
              className="sr-only"
              value={track.color}
              onChange={(e) => updateTrack(track.id, { color: e.target.value })}
            />
          </label>
          {renaming ? (
            <input
              ref={nameInputRef}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') { setDraftName(track.name); setRenaming(false) }
                e.stopPropagation()
              }}
              onClick={(e) => e.stopPropagation()}
              className="text-xs font-medium bg-surface-hover text-gray-200 rounded px-1 flex-1 min-w-0 outline-none border border-accent/50"
            />
          ) : (
            <span
              className="text-xs font-medium text-gray-300 truncate flex-1 cursor-text"
              title="Double-click to rename"
              onDoubleClick={startRename}
            >
              {track.name}
            </span>
          )}
          <button onClick={handleAddClip}
            className="text-gray-600 hover:text-accent transition-colors text-xs leading-none px-0.5"
            title="Add clip to this track">
            ＋
          </button>
          <button onClick={() => removeTrack(track.id)}
            className="text-gray-600 hover:text-red-400 transition-colors text-xs leading-none px-0.5"
            title="Remove track">
            ✕
          </button>
        </div>

        {/* Mute / Solo */}
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); updateTrack(track.id, { muted: !track.muted }) }}
            className={`text-[9px] font-bold px-1 py-0.5 rounded leading-none transition-colors ${
              track.muted ? 'bg-yellow-500 text-black' : 'bg-surface-hover text-gray-500 hover:text-gray-200'
            }`}
          >M</button>
          <button
            onClick={(e) => { e.stopPropagation(); updateTrack(track.id, { solo: !track.solo }) }}
            className={`text-[9px] font-bold px-1 py-0.5 rounded leading-none transition-colors ${
              track.solo ? 'bg-amber-400 text-black' : 'bg-surface-hover text-gray-500 hover:text-gray-200'
            }`}
          >S</button>
        </div>

        {/* Resize handle */}
        <div
          className="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-white/20 transition-colors"
          onMouseDown={onResizeMouseDown}
        />
      </div>

      <div className="relative border-b border-surface-border bg-surface-panel" style={{ height: laneHeight }}>
        {isFirst && <span data-tour="automation-toggle" className="absolute" style={{ width: 1, height: 1, top: 0, left: 0 }} />}
        <span className="absolute left-2 text-[8px] text-gray-500 leading-none select-none" style={{ top: 2 }}>200%</span>
        {laneHeight >= 48 && (
          <span className="absolute left-2 text-[8px] text-gray-500 leading-none -translate-y-1/2 select-none" style={{ top: '50%' }}>100%</span>
        )}
        <span className="absolute left-2 text-[8px] text-gray-500 leading-none select-none" style={{ bottom: 2 }}>0%</span>
        <span
          className="absolute right-2 text-[9px] font-medium leading-none select-none tabular-nums"
          style={{ top: '50%', transform: 'translateY(-50%)', color: volPct > 100 ? '#f59e0b' : volPct < 30 ? '#ef4444' : '#9ca3af' }}
        >
          {volPct}%
        </span>
        <div
          className="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-white/20 transition-colors"
          onMouseDown={(e) => {
            e.preventDefault()
            const startY = e.clientY
            const startH = laneHeight
            const onMove = (me: MouseEvent): void => onLaneHeightChange(startH + me.clientY - startY)
            const onUp = (): void => {
              window.removeEventListener('mousemove', onMove)
              window.removeEventListener('mouseup', onUp)
              document.body.style.cursor = ''
            }
            document.body.style.cursor = 'ns-resize'
            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
          }}
        />
      </div>
    </div>
  )
}
