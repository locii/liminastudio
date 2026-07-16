import { useUIStore } from './uiStore'
import { confirmPendingNav, cancelPendingNav } from './navigate'

/** Shown when navigating away from a view that's actively playing audio. */
export function NavConfirmModal(): JSX.Element | null {
  const open = useUIStore((s) => s.navConfirmOpen)
  if (!open) return null

  return (
    <div
      className="flex fixed inset-0 z-[500] justify-center items-center bg-black/60"
      onClick={cancelPendingNav}
    >
      <div
        className="flex flex-col gap-4 p-5 w-80 rounded-lg border shadow-xl border-surface-border bg-surface-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-gray-100">Stop playback?</h2>
          <p className="text-[12px] leading-relaxed text-gray-400">
            Leaving this view will stop what’s currently playing here. Continue?
          </p>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={cancelPendingNav}
            className="px-3 py-1.5 text-[11px] text-gray-300 rounded border transition-colors border-surface-border hover:bg-surface-hover"
          >
            Stay here
          </button>
          <button
            type="button"
            onClick={confirmPendingNav}
            className="px-3 py-1.5 text-[11px] font-medium text-white rounded transition-colors bg-accent hover:bg-accent-hover"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
