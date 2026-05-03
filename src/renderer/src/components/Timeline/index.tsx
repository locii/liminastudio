import { useCallback, useEffect, useMemo, useRef } from 'react'
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
const TRACK_HEIGHT = 100
const MIN_TRACK_HEIGHT = 48
const MAX_TRACK_HEIGHT = 240
const LANE_HEIGHT = 48
const MIN_LANE_HEIGHT = 32
const MAX_LANE_HEIGHT = 160

interface Props {
  fitToWindowRef?: React.MutableRefObject<(() => void) | null>
  scrollToPlayheadRef?: React.MutableRefObject<(() => void) | null>
  focusPlayheadRef?: React.MutableRefObject<(() => void) | null>
  zoomByRef?: React.MutableRefObject<((factor: number) => void) | null>
}

export function Timeline({ fitToWindowRef, scrollToPlayheadRef, focusPlayheadRef, zoomByRef }: Props = {}): JSX.Element {
  const tracks = useSessionStore((s) => s.tracks)
  const clips = useSessionStore((s) => s.clips)
  const markers = useSessionStore((s) => s.markers)
  const addMarker = useSessionStore((s) => s.addMarker)
  const updateMarker = useSessionStore((s) => s.updateMarker)
  const removeMarker = useSessionStore((s) => s.removeMarker)
  const trackHeights = useSessionStore((s) => s.trackHeights)
  const laneHeights = useSessionStore((s) => s.laneHeights)
  const setTrackHeight = useSessionStore((s) => s.setTrackHeight)
  const setLaneHeight = useSessionStore((s) => s.setLaneHeight)
  const zoom = useTransportStore((s) => s.zoom)
  const setZoom = useTransportStore((s) => s.setZoom)
  const playhead = useTransportStore((s) => s.playhead)
  const setScrollX = useTransportStore((s) => s.setScrollX)

  const getHeight = useCallback((id: string) => trackHeights[id] ?? TRACK_HEIGHT, [trackHeights])
  const handleHeightChange = useCallback((id: string, h: number) => {
    setTrackHeight(id, Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, h)))
  }, [setTrackHeight])

  const getLaneHeight = useCallback((id: string) => laneHeights[id] ?? LANE_HEIGHT, [laneHeights])
  const handleLaneHeightChange = useCallback((id: string, h: number) => {
    setLaneHeight(id, Math.max(MIN_LANE_HEIGHT, Math.min(MAX_LANE_HEIGHT, h)))
  }, [setLaneHeight])

  const timelineRef = useRef<HTMLDivElement>(null)
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const rulerContentRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoom)
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  // Scroll to centre on playhead only when it lands outside the visible area.
  // This way ruler clicks keep the view still; prev/next jumps to off-screen
  // clips still bring them into view.
  const prevPlayheadRef = useRef(playhead)
  useEffect(() => {
    const prev = prevPlayheadRef.current
    prevPlayheadRef.current = playhead
    if (Math.abs(playhead - prev) < 1) return
    const el = timelineRef.current
    if (!el) return
    const playheadPx = playhead * zoomRef.current
    const { scrollLeft, clientWidth } = el
    if (playheadPx >= scrollLeft && playheadPx <= scrollLeft + clientWidth) return
    el.scrollLeft = Math.max(0, playheadPx - clientWidth / 2)
  }, [playhead])

  // Track the center time continuously so resize can restore it.
  const centerTimeRef = useRef(0)

  // Pinch-to-zoom — attached to the whole right panel (ruler + tracks) so it
  // works regardless of where the user pinches. Must be non-passive to preventDefault.
  useEffect(() => {
    const panel = rightPanelRef.current
    if (!panel) return
    const handler = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const scrollEl = timelineRef.current
      if (!scrollEl) return
      const currentZoom = zoomRef.current
      // exp() gives smooth, proportional feel regardless of event rate
      const factor = Math.exp(-e.deltaY * 0.008)
      const newZoom = Math.min(2000, Math.max(0.5, currentZoom * factor))
      // Keep the time under the cursor fixed while zooming
      const rect = scrollEl.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const timeAtCursor = (scrollEl.scrollLeft + mouseX) / currentZoom
      setZoom(newZoom)
      requestAnimationFrame(() => {
        scrollEl.scrollLeft = Math.max(0, timeAtCursor * newZoom - mouseX)
      })
    }
    panel.addEventListener('wheel', handler, { passive: false })
    return () => panel.removeEventListener('wheel', handler)
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

  // Wire scroll-to-playhead callback
  useEffect(() => {
    if (!scrollToPlayheadRef) return
    scrollToPlayheadRef.current = () => {
      const el = timelineRef.current
      if (!el) return
      const pos = useTransportStore.getState().playhead
      el.scrollLeft = Math.max(0, pos * zoomRef.current - el.clientWidth / 2)
    }
  }, [scrollToPlayheadRef])

  // Wire focus-playhead callback — zoom to 30px/s and centre on playhead
  useEffect(() => {
    if (!focusPlayheadRef) return
    focusPlayheadRef.current = () => {
      const el = timelineRef.current
      if (!el) return
      const FOCUS_ZOOM = 30
      const pos = useTransportStore.getState().playhead
      setZoom(FOCUS_ZOOM)
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, pos * FOCUS_ZOOM - el.clientWidth / 2)
      })
    }
  }, [focusPlayheadRef, setZoom])

  // Wire zoom-by-factor callback — zooms around the playhead
  useEffect(() => {
    if (!zoomByRef) return
    zoomByRef.current = (factor: number) => {
      const el = timelineRef.current
      if (!el) return
      const pos = useTransportStore.getState().playhead
      const newZoom = Math.min(200, Math.max(0.5, zoomRef.current * factor))
      setZoom(newZoom)
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, pos * newZoom - el.clientWidth / 2)
      })
    }
  }, [zoomByRef, setZoom])

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
        {/* Track view controls — fit / reset row heights */}
        <TrackViewButtons headerRef={headerRef} />
      </div>

      {/* Right: ruler strip + scrollable tracks */}
      <div ref={rightPanelRef} className="flex-1 flex flex-col overflow-hidden">
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

function TrackViewButtons({ headerRef }: { headerRef: React.RefObject<HTMLDivElement> }): JSX.Element {
  const tracks = useSessionStore((s) => s.tracks)
  const laneHeights = useSessionStore((s) => s.laneHeights)
  const setTrackHeight = useSessionStore((s) => s.setTrackHeight)

  const handleFit = useCallback(() => {
    if (!headerRef.current || tracks.length === 0) return
    const totalLaneH = tracks.reduce((sum, t) => sum + (laneHeights[t.id] ?? 0), 0)
    const availH = headerRef.current.clientHeight - totalLaneH
    const targetH = Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, Math.floor(availH / tracks.length)))
    tracks.forEach((t) => setTrackHeight(t.id, targetH))
  }, [headerRef, tracks, laneHeights, setTrackHeight])

  const handleReset = useCallback(() => {
    tracks.forEach((t) => setTrackHeight(t.id, TRACK_HEIGHT))
  }, [tracks, setTrackHeight])

  return (
    <div className="shrink-0 flex border-t border-surface-border bg-surface-panel">
      <button
        onClick={handleFit}
        title="Expand tracks to fill view"
        className="flex-1 flex items-center justify-center py-2 text-gray-500 hover:text-gray-200 hover:bg-surface-hover transition-colors gap-1.5"
      >
        {/* Vertical expand: line with arrows pointing away from centre */}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <line x1="6" y1="1" x2="6" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          <polyline points="3.5,4 6,1 8.5,4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          <polyline points="3.5,8 6,11 8.5,8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="text-[8px] font-bold tracking-wider uppercase">Fit</span>
      </button>
      <div className="w-px bg-surface-border" />
      <button
        onClick={handleReset}
        title="Reset all tracks to 100px"
        className="flex-1 flex items-center justify-center py-2 text-gray-500 hover:text-gray-200 hover:bg-surface-hover transition-colors gap-1.5"
      >
        {/* Three equal horizontal bars = default/equal row heights */}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <line x1="1" y1="3" x2="11" y2="3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          <line x1="1" y1="9" x2="11" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        <span className="text-[8px] font-bold tracking-wider uppercase">Rst</span>
      </button>
    </div>
  )
}

