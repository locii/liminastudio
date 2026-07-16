import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useSessionStore } from '../../store/sessionStore'
import { audioEngine } from '../../audio/audioEngine'
import { nanoid } from '../../utils/nanoid'
import type { Clip } from '../../types'

interface Props {
  clips: Clip[]
  zoom: number
  color: string
  height: number
  onHeightChange: (h: number) => void
  trackHeight?: number
  onTrackHeightChange?: (h: number) => void
}

interface CtxMenu {
  x: number
  y: number
  clipId: string
  nodeId: string
}

const MIN_HEIGHT = 32
const MAX_HEIGHT = 160

export function AutomationLane({ clips, zoom, color, height, onHeightChange, trackHeight, onTrackHeightChange }: Props): JSX.Element {
  const updateClip = useSessionStore((s) => s.updateClip)
  const updateClipSilent = useSessionStore((s) => s.updateClipSilent)
  const pushHistorySnapshot = useSessionStore((s) => s.pushHistorySnapshot)
  const dragRef = useRef<{
    clipId: string; nodeId: string
    startX: number; startY: number
    startTime: number; startValue: number
    effectiveDuration: number
  } | null>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const [activeNode, setActiveNode] = useState<{ clipId: string; nodeId: string } | null>(null)

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return
    const handler = (): void => setCtxMenu(null)
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [ctxMenu])

  const effDur = (clip: Clip): number => clip.duration - clip.trimStart - clip.trimEnd
  const xOf = (clip: Clip, t: number): number => (clip.startTime + t) * zoom
  const yOf = (v: number): number => Math.round((1 - v / 2) * (height - 2) + 1)

  const linePoints = (clip: Clip): string => {
    const eff = effDur(clip)
    const sorted = [...(clip.automation ?? [])].sort((a, b) => a.time - b.time)
    const x0 = clip.startTime * zoom
    const x1 = x0 + eff * zoom
    if (sorted.length === 0) return `${x0},${yOf(1)} ${x1},${yOf(1)}`
    const pts = [`${x0},${yOf(sorted[0].value)}`]
    for (const pt of sorted) pts.push(`${xOf(clip, pt.time)},${yOf(pt.value)}`)
    pts.push(`${x1},${yOf(sorted[sorted.length - 1].value)}`)
    return pts.join(' ')
  }

  const findClipAt = (x: number): Clip | null => {
    const t = x / zoom
    return clips.find((c) => t >= c.startTime && t <= c.startTime + effDur(c)) ?? null
  }

  const deleteNode = (clipId: string, nodeId: string): void => {
    const clip = clips.find((c) => c.id === clipId)
    if (!clip) return
    updateClip(clipId, { automation: (clip.automation ?? []).filter((pt) => pt.id !== nodeId) })
    const { clips: c, tracks: t } = useSessionStore.getState()
    audioEngine.softReload(c, t)
  }

  const onSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const clip = findClipAt(mx)
    if (!clip) return

    const automation = clip.automation ?? []
    const eff = effDur(clip)

    const hit = automation.find((pt) => {
      const dx = xOf(clip, pt.time) - mx
      const dy = yOf(pt.value) - my
      return Math.sqrt(dx * dx + dy * dy) <= 8
    })

    if (hit) {
      setActiveNode({ clipId: clip.id, nodeId: hit.id })
      // Capture state before drag so we push a single undo entry on mouseup
      const preDragSnap = {
        tracks: useSessionStore.getState().tracks,
        clips: useSessionStore.getState().clips,
      }
      dragRef.current = {
        clipId: clip.id, nodeId: hit.id,
        startX: e.clientX, startY: e.clientY,
        startTime: hit.time, startValue: hit.value,
        effectiveDuration: eff,
      }
      const onMove = (me: MouseEvent): void => {
        if (!dragRef.current) return
        const { clipId, nodeId, startX, startY, startTime, startValue, effectiveDuration } = dragRef.current
        const current = useSessionStore.getState().clips.find((c) => c.id === clipId)
        if (!current) return
        const newTime = Math.max(0, Math.min(startTime + (me.clientX - startX) / zoom, effectiveDuration))
        const newValue = Math.max(0, Math.min(startValue - (me.clientY - startY) * 2 / height, 2))
        updateClipSilent(clipId, {
          automation: (current.automation ?? []).map((pt) =>
            pt.id === nodeId
              ? { ...pt, time: Math.round(newTime * 100) / 100, value: Math.round(newValue * 100) / 100 }
              : pt
          ),
        })
      }
      const onUp = (): void => {
        dragRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        pushHistorySnapshot(preDragSnap)
        const { clips: c, tracks: t } = useSessionStore.getState()
        audioEngine.softReload(c, t)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    } else {
      const newId = nanoid()
      const time = Math.round(Math.max(0, Math.min((mx / zoom) - clip.startTime, eff)) * 100) / 100
      const value = Math.round(Math.max(0, Math.min(2 * (1 - (my - 1) / (height - 2)), 2)) * 100) / 100
      updateClip(clip.id, { automation: [...automation, { id: newId, time, value }] })
      setActiveNode({ clipId: clip.id, nodeId: newId })
      const { clips: c, tracks: t } = useSessionStore.getState()
      audioEngine.softReload(c, t)
    }
  }

  const onNodeContextMenu = (e: React.MouseEvent, clipId: string, nodeId: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, clipId, nodeId })
  }

  const onResizeMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const startH = height
    const startTH = trackHeight ?? 0
    const onMove = (me: MouseEvent): void => {
      const dy = me.clientY - startY
      onHeightChange(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startH + dy)))
      if (onTrackHeightChange) onTrackHeightChange(startTH + dy)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'ns-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <>
    <div
      className="relative border-b border-surface-border"
      style={{ height, background: '#0a0a0a' }}
    >
      <svg
        className="absolute inset-0"
        width="100%"
        height={height}
        style={{ cursor: 'crosshair', overflow: 'visible' }}
        onMouseDown={onSvgMouseDown}
      >
        {/* Unity gain guide at 100% */}
        <line x1="0" x2="100%" y1={yOf(1)} y2={yOf(1)} stroke="#333" strokeWidth={1} strokeDasharray="4 4" />

        {clips.map((clip) => (
          <polyline
            key={clip.id}
            points={linePoints(clip)}
            fill="none"
            stroke={color + '99'}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        ))}
        {clips.flatMap((clip) =>
          (clip.automation ?? []).map((pt) => {
            const isActive = activeNode?.clipId === clip.id && activeNode?.nodeId === pt.id
            const cx = xOf(clip, pt.time)
            const cy = yOf(pt.value)
            return (
              <g key={pt.id}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={isActive ? 5 : 4}
                  fill={color}
                  stroke={isActive ? '#fff' : 'rgba(255,255,255,0.8)'}
                  strokeWidth={isActive ? 2 : 1.5}
                  style={{ cursor: 'grab' }}
                  onContextMenu={(e) => onNodeContextMenu(e, clip.id, pt.id)}
                />
                {isActive && (() => {
                  const labelY = cy > 20 ? cy - 10 : cy + 20
                  const label = `${Math.round(pt.value * 100)}%`
                  return (
                    <g pointerEvents="none">
                      <rect x={cx - 14} y={labelY - 8} width={28} height={14} rx={3} fill="#1a1a1a" stroke="#3f3f46" strokeWidth={1} />
                      <text x={cx} y={labelY} textAnchor="middle" dominantBaseline="middle" fill="#e5e7eb" fontSize={9} fontFamily="monospace">
                        {label}
                      </text>
                    </g>
                  )
                })()}
              </g>
            )
          })
        )}
      </svg>

      <span className="absolute left-2 top-1 text-[9px] text-gray-700 uppercase tracking-wider pointer-events-none select-none">
        vol
      </span>

      <div
        className="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-white/20 transition-colors z-10"
        onMouseDown={onResizeMouseDown}
      />
    </div>

    {ctxMenu && createPortal(
      <div
        style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999 }}
        className="bg-surface-panel border border-surface-border rounded shadow-xl py-1 min-w-32 text-xs"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          className="w-full text-left px-3 py-1.5 hover:bg-surface-hover text-red-400 hover:text-red-300 transition-colors"
          onClick={() => { deleteNode(ctxMenu.clipId, ctxMenu.nodeId); setCtxMenu(null) }}
        >
          Delete point
        </button>
      </div>,
      document.body
    )}
    </>
  )
}
