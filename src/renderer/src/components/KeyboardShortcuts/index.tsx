import { useEffect } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  open: boolean
  onClose: () => void
}

const SHORTCUTS = [
  { group: 'Transport' },
  { key: 'Space', desc: 'Play / Stop' },
  { key: 'R', desc: 'Return to start' },
  { key: 'L', desc: 'Toggle loop' },
  { group: 'Timeline' },
  { key: '+  /  −', desc: 'Zoom in / out' },
  { key: 'Double-click ruler', desc: 'Add section marker' },
  { group: 'Clips' },
  { key: '⌘C', desc: 'Copy selected clip' },
  { key: '⌘X', desc: 'Cut selected clip' },
  { key: '⌘V', desc: 'Paste clip at playhead' },
  { key: 'S', desc: 'Split clip at playhead' },
  { key: 'Delete / ⌫', desc: 'Remove selected clip' },
  { key: 'Escape', desc: 'Deselect clip' },
  { key: 'Right-click clip', desc: 'Split / Duplicate / Show in Folder / Remove' },
  { key: 'Right-click auto node', desc: 'Delete automation point' },
  { group: 'Session' },
  { key: '⌘S', desc: 'Save' },
  { key: '⌘⇧S', desc: 'Save As' },
  { key: '⌘O', desc: 'Open session' },
  { key: '⌘E', desc: 'Export mix' },
  { key: '⌘Z', desc: 'Undo' },
  { key: '⌘⇧Z', desc: 'Redo' },
  { key: '⌘T', desc: 'Add track' },
  { key: '?', desc: 'This cheatsheet' },
]

export function KeyboardShortcuts({ open, onClose }: Props): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onMouseDown={onClose}
    >
      <div
        className="bg-surface-panel border border-surface-border rounded-lg shadow-2xl w-80 max-h-[80vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
          <span className="text-sm font-semibold text-gray-200">Keyboard Shortcuts</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 transition-colors text-lg leading-none">×</button>
        </div>
        <div className="px-4 py-3 space-y-0.5">
          {SHORTCUTS.map((item, i) =>
            'group' in item ? (
              <div key={i} className="pt-3 pb-1 first:pt-0">
                <span className="text-[9px] font-bold tracking-widest text-gray-600 uppercase">{item.group}</span>
              </div>
            ) : (
              <div key={i} className="flex items-center justify-between py-1">
                <span className="text-[11px] text-gray-400">{item.desc}</span>
                <kbd className="text-[10px] font-mono bg-surface-hover text-gray-300 px-1.5 py-0.5 rounded border border-surface-border ml-3 shrink-0 whitespace-nowrap">
                  {item.key}
                </kbd>
              </div>
            )
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
