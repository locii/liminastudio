import { useCallback, useRef, useState } from 'react'
import type React from 'react'
import type { Segment } from '../../types'
import { SEGMENT_COLORS } from '../../types'

const EDGE_HIT = 8
const MIN_DURATION = 1  // seconds

type SegmentUpdate = { id: string; patch: Partial<Pick<Segment, 'startTime' | 'endTime' | 'name' | 'color'>> }

interface ContentProps {
  contentRef: React.RefObject<HTMLDivElement>
  segments: Segment[]
  zoom: number
  totalWidth: number
  height: number
  onUpdate: (updates: SegmentUpdate[]) => void
  onDelete: (id: string) => void
}

export function SegmentLaneContent({
  contentRef, segments, zoom, totalWidth, height, onUpdate, onDelete,
}: ContentProps): JSX.Element {
  const segmentsRef = useRef(segments)
  segmentsRef.current = segments

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  const commitRename = useCallback((id: string, name: string): void => {
    const trimmed = name.trim()
    if (trimmed) onUpdate([{ id, patch: { name: trimmed } }])
    setRenamingId(null)
  }, [onUpdate])

  const handleEdgeDown = useCallback((
    e: React.MouseEvent,
    id: string,
    edge: 'start' | 'end',
    origTime: number,
  ): void => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX

    const onMove = (me: MouseEvent): void => {
      const sorted = [...segmentsRef.current].sort((a, b) => a.startTime - b.startTime)
      const idx = sorted.findIndex((s) => s.id === id)
      if (idx < 0) return
      const seg = sorted[idx]
      const dt = (me.clientX - startX) / zoom

      if (edge === 'end') {
        const rightNeighbor = sorted[idx + 1] ?? null
        const max = rightNeighbor ? rightNeighbor.endTime - MIN_DURATION : Infinity
        const newTime = Math.max(seg.startTime + MIN_DURATION, Math.min(origTime + dt, max))
        const updates: SegmentUpdate[] = [{ id, patch: { endTime: newTime } }]
        if (rightNeighbor) updates.push({ id: rightNeighbor.id, patch: { startTime: newTime } })
        onUpdate(updates)
      } else {
        const leftNeighbor = sorted[idx - 1] ?? null
        const min = leftNeighbor ? leftNeighbor.startTime + MIN_DURATION : 0
        const newTime = Math.min(seg.endTime - MIN_DURATION, Math.max(origTime + dt, min))
        const updates: SegmentUpdate[] = [{ id, patch: { startTime: newTime } }]
        if (leftNeighbor) updates.push({ id: leftNeighbor.id, patch: { endTime: newTime } })
        onUpdate(updates)
      }
    }

    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [zoom, onUpdate])

  return (
    <div
      className="overflow-hidden relative border-t shrink-0 border-surface-border bg-surface-base"
      style={{ height }}
    >
      <div
        ref={contentRef}
        className="absolute top-0 left-0 h-full will-change-transform"
        style={{ width: `${totalWidth}px`, minWidth: '100%' }}
      >
        {segments.map((seg) => {
          const x = seg.startTime * zoom
          const w = Math.max(2, (seg.endTime - seg.startTime) * zoom)
          const isRenaming = renamingId === seg.id
          return (
            <div
              key={seg.id}
              className="overflow-hidden absolute top-0 bottom-0 select-none group/seg"
              style={{
                left: x,
                width: w,
                backgroundColor: seg.color + '26',
                border: `1px solid ${seg.color}55`,
              }}
            >
              {/* Left edge */}
              <div
                className="absolute top-0 bottom-0 left-0 z-10 cursor-col-resize"
                style={{ width: EDGE_HIT }}
                onMouseDown={(e) => handleEdgeDown(e, seg.id, 'start', seg.startTime)}
              />

              {/* Label / rename input */}
              {isRenaming ? (
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => commitRename(seg.id, draftName)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(seg.id, draftName)
                    if (e.key === 'Escape') setRenamingId(null)
                    e.stopPropagation()
                  }}
                  className="absolute inset-0 bg-black/60 text-[10px] font-medium px-2.5 outline-none border-none w-full"
                  style={{ color: seg.color }}
                />
              ) : (
                <span
                  className="absolute inset-0 flex items-center px-2.5 text-[10px] font-medium truncate cursor-text"
                  style={{ color: seg.color, paddingLeft: EDGE_HIT + 4, paddingRight: EDGE_HIT + 20 }}
                  onDoubleClick={() => { setDraftName(seg.name); setRenamingId(seg.id) }}
                />
              )}

              {/* Name overlay (not interactive, pointer-events-none) */}
              {!isRenaming && (
                <span
                  className="absolute inset-0 flex items-center text-[10px] font-medium truncate pointer-events-none"
                  style={{ color: seg.color, paddingLeft: EDGE_HIT + 4, paddingRight: EDGE_HIT + 20 }}
                >
                  {seg.name}
                </span>
              )}

              {/* Hover controls — colour swatch + delete */}
              {!isRenaming && (
                <div className="flex absolute right-1 top-1/2 z-20 gap-1 items-center opacity-0 transition-opacity -translate-y-1/2 group-hover/seg:opacity-100">
                  <label
                    className="w-3 h-3 rounded-sm transition-all cursor-pointer hover:ring-1 hover:ring-white/40 shrink-0"
                    style={{ background: seg.color }}
                    title="Change colour"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="color"
                      className="sr-only"
                      value={seg.color}
                      onChange={(e) => onUpdate([{ id: seg.id, patch: { color: e.target.value } }])}
                    />
                  </label>
                  <button
                    className="flex justify-center items-center w-4 h-4 rounded-full hover:bg-white/20"
                    style={{ color: seg.color }}
                    onClick={(e) => { e.stopPropagation(); onDelete(seg.id) }}
                    title="Delete segment"
                  >
                    <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M2 2l6 6M8 2l-6 6" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Right edge */}
              <div
                className="absolute top-0 right-0 bottom-0 z-10 cursor-col-resize"
                style={{ width: EDGE_HIT }}
                onMouseDown={(e) => handleEdgeDown(e, seg.id, 'end', seg.endTime)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

const MIN_LANE_H = 20
const MAX_LANE_H = 120
const COLLAPSED_H = 20

interface HeaderProps {
  height: number
  collapsed: boolean
  segmentCount: number
  onHeightChange: (h: number) => void
  onAdd: () => void
}

export function SegmentLaneHeader({ height, collapsed, segmentCount, onHeightChange, onAdd }: HeaderProps): JSX.Element {
  const onResizeDown = useCallback((e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = height
    const onMove = (me: MouseEvent): void => {
      onHeightChange(Math.max(MIN_LANE_H, Math.min(MAX_LANE_H, startH + me.clientY - startY)))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'ns-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [height, onHeightChange])

  const displayH = collapsed ? COLLAPSED_H : height

  return (
    <div
      className="shrink-0 border-t border-surface-border bg-surface-panel relative flex items-center justify-between px-2.5"
      style={{ height: displayH }}
    >
      {!collapsed && (
        <div
          className="absolute top-0 right-0 left-0 h-1 transition-colors cursor-ns-resize hover:bg-white/10"
          onMouseDown={onResizeDown}
        />
      )}
      <span className="text-[9px] uppercase tracking-widest text-gray-600 select-none">
        Segments{segmentCount > 0 ? ` · ${segmentCount}` : ''}
      </span>
      {!collapsed && (
        <button
          onClick={onAdd}
          className="text-gray-600 transition-colors hover:text-gray-300"
          title="Add segment"
        >
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M6 2v8M2 6h8" />
          </svg>
        </button>
      )}
    </div>
  )
}
