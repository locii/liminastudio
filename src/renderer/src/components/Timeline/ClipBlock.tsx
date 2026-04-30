import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSessionStore } from '../../store/sessionStore'
import { useTransportStore } from '../../store/transportStore'
import { useDragContext } from './DragContext'
import { MiniWaveform } from './MiniWaveform'
import { audioEngine } from '../../audio/audioEngine'
import type { Clip, Track } from '../../types'

interface Props {
  clip: Clip
  track: Track
  tracks: Track[]
  zoom: number
  trackHeight: number
}

const MIN_CLIP_DURATION = 1

export function ClipBlock({ clip, track, tracks, zoom, trackHeight }: Props): JSX.Element {
  const waveforms = useSessionStore((s) => s.waveforms)
  const waveformData = waveforms[clip.filePath]
  const selectedClipId = useSessionStore((s) => s.selectedClipId)
  const updateClip = useSessionStore((s) => s.updateClip)
  const setWaveform = useSessionStore((s) => s.setWaveform)
  const removeClip = useSessionStore((s) => s.removeClip)
  const splitClip = useSessionStore((s) => s.splitClip)
  const duplicateClip = useSessionStore((s) => s.duplicateClip)
  const selectClip = useSessionStore((s) => s.selectClip)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const { setDragState } = useDragContext()
  const isSelected = selectedClipId === clip.id

  const effectiveDuration = clip.duration - clip.trimStart - clip.trimEnd
  const width = Math.max(4, effectiveDuration * zoom)
  const left = clip.startTime * zoom

  const dragState = useRef({
    active: false, startX: 0, startTime: 0,
    startY: 0, startTrackIndex: 0,
  })
  const trimState = useRef({
    active: false, startX: 0,
    startTrimStart: 0, startTrimEnd: 0, startStartTime: 0,
  })
  const fadeState = useRef({
    active: false, type: 'in' as 'in' | 'out',
    startX: 0, startFade: 0,
    startY: 0, startCurve: 0,
  })

  // ── Body drag (horizontal + cross-track) ────────────────────────────────────

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      selectClip(clip.id)

      const startTrackIndex = tracks.findIndex((t) => t.id === clip.trackId)
      dragState.current = {
        active: true, startX: e.clientX, startTime: clip.startTime,
        startY: e.clientY, startTrackIndex,
      }

      const onMove = (me: MouseEvent): void => {
        if (!dragState.current.active) return
        const deltaX = (me.clientX - dragState.current.startX) / zoom
        const raw = Math.max(0, dragState.current.startTime + deltaX)
        const newStartTime = Math.round(raw * 2) / 2
        updateClip(clip.id, { startTime: newStartTime })

        // Determine which track row the cursor is over and broadcast for placeholder
        const deltaY = me.clientY - dragState.current.startY
        const rawIdx = dragState.current.startTrackIndex + Math.round(deltaY / trackHeight)
        const targetIdx = Math.max(0, Math.min(rawIdx, tracks.length - 1))
        const targetTrack = tracks[targetIdx]
        setDragState({
          clipId: clip.id,
          targetTrackId: targetTrack?.id ?? null,
          width: effectiveDuration * zoom,
          left: newStartTime * zoom,
        })
      }
      const onUp = (me: MouseEvent): void => {
        dragState.current.active = false
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setDragState({ clipId: null, targetTrackId: null, width: 0, left: 0 })

        // Commit cross-track drop
        const deltaY = me.clientY - dragState.current.startY
        const rawIdx = dragState.current.startTrackIndex + Math.round(deltaY / trackHeight)
        const targetIdx = Math.max(0, Math.min(rawIdx, tracks.length - 1))
        const targetTrack = tracks[targetIdx]
        if (targetTrack && targetTrack.id !== clip.trackId) {
          updateClip(clip.id, { trackId: targetTrack.id })
        }
        const { clips, tracks: latestTracks } = useSessionStore.getState()
        audioEngine.softReload(clips, latestTracks)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [clip.id, clip.startTime, clip.trackId, effectiveDuration, zoom, trackHeight, tracks, selectClip, updateClip, setWaveform, setDragState]
  )

  // ── Left trim handle ─────────────────────────────────────────────────────────

  const onTrimStartMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      selectClip(clip.id)
      trimState.current = {
        active: true, startX: e.clientX,
        startTrimStart: clip.trimStart, startTrimEnd: clip.trimEnd,
        startStartTime: clip.startTime,
      }

      const onMove = (me: MouseEvent): void => {
        if (!trimState.current.active) return
        const { startX, startTrimStart, startTrimEnd, startStartTime } = trimState.current
        const delta = (me.clientX - startX) / zoom
        // Clamp: trimStart >= 0, startTime >= 0, effectiveDuration >= MIN_CLIP_DURATION
        const maxDelta = clip.duration - startTrimEnd - MIN_CLIP_DURATION - startTrimStart
        const minDelta = Math.max(-startTrimStart, -startStartTime)
        const clampedDelta = Math.max(minDelta, Math.min(delta, maxDelta))
        updateClip(clip.id, {
          trimStart: startTrimStart + clampedDelta,
          startTime: startStartTime + clampedDelta,
        })
      }
      const onUp = (): void => {
        trimState.current.active = false
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        const { clips, tracks } = useSessionStore.getState()
        audioEngine.softReload(clips, tracks)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [clip.id, clip.startTime, clip.trimStart, clip.trimEnd, clip.duration, zoom, selectClip, updateClip]
  )

  // ── Right trim handle ────────────────────────────────────────────────────────

  const onTrimEndMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      selectClip(clip.id)
      trimState.current = {
        active: true, startX: e.clientX,
        startTrimStart: clip.trimStart, startTrimEnd: clip.trimEnd,
        startStartTime: clip.startTime,
      }

      const onMove = (me: MouseEvent): void => {
        if (!trimState.current.active) return
        const { startX, startTrimStart, startTrimEnd } = trimState.current
        const delta = (me.clientX - startX) / zoom
        // Dragging right = less trim (delta positive = less trimEnd)
        const maxTrimEnd = clip.duration - startTrimStart - MIN_CLIP_DURATION
        const newTrimEnd = Math.max(0, Math.min(startTrimEnd - delta, maxTrimEnd))
        updateClip(clip.id, { trimEnd: newTrimEnd })
      }
      const onUp = (): void => {
        trimState.current.active = false
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        const { clips, tracks } = useSessionStore.getState()
        audioEngine.softReload(clips, tracks)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [clip.id, clip.trimStart, clip.trimEnd, clip.duration, zoom, selectClip, updateClip]
  )

  // ── Fade handle drag ─────────────────────────────────────────────────────────

  const onFadeHandleMouseDown = useCallback(
    (e: React.MouseEvent, type: 'in' | 'out') => {
      if (e.button !== 0) return
      e.stopPropagation()
      selectClip(clip.id)
      fadeState.current = {
        active: true, type,
        startX: e.clientX, startFade: type === 'in' ? clip.fadeIn : clip.fadeOut,
        startY: e.clientY, startCurve: type === 'in' ? clip.fadeInCurve : clip.fadeOutCurve,
      }
      document.body.style.cursor = 'move'

      const onMove = (me: MouseEvent): void => {
        if (!fadeState.current.active) return
        const { startX, startFade, startY, startCurve } = fadeState.current
        const deltaX = (me.clientX - startX) / zoom
        const maxFade = effectiveDuration / 2
        // Up = more convex (positive curve), down = more concave
        const newCurve = Math.max(-1, Math.min(1, startCurve - (me.clientY - startY) / (trackHeight / 2)))
        if (type === 'in') {
          const v = Math.max(0, Math.min(startFade + deltaX, maxFade))
          updateClip(clip.id, {
            fadeIn: Math.round(v * 100) / 100,
            fadeInCurve: Math.round(newCurve * 100) / 100,
          })
        } else {
          const v = Math.max(0, Math.min(startFade - deltaX, maxFade))
          updateClip(clip.id, {
            fadeOut: Math.round(v * 100) / 100,
            fadeOutCurve: Math.round(newCurve * 100) / 100,
          })
        }
      }
      const onUp = (): void => {
        fadeState.current.active = false
        document.body.style.cursor = ''
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        // Resync audio engine with updated fade values
        const { clips, tracks } = useSessionStore.getState()
        audioEngine.softReload(clips, tracks)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [clip.id, clip.fadeIn, clip.fadeOut, clip.fadeInCurve, clip.fadeOutCurve, effectiveDuration, zoom, trackHeight, selectClip, updateClip]
  )

  useEffect(() => {
    if (!ctxMenu) return
    const close = (): void => setCtxMenu(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [ctxMenu])

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      selectClip(clip.id)
      setCtxMenu({ x: e.clientX, y: e.clientY })
    },
    [clip.id, selectClip]
  )

  return (
    <>
    <div
      className={`absolute top-1 bottom-1 rounded overflow-hidden select-none cursor-grab active:cursor-grabbing transition-shadow ${
        isSelected ? 'shadow-[0_0_0_2px_#6366f1]' : ''
      }`}
      style={{
        left: `${left}px`,
        width: `${width}px`,
        background: track.color + '33',
        borderLeft: `2px solid ${track.color}`,
      }}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
    >
      {/* Waveform canvas */}
      {waveformData?.peaks && waveformData.peaks.length > 0 && (
        <MiniWaveform
          peaks={waveformData.peaks}
          color={track.color}
          duration={clip.duration}
          trimStart={clip.trimStart}
          trimEnd={clip.trimEnd}
          gain={clip.volume}
        />
      )}

      {/* Filename */}
      <div
        className="absolute top-1 left-2.5 text-[10px] text-white/60 truncate z-10 pointer-events-none"
        style={{ maxWidth: `${width - 20}px` }}
      >
        {clip.fileName}
      </div>

      {/* Fade-in curve */}
      {clip.fadeIn > 0 && (
        <div
          className="absolute top-0 left-0 bottom-0 pointer-events-none z-10"
          style={{ width: `${Math.min(clip.fadeIn * zoom, width * 0.5)}px` }}
        >
          <FadeCurve direction="in" color={track.color} curve={clip.fadeInCurve} />
        </div>
      )}

      {/* Fade-out curve */}
      {clip.fadeOut > 0 && (
        <div
          className="absolute top-0 right-0 bottom-0 pointer-events-none z-10"
          style={{ width: `${Math.min(clip.fadeOut * zoom, width * 0.5)}px` }}
        >
          <FadeCurve direction="out" color={track.color} curve={clip.fadeOutCurve} />
        </div>
      )}

      {/* Fade-in drag handle — only when clip is wide enough to show it */}
      {width >= 20 && (
        <div
          className={`absolute top-1.5 w-3 h-3 rounded-full border-2 border-white/80 cursor-ew-resize transition-opacity ${
            isSelected ? 'opacity-100' : 'opacity-0 hover:opacity-80'
          }`}
          style={{
            left: `${Math.max(0, Math.min(Math.min(clip.fadeIn * zoom, width / 2) - 6, width - 12))}px`,
            background: track.color,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
            zIndex: 30,
          }}
          onMouseDown={(e) => onFadeHandleMouseDown(e, 'in')}
        />
      )}

      {/* Fade-out drag handle — only when clip is wide enough to show it */}
      {width >= 20 && (
        <div
          className={`absolute top-1.5 w-3 h-3 rounded-full border-2 border-white/80 cursor-ew-resize transition-opacity ${
            isSelected ? 'opacity-100' : 'opacity-0 hover:opacity-80'
          }`}
          style={{
            left: `${Math.max(0, Math.min(width - Math.min(clip.fadeOut * zoom, width / 2) - 6, width - 12))}px`,
            background: track.color,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
            zIndex: 30,
          }}
          onMouseDown={(e) => onFadeHandleMouseDown(e, 'out')}
        />
      )}

      {/* Left trim handle */}
      <div
        className="absolute top-1/2 left-0 bottom-0 w-2 z-20 cursor-ew-resize group/trim"
        onMouseDown={onTrimStartMouseDown}
      >
        <div className="absolute inset-0 group-hover/trim:bg-white/10 transition-colors" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-2/5 bg-white/25 group-hover/trim:bg-white/60 rounded-full transition-colors" />
      </div>

      {/* Right trim handle */}
      <div
        className="absolute top-1/2 right-0 bottom-0 w-2 z-20 cursor-ew-resize group/trimr"
        onMouseDown={onTrimEndMouseDown}
      >
        <div className="absolute inset-0 group-hover/trimr:bg-white/10 transition-colors" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-2/5 bg-white/25 group-hover/trimr:bg-white/60 rounded-full transition-colors" />
      </div>

    </div>

    {ctxMenu && createPortal(
      <div
        style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999 }}
        className="bg-surface-panel border border-surface-border rounded shadow-xl py-1 min-w-36 text-xs"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          className="w-full text-left px-3 py-1.5 hover:bg-surface-hover text-gray-300 transition-colors flex items-center justify-between"
          onClick={() => { splitClip(clip.id, useTransportStore.getState().playhead); setCtxMenu(null) }}
        >
          <span>Split at Playhead</span>
          <span className="text-gray-600 text-[10px]">S</span>
        </button>
        <button
          className="w-full text-left px-3 py-1.5 hover:bg-surface-hover text-gray-300 transition-colors"
          onClick={() => { duplicateClip(clip.id); setCtxMenu(null) }}
        >
          Duplicate Clip
        </button>
        <button
          className="w-full text-left px-3 py-1.5 hover:bg-surface-hover text-gray-300 transition-colors"
          onClick={() => { window.electronAPI.showInFolder(clip.filePath); setCtxMenu(null) }}
        >
          Show in Folder
        </button>
        <div className="my-1 h-px bg-surface-border" />
        <button
          className="w-full text-left px-3 py-1.5 hover:bg-surface-hover text-red-400 transition-colors"
          onClick={() => { removeClip(clip.id); setCtxMenu(null) }}
        >
          Remove Clip
        </button>
      </div>,
      document.body
    )}
    </>
  )
}

// ── Fade curve SVG — power-law shape, curve: -1 (concave) → 0 (linear) → 1 (convex) ──

const CURVE_POINTS = 32

function FadeCurve({ direction, color, curve }: { direction: 'in' | 'out'; color: string; curve: number }): JSX.Element {
  // exponent: curve=1→0.25 (very convex), curve=0.5→0.5 (eq-power), curve=0→1 (linear), curve=-1→4 (very concave)
  const exponent = Math.pow(4, -curve)
  const pts: string[] = []

  const yAt = (t: number): number =>
    direction === 'out'
      ? (1 - Math.pow(1 - t, exponent)) * 100   // starts y=0 (full gain), ends y=100 (silent)
      : (1 - Math.pow(t, exponent)) * 100        // starts y=100 (silent), ends y=0 (full gain)

  if (direction === 'out') {
    pts.push('0,0')
    for (let i = 0; i <= CURVE_POINTS; i++) pts.push(`${(i / CURVE_POINTS) * 100},${yAt(i / CURVE_POINTS)}`)
    pts.push('100,100', '0,100')
  } else {
    for (let i = 0; i <= CURVE_POINTS; i++) pts.push(`${(i / CURVE_POINTS) * 100},${yAt(i / CURVE_POINTS)}`)
    pts.push('100,0', '100,100', '0,100')
  }

  const strokePts = Array.from({ length: CURVE_POINTS + 1 }, (_, i) =>
    `${(i / CURVE_POINTS) * 100},${yAt(i / CURVE_POINTS)}`
  ).join(' ')

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
      <polygon points={pts.join(' ')} fill={color + '40'} />
      <polyline points={strokePts} fill="none" stroke={color + 'cc'} strokeWidth="3" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
