import { useUIStore } from './uiStore'
import { saveThenOpen, replaceAndOpen, cancelOpen } from './openGuard'

/** Save / Replace / Cancel prompt shown when an "Open in…" would overwrite the
 *  existing contents of a Mix or Session. */
export function OverwriteModal(): JSX.Element | null {
  const target = useUIStore((s) => s.overwritePrompt)
  if (!target) return null

  const label = target === 'mix' ? 'Mix' : 'Session'

  return (
    <div className="flex fixed inset-0 z-[500] justify-center items-center bg-black/60" onClick={cancelOpen}>
      <div
        className="flex flex-col gap-4 p-5 w-96 rounded-lg border shadow-xl border-surface-border bg-surface-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-gray-100">Replace current {label}?</h2>
          <p className="text-[12px] leading-relaxed text-gray-400">
            Your {label} already has content. Save it first, replace it with the new
            tracks, or cancel.
          </p>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={cancelOpen}
            className="px-3 py-1.5 text-[11px] text-gray-300 rounded border transition-colors border-surface-border hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={saveThenOpen}
            className="px-3 py-1.5 text-[11px] text-gray-200 rounded border transition-colors border-surface-border hover:bg-surface-hover"
          >
            Save first
          </button>
          <button
            type="button"
            onClick={replaceAndOpen}
            className="px-3 py-1.5 text-[11px] font-medium text-white rounded transition-colors bg-accent hover:bg-accent-hover"
          >
            Replace
          </button>
        </div>
      </div>
    </div>
  )
}
