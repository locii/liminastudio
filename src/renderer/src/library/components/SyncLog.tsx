import { useEffect } from 'react'
import { useLibraryStore } from '../store/libraryStore'
import type { MfbRefreshItem } from '../store/libraryStore'

interface Props {
  onClose: () => void
  onSelectFile: (id: string) => void
}

const STATUS_ICON: Record<MfbRefreshItem['status'], JSX.Element> = {
  synced: (
    <svg className="w-3 h-3 text-green-500 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 6l3 3 5-5" />
    </svg>
  ),
  syncing: (
    <svg className="w-3 h-3 text-accent shrink-0 animate-spin" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6 1v2M6 9v2M1 6h2M9 6h2" strokeLinecap="round" />
      <path d="M2.5 2.5l1.4 1.4M8.1 8.1l1.4 1.4M9.5 2.5L8.1 3.9M3.9 8.1L2.5 9.5" strokeLinecap="round" opacity="0.4" />
    </svg>
  ),
  failed: (
    <svg className="w-3 h-3 text-red-400 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  ),
  queued: (
    <svg className="w-3 h-3 text-gray-600 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="4" />
    </svg>
  ),
}

export function SyncLog({ onClose, onSelectFile }: Props): JSX.Element {
  const { running, done, total, items } = useLibraryStore((s) => s.mfbRefresh)

  const synced = items.filter((i) => i.status === 'synced').length
  const failed = items.filter((i) => i.status === 'failed').length
  const queued = items.filter((i) => i.status === 'queued').length

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
        className="relative w-[480px] max-h-[70vh] flex flex-col rounded-lg border border-surface-border bg-surface-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-4 py-3 border-b border-surface-border shrink-0">
          <span className="text-[11px] font-semibold text-gray-300 uppercase tracking-wider">MFB Sync Log</span>
          <div className="flex gap-3 items-center">
            <span className="text-[10px] text-gray-600 tabular-nums">
              {running ? `${done}/${total} · ` : ''}{synced} synced{failed > 0 ? ` · ${failed} failed` : ''}{queued > 0 ? ` · ${queued} queued` : ''}
            </span>
            <button type="button" onClick={onClose} className="text-gray-500 transition-colors hover:text-gray-400">
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          <p className="px-4 pt-3 pb-1 text-[10px] text-gray-600 uppercase tracking-wider">
            Refreshing audio features &amp; tags — {total}
          </p>
          {items.map((it) => (
            <div
              key={it.fileId}
              className="flex items-center gap-2.5 px-4 py-1.5 hover:bg-surface-hover transition-colors cursor-pointer group"
              onClick={() => { onSelectFile(it.fileId); onClose() }}
            >
              {STATUS_ICON[it.status]}
              <div className="flex-1 min-w-0">
                <p className={`text-[11px] truncate ${it.status === 'queued' ? 'text-gray-600' : 'text-gray-300'}`}>{it.title}</p>
                {it.fileName !== it.title && <p className="text-[10px] text-gray-600 truncate">{it.fileName}</p>}
              </div>
              <span className="text-[9px] uppercase tracking-wider text-gray-600 opacity-0 group-hover:opacity-100 shrink-0">View</span>
            </div>
          ))}
          {items.length === 0 && (
            <p className="px-4 py-6 text-[11px] text-gray-500 text-center">No sync activity — nothing matched to refresh.</p>
          )}
          <div className="h-3" />
        </div>
      </div>
    </div>
  )
}
