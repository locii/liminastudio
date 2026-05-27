import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { useTransportStore } from '../../store/transportStore'
import { audioEngine } from '../../audio/audioEngine'
import { TrackHeader } from './TrackHeader'
import { TimelineTrack } from './TimelineTrack'
import { TimeRuler } from './TimeRuler'
import { DragProvider } from './DragContext'
import { SegmentLaneContent, SegmentLaneHeader } from './SegmentLane'
import type { Clip } from '../../types'
import { SEGMENT_COLORS } from '../../types'

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
  const segments = useSessionStore((s) => s.segments)
  const updateSegments = useSessionStore((s) => s.updateSegments)
  const addSegment = useSessionStore((s) => s.addSegment)
  const removeSegment = useSessionStore((s) => s.removeSegment)
  const segmentLaneHeight = useSessionStore((s) => s.segmentLaneHeight)
  const segmentLaneCollapsed = useSessionStore((s) => s.segmentLaneCollapsed)
  const setSegmentLaneHeight = useSessionStore((s) => s.setSegmentLaneHeight)
  const setSegmentLaneCollapsed = useSessionStore((s) => s.setSegmentLaneCollapsed)
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
  const segmentContentRef = useRef<HTMLDivElement>(null)
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
    if (segmentContentRef.current) {
      segmentContentRef.current.style.transform = `translateX(-${el.scrollLeft}px)`
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
    const clipEnd = clips.length > 0
      ? Math.max(...clips.map((c) => c.startTime + c.duration - c.trimStart - c.trimEnd))
      : 0
    const segEnd = segments.length > 0
      ? Math.max(...segments.map((s) => s.endTime))
      : 0
    const base = Math.max(clipEnd, segEnd)
    return base > 0 ? base + 60 : 120
  }, [clips, segments])

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

  // Wire zoom-by-factor callback — anchors on the center of the visible viewport
  useEffect(() => {
    if (!zoomByRef) return
    zoomByRef.current = (factor: number) => {
      const el = timelineRef.current
      if (!el) return
      const currentZoom = zoomRef.current
      const centerTime = (el.scrollLeft + el.clientWidth / 2) / currentZoom
      const newZoom = Math.min(2000, Math.max(0.5, currentZoom * factor))
      setZoom(newZoom)
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, centerTime * newZoom - el.clientWidth / 2)
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

  // ── Marquee (rubber-band) selection ─────────────────────────────────────────

  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const onTimelineMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const scrollEl = timelineRef.current
    if (!scrollEl) return

    const containerRect = scrollEl.getBoundingClientRect()
    const startX = e.clientX - containerRect.left + scrollEl.scrollLeft
    const startY = e.clientY - containerRect.top + scrollEl.scrollTop

    let hasDragged = false

    const onMove = (me: MouseEvent): void => {
      const curX = me.clientX - containerRect.left + scrollEl.scrollLeft
      const curY = me.clientY - containerRect.top + scrollEl.scrollTop

      if (!hasDragged) {
        if (Math.abs(curX - startX) > 4 || Math.abs(curY - startY) > 4) hasDragged = true
        else return
      }

      const mr = {
        x: Math.min(startX, curX),
        y: Math.min(startY, curY),
        w: Math.abs(curX - startX),
        h: Math.abs(curY - startY),
      }
      setMarqueeRect(mr)

      // Hit-test clips in real time
      let trackY = 0
      const hitIds: string[] = []
      for (const track of sortedTracks) {
        const h = getHeight(track.id)
        const lh = getLaneHeight(track.id)
        if (mr.y < trackY + h && mr.y + mr.h > trackY) {
          for (const clip of (clipsByTrack.get(track.id) ?? [])) {
            const effectiveDuration = clip.duration - clip.trimStart - clip.trimEnd
            const clipLeft = clip.startTime * zoomRef.current
            const clipRight = clipLeft + Math.max(4, effectiveDuration * zoomRef.current)
            if (mr.x < clipRight && mr.x + mr.w > clipLeft) hitIds.push(clip.id)
          }
        }
        trackY += h + lh
      }
      useSessionStore.setState({ selectedClipIds: hitIds })
    }

    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setMarqueeRect(null)
      if (!hasDragged) {
        // Plain click on empty space — deselect all
        useSessionStore.setState({ selectedClipIds: [], selectedClipId: null })
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [sortedTracks, getHeight, getLaneHeight, clipsByTrack])

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

  const handleAddSegment = useCallback((): void => {
    const sorted = [...segments].sort((a, b) => a.startTime - b.startTime)
    const lastEnd = sorted.length > 0 ? sorted[sorted.length - 1].endTime : 0
    const color = SEGMENT_COLORS[sorted.length % SEGMENT_COLORS.length]
    const duration = 100 / zoom
    addSegment({
      id: crypto.randomUUID(),
      name: `Section ${sorted.length + 1}`,
      startTime: lastEnd,
      endTime: lastEnd + duration,
      color,
    })
  }, [segments, addSegment])

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
        {/* Segment lane header */}
        <SegmentLaneHeader
          height={segmentLaneHeight}
          collapsed={segmentLaneCollapsed}
          segmentCount={segments.length}
          onHeightChange={setSegmentLaneHeight}
          onAdd={handleAddSegment}
        />
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
          className="flex-1 overflow-auto relative select-none"
          onScroll={onTimelineScroll}
          onMouseDown={onTimelineMouseDown}
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

            {/* Marquee selection rect */}
            {marqueeRect && (
              <div
                className="absolute pointer-events-none z-40 border border-indigo-400/70 bg-indigo-400/10 rounded-sm"
                style={{
                  left: marqueeRect.x,
                  top: marqueeRect.y,
                  width: marqueeRect.w,
                  height: marqueeRect.h,
                }}
              />
            )}

            {/* Playhead vertical line in the track area */}
            <div
              className="absolute top-0 bottom-0 pointer-events-none z-50"
              style={{ left: `${playheadPx}px` }}
            >
              <div className="absolute top-0 bottom-0 left-0 w-px bg-red-500" />
            </div>

          </div>
        </div>

        {/* Segment lane — pinned below scrollable tracks, always visible */}
        {!segmentLaneCollapsed && (
          <SegmentLaneContent
            contentRef={segmentContentRef}
            segments={segments}
            zoom={zoom}
            totalWidth={totalWidth}
            height={segmentLaneHeight}
            onUpdate={updateSegments}
            onDelete={removeSegment}
          />
        )}
      </div>
    </div>
    </DragProvider>
  )
}

function TrackViewButtons({ headerRef }: { headerRef: React.RefObject<HTMLDivElement> }): JSX.Element {
  const tracks = useSessionStore((s) => s.tracks)
  const laneHeights = useSessionStore((s) => s.laneHeights)
  const setTrackHeight = useSessionStore((s) => s.setTrackHeight)
  const segmentLaneCollapsed = useSessionStore((s) => s.segmentLaneCollapsed)
  const setSegmentLaneCollapsed = useSessionStore((s) => s.setSegmentLaneCollapsed)

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
      <div className="w-px bg-surface-border" />
      <button
        onClick={() => setSegmentLaneCollapsed(!segmentLaneCollapsed)}
        title={segmentLaneCollapsed ? 'Show segments' : 'Hide segments'}
        className="flex-1 flex items-center justify-center py-2 text-gray-500 hover:text-gray-200 hover:bg-surface-hover transition-colors gap-1.5"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="1" y="2" width="10" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
          <rect x="1" y="7" width="10" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.2" opacity={segmentLaneCollapsed ? '0.3' : '1'}/>
        </svg>
        <span className="text-[8px] font-bold tracking-wider uppercase">Seg</span>
      </button>
    </div>
  )
}

