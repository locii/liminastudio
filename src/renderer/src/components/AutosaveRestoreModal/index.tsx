interface Props {
  savedAt: string
  onRestore: () => void
  onDiscard: () => void
}

function formatAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins === 1) return '1 minute ago'
  if (mins < 60) return `${mins} minutes ago`
  const hrs = Math.round(mins / 60)
  return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`
}

export function AutosaveRestoreModal({ savedAt, onRestore, onDiscard }: Props): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-panel border border-surface-border rounded-lg shadow-2xl w-96 p-6 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <div>
            <h2 className="text-sm font-semibold text-gray-200">Unsaved session found</h2>
            <p className="text-xs text-gray-400 mt-1">
              An auto-saved session from <span className="text-gray-300">{formatAge(savedAt)}</span> was found.
              This may be from a previous crash or unexpected close.
            </p>
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onDiscard}
            className="px-3 h-7 text-xs text-gray-400 hover:text-gray-200 hover:bg-surface-hover rounded transition-colors"
          >
            Discard
          </button>
          <button
            onClick={onRestore}
            className="px-4 h-7 text-xs bg-accent hover:bg-accent-hover text-white rounded transition-colors font-medium"
          >
            Restore Session
          </button>
        </div>
      </div>
    </div>
  )
}
