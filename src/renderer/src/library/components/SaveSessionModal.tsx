import { useState } from 'react'
import { useLibraryStore } from '../store/libraryStore'

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Shown when the user clicks the record button mid-recording. Names and saves the
 * in-progress session (or discards it), making it clear the recording is being
 * captured. The parent owns stop/discard so it can reveal the saved session.
 */
export function SaveSessionModal({ onSave, onCancel, onDiscard }: {
  onSave: (name: string) => void
  onCancel: () => void
  onDiscard: () => void
}): JSX.Element {
  const recording = useLibraryStore((s) => s.recording)
  const [name, setName] = useState('')
  const elapsed = recording ? Date.now() - recording.startedAt : 0
  const trackCount = recording?.trackCount ?? 0

  const canSave = trackCount > 0
  const save = (): void => { if (canSave) onSave(name.trim()) }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} />
      <div className="relative flex flex-col w-full max-w-sm gap-4 p-5 shadow-2xl bg-surface-panel rounded-xl border border-surface-border">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          <h2 className="text-sm font-semibold text-white">Save session</h2>
        </div>

        <p className="text-[11px] text-gray-500 leading-relaxed">
          You recorded a blow-by-blow of this session — the tracklist and the changes you made.
          Give it a name and it'll appear in the <span className="text-gray-300">Sessions</span> tab,
          ready to replay or export.
        </p>

        <div className="flex items-center gap-3 px-3 py-2 rounded border border-surface-border bg-surface-hover text-[11px]">
          <span className="text-gray-300 tabular-nums">{fmtElapsed(elapsed)}</span>
          <span className="text-gray-700">·</span>
          <span className="text-gray-400">{trackCount} track{trackCount === 1 ? '' : 's'}</span>
        </div>

        {!canSave && (
          <p className="text-[11px] text-yellow-500/80 leading-relaxed">
            No tracks have played yet — keep recording and play at least one track before saving.
          </p>
        )}

        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') onCancel() }}
          placeholder="Session name…"
          className="w-full px-3 py-2 rounded border bg-surface-base border-surface-border text-[12px] text-gray-200 placeholder-gray-700 outline-none focus:border-accent/50"
        />

        <div className="flex items-center justify-between">
          <button type="button" onClick={onDiscard}
            className="text-[11px] text-gray-600 hover:text-red-400 transition-colors">
            Discard
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onCancel}
              className="px-3 py-1.5 text-[11px] text-gray-400 rounded border border-surface-border hover:text-gray-200 hover:bg-surface-hover transition-colors">
              Keep recording
            </button>
            <button type="button" onClick={save} disabled={!canSave}
              className="px-3 py-1.5 text-[11px] font-medium text-white rounded bg-accent hover:bg-accent/80 transition-colors disabled:opacity-40 disabled:hover:bg-accent">
              Save session
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
