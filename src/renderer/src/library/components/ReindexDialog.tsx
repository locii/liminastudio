import { useEffect, useState } from 'react'

type Mode = 'unmatched' | 'all'

interface Props {
  onClose: () => void
  onConfirm: (mode: Mode) => void
}

export function ReindexDialog({ onClose, onConfirm }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>('unmatched')

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="flex fixed inset-0 z-50 justify-center items-center bg-black/60"
      onMouseDown={onClose}
    >
      <div
        className="relative w-[440px] flex flex-col rounded-lg border border-surface-border bg-surface-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center px-4 py-3 border-b border-surface-border shrink-0">
          <span className="text-[11px] font-semibold text-gray-300 uppercase tracking-wider">Re-index catalogue</span>
          <button type="button" onClick={onClose} className="text-gray-500 transition-colors hover:text-gray-400">
            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-3 px-4 py-4">
          <Option
            checked={mode === 'unmatched'}
            onSelect={() => setMode('unmatched')}
            title="Only tracks without matches"
            body="Run the matcher against files that have never been matched. Existing matches and applied metadata stay as-is."
          />
          <Option
            checked={mode === 'all'}
            onSelect={() => setMode('all')}
            title="Entire catalogue (clears current matches)"
            body="Removes all current matches and resets synced fields (title, tags, notes, phase) before re-running the matcher. Restore Backup is available from this menu if anything goes wrong."
          />
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-surface-border">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] text-gray-400 rounded hover:text-gray-200 hover:bg-surface-hover transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(mode)}
            className="px-3 py-1.5 text-[11px] text-gray-100 rounded bg-accent/80 hover:bg-accent transition-colors"
          >
            Re-index
          </button>
        </div>
      </div>
    </div>
  )
}

function Option({
  checked, onSelect, title, body,
}: { checked: boolean; onSelect: () => void; title: string; body: string }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex gap-3 items-start p-3 text-left rounded border transition-colors ${
        checked
          ? 'border-accent/60 bg-accent/5'
          : 'border-surface-border hover:border-gray-600 hover:bg-surface-hover'
      }`}
    >
      <span
        className={`mt-0.5 flex w-3.5 h-3.5 rounded-full border shrink-0 items-center justify-center ${
          checked ? 'border-accent' : 'border-gray-600'
        }`}
      >
        {checked && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
      </span>
      <span className="flex flex-col gap-1 min-w-0">
        <span className="text-[11px] text-gray-200">{title}</span>
        <span className="text-[10px] text-gray-500 leading-relaxed">{body}</span>
      </span>
    </button>
  )
}
