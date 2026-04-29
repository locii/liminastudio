import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type React from 'react'
import type { Marker } from '../../types'

interface Props {
  marker: Marker
  zoom: number
  rulerHeight: number
  onUpdate: (patch: Partial<Pick<Marker, 'name' | 'color' | 'time'>>) => void
  onDelete: () => void
}

export function MarkerFlag({ marker, zoom, rulerHeight, onUpdate, onDelete }: Props): JSX.Element {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(marker.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) setTimeout(() => inputRef.current?.select(), 0)
  }, [editing])

  useEffect(() => {
    if (!ctxMenu) return
    const handler = (): void => setCtxMenu(null)
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [ctxMenu])

  const commitRename = (): void => {
    const trimmed = draft.trim()
    if (trimmed) onUpdate({ name: trimmed })
    else setDraft(marker.name)
    setEditing(false)
  }

  const onLineMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startTime = marker.time
    const onMove = (me: MouseEvent): void => {
      const newTime = Math.max(0, Math.round((startTime + (me.clientX - startX) / zoom) * 100) / 100)
      onUpdate({ time: newTime })
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'ew-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const left = marker.time * zoom

  return (
    <div
      className="absolute top-0 bottom-0 pointer-events-none"
      style={{ left, zIndex: 45 }}
    >
      {/* Draggable full-height line */}
      <div
        className="absolute top-0 bottom-0 pointer-events-auto"
        style={{ left: -3, width: 7, cursor: 'ew-resize' }}
        onMouseDown={onLineMouseDown}
      >
        <div
          className="absolute top-0 bottom-0 left-1/2 w-px -translate-x-px"
          style={{ background: marker.color, opacity: 0.6 }}
        />
      </div>

      {/* Interactive label in the ruler band */}
      <div
        className="absolute left-1.5 pointer-events-auto"
        style={{ top: 2, height: rulerHeight - 4, zIndex: 50 }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setCtxMenu({ x: e.clientX, y: e.clientY })
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setDraft(marker.name)
          setEditing(true)
        }}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setDraft(marker.name); setEditing(false) }
              e.stopPropagation()
            }}
            onClick={(e) => e.stopPropagation()}
            className="text-[9px] font-bold px-1 rounded outline-none border-none h-full"
            style={{ background: marker.color + '33', color: marker.color, width: 72 }}
          />
        ) : (
          <span
            className="flex items-center h-full text-[9px] font-bold leading-none px-1.5 rounded select-none whitespace-nowrap"
            style={{ background: marker.color + '25', color: marker.color, cursor: 'text' }}
            title="Drag line to move · Double-click to rename · Right-click for options"
          >
            {marker.name}
          </span>
        )}
      </div>

      {ctxMenu && createPortal(
        <div
          style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999 }}
          className="bg-surface-panel border border-surface-border rounded shadow-xl py-1 min-w-32 text-xs"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-surface-hover text-gray-300 hover:text-white transition-colors"
            onClick={() => { setCtxMenu(null); setDraft(marker.name); setEditing(true) }}
          >
            Rename
          </button>
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-surface-hover text-red-400 hover:text-red-300 transition-colors"
            onClick={() => { setCtxMenu(null); onDelete() }}
          >
            Delete marker
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}
