import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { useTransportStore } from '../../store/transportStore'
import { audioEngine } from '../../audio/audioEngine'
import { TrackHeader } from './TrackHeader'
import { TimelineTrack } from './TimelineTrack'
import { TimeRuler } from './TimeRuler'
import { MarkerFlag } from './MarkerFlag'
import { DragProvider } from './DragContext'
import type { Clip } from '../../types'

const RULER_HEIGHT = 28
const TRACK_HEIGHT = 84
const MIN_TRACK_HEIGHT = 48
const MAX_TRACK_HEIGHT = 240
const LANE_HEIGHT = 48
const MIN_LANE_HEIGHT = 32
const MAX_LANE_HEIGHT = 160

interface Props {
  fitToWindowRef?: React.MutableRefObject<(() => void) | null>
}

export function Timeline({ fitToWindowRef }: Props = {}): JSX.Element {
  const tracks = useSessionStore((s) => s.tracks)
  const clips = useSessionStore((s) => s.clips)
  const markers = useSessionStore((s) => s.markers)
  const addMarker = useSessionStore((s) => s.addMarker)
  const updateMarker = useSessionStore((s) => s.updateMarker)
  const removeMarker = useSessionStore((s) => s.removeMarker)
  const zoom = useTransportStore((s) => s.zoom)
  const setZoom = useTransportStore((s) => s.setZoom)
  const playhead = useTransportStore((s) => s.playhead)
  const setScrollX = useTransportStore((s) => s.setScrollX)

  const [trackHeights, setTrackHeights] = useState<Record<string, number>>({})
  const getHeight = useCallback((id: string) => trackHeights[id] ?? TRACK_HEIGHT, [trackHeights])
  const handleHeightChange = useCallback((id: string, h: number) => {
    setTrackHeights((prev) => ({ ...prev, [id]: Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, h)) }))
  }, [])

  const [laneHeights, setLaneHeights] = useState<Record<string, number>>({})
  const getLaneHeight = useCallback((id: string) => laneHeights[id] ?? LANE_HEIGHT, [laneHeights])
  const handleLaneHeightChange = useCallback((id: string, h: number) => {
    setLaneHeights((prev) => ({ ...prev, [id]: Math.max(MIN_LANE_HEIGHT, Math.min(MAX_LANE_HEIGHT, h)) }))
  }, [])

  const timelineRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const rulerContentRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoom)
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  // Scroll to playhead on large jumps (prev/next/seek) — ignore continuous playback ticks
  const prevPlayheadRef = useRef(playhead)
  useEffect(() => {
    const prev = prevPlayheadRef.current
    prevPlayheadRef.current = playhead
    if (Math.abs(playhead - prev) < 1) return
    const el = timelineRef.current
    if (!el) return
    const targetScroll = playhead * zoomRef.current - el.clientWidth / 2
    el.scrollLeft = Math.max(0, targetScroll)
  }, [playhead])

  // Track the center time continuously so resize can restore it.
  const centerTimeRef = useRef(0)

  // Pinch-to-zoom — must be non-passive to call preventDefault
  useEffect(() => {
    const el = timelineRef.current
    if (!el) return
    const handler = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const currentZoom = zoomRef.current
      const newZoom = currentZoom * Math.pow(0.999, e.deltaY)
      // Keep the time under the cursor fixed while zooming
      const rect = el.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const timeAtCursor = (el.scrollLeft + mouseX) / currentZoom
      setZoom(newZoom)
      // Adjust scroll so the same time stays under the cursor
      requestAnimationFrame(() => {
        el.scrollLeft = timeAtCursor * newZoom - mouseX
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [setZoom])

  // Sync vertical scroll between headers and timeline; translate the ruler strip
  // horizontally so it always shows the correct time range without being inside
  // the vertically-scrollable container.
  const onTimelineScroll = useCallback(() => {
    const el = timelineRef.current
    if (!el) return
    if (headerRef.current) headerRef.current.scrollTop = el.scrollTop
    if (rulerContentRef.current) {
      rulerContentRef.current.style.transform = `translateX(-${el.scrollLeft}px)`
    }
    setScrollX(el.scrollLeft)
    centerTimeRef.current = (el.scrollLeft + el.clientWidth / 2) / zoomRef.current
  }, [setScrollX])

  // On window resize: keep the playhead centred in the viewport.
  useEffect(() => {
    const handler = (): void => {
      requestAnimationFrame(() => {
        const el = timelineRef.current
        if (!el) return
        const pos = useTransportStore.getState().playhead
        el.scrollLeft = Math.max(0, pos * zoomRef.current - el.clientWidth / 2)
      })
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const onHeaderScroll = useCallback(() => {
    if (!timelineRef.current || !headerRef.current) return
    timelineRef.current.scrollTop = headerRef.current.scrollTop
  }, [])

  // Total timeline width: furthest clip end + 60 s padding
  const totalDuration = useMemo(() => {
    if (clips.length === 0) return 120
    const maxEnd = Math.max(
      ...clips.map((c) => c.startTime + c.duration - c.trimStart - c.trimEnd)
    )
    return maxEnd + 60
  }, [clips])

  const totalWidth = totalDuration * zoom

  // Wire the fit-to-window callback — reads DOM width at call time so it's always fresh
  useEffect(() => {
    if (!fitToWindowRef) return
    fitToWindowRef.current = () => {
      const w = timelineRef.current?.clientWidth ?? 0
      if (w > 0) setZoom(w / totalDuration)
    }
  }, [fitToWindowRef, totalDuration, setZoom])

  // Group clips by trackId
  const clipsByTrack = useMemo(() => {
    const map = new Map<string, Clip[]>()
    for (const clip of clips) {
      if (!map.has(clip.trackId)) map.set(clip.trackId, [])
      map.get(clip.trackId)!.push(clip)
    }
    return map
  }, [clips])

  const sortedTracks = useMemo(
    () => [...tracks].sort((a, b) => a.order - b.order),
    [tracks]
  )

  const handleRulerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      // Ruler content is translated; use its parent (the clip strip) for the rect.
      const strip = rulerContentRef.current?.parentElement
      const scrollEl = timelineRef.current
      if (!strip || !scrollEl) return
      const rect = strip.getBoundingClientRect()
      const x = e.clientX - rect.left + scrollEl.scrollLeft
      const time = Math.max(0, x / zoom)
      audioEngine.seek(time)
    },
    [zoom]
  )

  const handleRulerDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const strip = rulerContentRef.current?.parentElement
      const scrollEl = timelineRef.current
      if (!strip || !scrollEl) return
      const rect = strip.getBoundingClientRect()
      const x = e.clientX - rect.left + scrollEl.scrollLeft
      const time = Math.round(Math.max(0, x / zoom) * 100) / 100
      addMarker(time)
    },
    [zoom, addMarker]
  )

  if (tracks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-600">
        <svg className="w-12 h-12 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
            d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
        </svg>
        <p className="text-sm">
          Click <span className="text-accent font-medium">Add Track</span> to load audio files
        </p>
      </div>
    )
  }

  const playheadPx = playhead * zoom

  return (
    <DragProvider>
    <div className="flex-1 flex overflow-hidden">
      {/* Left: fixed track headers */}
      <div className="w-44 shrink-0 flex flex-col border-r border-surface-border">
        {/* Ruler spacer */}
        <div
          className="shrink-0 bg-surface-panel border-b border-surface-border"
          style={{ height: RULER_HEIGHT }}
        />
        {/* Track headers — scroll synced with timeline */}
        <div
          ref={headerRef}
          className="flex-1 overflow-y-scroll overflow-x-hidden"
          style={{ scrollbarWidth: 'none' }}
          onScroll={onHeaderScroll}
        >
          {sortedTracks.map((t, i) => (
            <TrackHeader key={t.id} track={t} clips={clipsByTrack.get(t.id) ?? []} height={getHeight(t.id)} onHeightChange={(h) => handleHeightChange(t.id, h)} laneHeight={getLaneHeight(t.id)} onLaneHeightChange={(h) => handleLaneHeightChange(t.id, h)} isFirst={i === 0} />
          ))}
        </div>
        {/* Master volume — bottom of left column */}
        <MasterVolumeFooter />
      </div>

      {/* Right: ruler strip + scrollable tracks */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Ruler — sits outside the scroll container so it never scrolls vertically.
            Horizontal position is kept in sync via CSS transform in onTimelineScroll. */}
        <div
          className="shrink-0 overflow-hidden relative border-b border-surface-border"
          style={{ height: RULER_HEIGHT }}
        >
          <div
            ref={rulerContentRef}
            data-tour="ruler"
            onMouseDown={handleRulerMouseDown}
            onDoubleClick={handleRulerDoubleClick}
            className="absolute top-0 left-0 cursor-crosshair will-change-transform"
            style={{ width: `${totalWidth}px`, minWidth: '100%' }}
          >
            <TimeRuler zoom={zoom} duration={totalDuration} height={RULER_HEIGHT} />
            {/* Playhead triangle lives here so it translates with the ruler */}
            <div
              className="absolute top-0 pointer-events-none z-50 -translate-x-1/2"
              style={{ left: `${playheadPx}px` }}
            >
              <div
                style={{
                  width: 0, height: 0,
                  borderLeft: '5px solid transparent',
                  borderRight: '5px solid transparent',
                  borderTop: `${RULER_HEIGHT}px solid #ef4444`,
                }}
              />
            </div>
          </div>
        </div>

        {/* Scrollable track area */}
        <div
          ref={timelineRef}
          data-tour="timeline"
          className="flex-1 overflow-auto relative"
          onScroll={onTimelineScroll}
        >
          <div style={{ width: `${totalWidth}px`, minWidth: '100%', position: 'relative' }}>
            {/* Track rows */}
            {sortedTracks.map((track) => (
              <TimelineTrack
                key={track.id}
                track={track}
                tracks={sortedTracks}
                clips={clipsByTrack.get(track.id) ?? []}
                zoom={zoom}
                height={getHeight(track.id)}
                onHeightChange={(h) => handleHeightChange(track.id, h)}
                laneHeight={getLaneHeight(track.id)}
                onLaneHeightChange={(h) => handleLaneHeightChange(track.id, h)}
              />
            ))}

            {/* Playhead vertical line in the track area */}
            <div
              className="absolute top-0 bottom-0 pointer-events-none z-50"
              style={{ left: `${playheadPx}px` }}
            >
              <div className="absolute top-0 bottom-0 left-0 w-px bg-red-500" />
            </div>

            {/* Section markers */}
            {markers.map((marker) => (
              <MarkerFlag
                key={marker.id}
                marker={marker}
                zoom={zoom}
                rulerHeight={RULER_HEIGHT}
                onUpdate={(patch) => updateMarker(marker.id, patch)}
                onDelete={() => removeMarker(marker.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
    </DragProvider>
  )
}

function MasterVolumeFooter(): JSX.Element {
  const masterVolume = useTransportStore((s) => s.masterVolume)
  const setMasterVolume = useTransportStore((s) => s.setMasterVolume)
  return (
    <div
      data-tour="master-volume"
      className="shrink-0 flex items-center gap-2 px-3 py-2 border-t-2 border-accent/30 bg-surface-panel"
      style={{ borderLeft: '3px solid #6366f1' }}
    >
      <span className="text-[9px] font-bold tracking-widest text-accent/80 uppercase shrink-0">Master</span>
      <input
        type="range"
        min={0} max={1} step={0.01}
        value={masterVolume}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          setMasterVolume(v)
          audioEngine.setMasterVolume(v)
        }}
        className="min-w-0 flex-1 h-1 appearance-none bg-surface-hover rounded-full cursor-ew-resize accent-accent"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      />
      <span className="text-[9px] font-mono tabular-nums text-gray-400 w-7 text-right shrink-0">
        {Math.round(masterVolume * 100)}
      </span>
    </div>
  )
}
