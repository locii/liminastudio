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
  const selectedClipIds = useSessionStore((s) => s.selectedClipIds)
  const updateClip = useSessionStore((s) => s.updateClip)
  const updateClipSilent = useSessionStore((s) => s.updateClipSilent)
  const pushHistorySnapshot = useSessionStore((s) => s.pushHistorySnapshot)
  const setWaveform = useSessionStore((s) => s.setWaveform)
  const removeClip = useSessionStore((s) => s.removeClip)
  const splitClip = useSessionStore((s) => s.splitClip)
  const duplicateClip = useSessionStore((s) => s.duplicateClip)
  const selectClip = useSessionStore((s) => s.selectClip)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const { setDragState } = useDragContext()
  const isSelected = selectedClipIds.includes(clip.id)

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

      // If the clip is already selected and no modifier, keep the multi-selection so
      // dragging works across all selected clips. Only reset if clicking outside the selection.
      const alreadySelected = useSessionStore.getState().selectedClipIds.includes(clip.id)
      if (!alreadySelected || e.shiftKey) selectClip(clip.id, e.shiftKey)

      // Capture pre-drag state for a single undo step on release
      const preDragSnap = { tracks: useSessionStore.getState().tracks, clips: useSessionStore.getState().clips }

      // Snapshot start positions of all clips to move (multi or single)
      const { selectedClipIds: ids, clips: allClips } = useSessionStore.getState()
      const idsToMove = ids.includes(clip.id) ? ids : [clip.id]
      const startTimesMap = new Map<string, number>()
      for (const id of idsToMove) {
        const c = allClips.find((x) => x.id === id)
        if (c) startTimesMap.set(id, c.startTime)
      }

      const startTrackIndex = tracks.findIndex((t) => t.id === clip.trackId)
      dragState.current = {
        active: true, startX: e.clientX, startTime: clip.startTime,
        startY: e.clientY, startTrackIndex,
      }

      const onMove = (me: MouseEvent): void => {
        if (!dragState.current.active) return
        // Snap the delta so all clips move together without drifting relative to each other
        const rawDelta = (me.clientX - dragState.current.startX) / zoom
        const snappedDelta = Math.round(rawDelta * 2) / 2
        for (const [id, startTime] of startTimesMap) {
          updateClipSilent(id, { startTime: Math.max(0, startTime + snappedDelta) })
        }

        // Broadcast primary clip position for drop placeholder
        const primaryStart = Math.max(0, dragState.current.startTime + snappedDelta)
        const deltaY = me.clientY - dragState.current.startY
        const rawIdx = dragState.current.startTrackIndex + Math.round(deltaY / trackHeight)
        const targetIdx = Math.max(0, Math.min(rawIdx, tracks.length - 1))
        const targetTrack = tracks[targetIdx]
        setDragState({
          clipId: clip.id,
          targetTrackId: targetTrack?.id ?? null,
          width: effectiveDuration * zoom,
          left: primaryStart * zoom,
        })
      }
      const onUp = (me: MouseEvent): void => {
        dragState.current.active = false
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setDragState({ clipId: null, targetTrackId: null, width: 0, left: 0 })

        // Cross-track drop only for single-clip drags
        if (idsToMove.length === 1) {
          const deltaY = me.clientY - dragState.current.startY
          const rawIdx = dragState.current.startTrackIndex + Math.round(deltaY / trackHeight)
          const targetIdx = Math.max(0, Math.min(rawIdx, tracks.length - 1))
          const targetTrack = tracks[targetIdx]
          if (targetTrack && targetTrack.id !== clip.trackId) {
            updateClipSilent(clip.id, { trackId: targetTrack.id })
          }
        }
        // Commit the entire drag as one undo step
        pushHistorySnapshot(preDragSnap)
        const { clips, tracks: latestTracks } = useSessionStore.getState()
        audioEngine.softReload(clips, latestTracks)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [clip.id, clip.startTime, clip.trackId, effectiveDuration, zoom, trackHeight, tracks, selectClip, updateClipSilent, pushHistorySnapshot, setDragState]
  )

  // ── Left trim handle ─────────────────────────────────────────────────────────

  const onTrimStartMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      selectClip(clip.id)
      const preTrimSnap = { tracks: useSessionStore.getState().tracks, clips: useSessionStore.getState().clips }
      trimState.current = {
        active: true, startX: e.clientX,
        startTrimStart: clip.trimStart, startTrimEnd: clip.trimEnd,
        startStartTime: clip.startTime,
      }

      const onMove = (me: MouseEvent): void => {
        if (!trimState.current.active) return
        const { startX, startTrimStart, startTrimEnd, startStartTime } = trimState.current
        const delta = (me.clientX - startX) / zoom
        const maxDelta = clip.duration - startTrimEnd - MIN_CLIP_DURATION - startTrimStart
        const minDelta = Math.max(-startTrimStart, -startStartTime)
        const clampedDelta = Math.max(minDelta, Math.min(delta, maxDelta))
        updateClipSilent(clip.id, {
          trimStart: startTrimStart + clampedDelta,
          startTime: startStartTime + clampedDelta,
        })
      }
      const onUp = (): void => {
        trimState.current.active = false
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        pushHistorySnapshot(preTrimSnap)
        const { clips, tracks } = useSessionStore.getState()
        audioEngine.softReload(clips, tracks)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [clip.id, clip.startTime, clip.trimStart, clip.trimEnd, clip.duration, zoom, selectClip, updateClipSilent, pushHistorySnapshot]
  )

  // ── Right trim handle ────────────────────────────────────────────────────────

  const onTrimEndMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      selectClip(clip.id)
      const preTrimSnap = { tracks: useSessionStore.getState().tracks, clips: useSessionStore.getState().clips }
      trimState.current = {
        active: true, startX: e.clientX,
        startTrimStart: clip.trimStart, startTrimEnd: clip.trimEnd,
        startStartTime: clip.startTime,
      }

      const onMove = (me: MouseEvent): void => {
        if (!trimState.current.active) return
        const { startX, startTrimStart, startTrimEnd } = trimState.current
        const delta = (me.clientX - startX) / zoom
        const maxTrimEnd = clip.duration - startTrimStart - MIN_CLIP_DURATION
        const newTrimEnd = Math.max(0, Math.min(startTrimEnd - delta, maxTrimEnd))
        updateClipSilent(clip.id, { trimEnd: newTrimEnd })
      }
      const onUp = (): void => {
        trimState.current.active = false
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        pushHistorySnapshot(preTrimSnap)
        const { clips, tracks } = useSessionStore.getState()
        audioEngine.softReload(clips, tracks)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [clip.id, clip.trimStart, clip.trimEnd, clip.duration, zoom, selectClip, updateClipSilent, pushHistorySnapshot]
  )

  // ── Fade handle drag ─────────────────────────────────────────────────────────

  const onFadeHandleMouseDown = useCallback(
    (e: React.MouseEvent, type: 'in' | 'out') => {
      if (e.button !== 0) return
      e.stopPropagation()
      selectClip(clip.id)
      const preFadeSnap = { tracks: useSessionStore.getState().tracks, clips: useSessionStore.getState().clips }
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
        const newCurve = Math.max(-1, Math.min(1, startCurve - (me.clientY - startY) / (trackHeight / 2)))
        if (type === 'in') {
          const v = Math.max(0, Math.min(startFade + deltaX, maxFade))
          updateClipSilent(clip.id, {
            fadeIn: Math.round(v * 100) / 100,
            fadeInCurve: Math.round(newCurve * 100) / 100,
          })
        } else {
          const v = Math.max(0, Math.min(startFade - deltaX, maxFade))
          updateClipSilent(clip.id, {
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
        pushHistorySnapshot(preFadeSnap)
        const { clips, tracks } = useSessionStore.getState()
        audioEngine.softReload(clips, tracks)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [clip.id, clip.fadeIn, clip.fadeOut, clip.fadeInCurve, clip.fadeOutCurve, effectiveDuration, zoom, trackHeight, selectClip, updateClipSilent, pushHistorySnapshot]
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
