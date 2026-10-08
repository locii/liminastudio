import { useCallback, useEffect, useState } from 'react'
import { useDialog } from './useDialog'

export interface ReadyCheckItem {
  filePath: string
  label: string
}

type Status = 'ok' | 'cloud' | 'empty' | 'missing'

interface Props {
  open: boolean
  onClose: () => void
  /** What's being checked, e.g. "this mix" / "this session's queue". */
  subject: string
  items: ReadyCheckItem[]
}

const GROUPS: { status: Exclude<Status, 'ok'>; title: string; help: string }[] = [
  {
    status: 'cloud',
    title: 'Online-only',
    help: "In your cloud folder but not downloaded to this Mac. Limina can download them now.",
  },
  {
    status: 'empty',
    title: 'Empty (0 bytes)',
    help: 'Placeholder files with no audio. Re-download them in Dropbox (Make available offline) or replace them.',
  },
  {
    status: 'missing',
    title: 'Missing',
    help: 'Not found at their saved location. Relink them, or they will be skipped.',
  },
]

/**
 * Pre-session check: confirms every file a mix or live session needs is really
 * on this disk — not an online-only cloud placeholder that plays as silence —
 * and can download the online-only ones before you start.
 */
export function ReadyCheckDialog({ open, onClose, subject, items }: Props): JSX.Element | null {
  const [statuses, setStatuses] = useState<Map<string, Status> | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const downloading = progress !== null && progress.done < progress.total
  const { ref: dialogRef, dialogProps } = useDialog(open, onClose, !downloading)

  const unique = [...new Map(items.map((i) => [i.filePath, i])).values()]

  const runCheck = useCallback(async (): Promise<void> => {
    const paths = [...new Set(items.map((i) => i.filePath))]
    const res = await window.electronAPI.checkFilesReady(paths)
    setStatuses(new Map(res.map((r) => [r.path, r.status])))
  }, [items])

  useEffect(() => {
    if (!open) return
    setStatuses(null)
    setProgress(null)
    void runCheck()
  }, [open, runCheck])

  useEffect(() => {
    if (!open) return
    return window.electronAPI.onMakeAvailableProgress((p) => setProgress({ done: p.done, total: p.total }))
  }, [open])

  if (!open) return null

  const byStatus = (s: Status): ReadyCheckItem[] => unique.filter((i) => statuses?.get(i.filePath) === s)
  const cloud = byStatus('cloud')
  const problems = statuses ? unique.filter((i) => statuses.get(i.filePath) !== 'ok').length : 0

  const download = async (): Promise<void> => {
    setProgress({ done: 0, total: cloud.length })
    await window.electronAPI.makeFilesAvailable(cloud.map((i) => i.filePath))
    await runCheck()
    setProgress(null)
  }

  return (
    <div className="fixed inset-0 z-[550] flex items-center justify-center bg-black/60" onMouseDown={() => { if (!downloading) onClose() }}>
      <div
        ref={dialogRef}
        {...dialogProps}
        aria-labelledby="ready-check-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex flex-col w-[480px] max-h-[75vh] overflow-hidden rounded-xl border border-surface-border bg-surface-panel shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3 shrink-0">
          <div>
            <h2 id="ready-check-title" className="text-sm font-semibold text-gray-100">Pre-session check</h2>
            <p className="text-[12px] text-gray-400 mt-0.5">
              {unique.length} file{unique.length !== 1 ? 's' : ''} in {subject}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={downloading} aria-label="Close" title="Close"
            className="text-gray-500 hover:text-gray-300 disabled:opacity-30">✕</button>
        </div>

        <div className="flex-1 min-h-0 px-5 pb-4 overflow-y-auto">
          {!statuses ? (
            <p className="text-[12px] text-gray-400">Checking files…</p>
          ) : problems === 0 ? (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <span className="text-emerald-400 text-lg leading-none">✓</span>
              <p className="text-[12px] text-emerald-200">Every file is on this Mac and ready to play — you can go offline.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <span className="text-amber-400 text-lg leading-none">!</span>
                <p className="text-[12px] text-amber-100">
                  {problems} file{problems !== 1 ? 's' : ''} won't play reliably offline.
                </p>
              </div>
              {GROUPS.map((g) => {
                const list = byStatus(g.status)
                if (list.length === 0) return null
                return (
                  <section key={g.status}>
                    <h3 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                      {g.title} · {list.length}
                    </h3>
                    <p className="text-[11px] text-gray-500 mt-0.5 mb-1.5">{g.help}</p>
                    <ul className="flex flex-col border rounded-md border-surface-border divide-y divide-surface-border">
                      {list.map((i) => (
                        <li key={i.filePath} className="flex items-center justify-between gap-3 px-3 py-1.5">
                          <span className="text-[12px] text-gray-300 truncate" title={i.filePath}>{i.label}</span>
                          {g.status !== 'missing' && (
                            <button type="button" onClick={() => window.electronAPI.showInFolder(i.filePath)}
                              className="text-[11px] text-gray-500 hover:text-gray-300 shrink-0">Show in Finder</button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0 border-surface-border">
          {downloading && progress && (
            <span className="mr-auto text-[11px] text-gray-400">Downloading {progress.done} / {progress.total}…</span>
          )}
          <button type="button" onClick={() => void runCheck()} disabled={downloading}
            className="px-3 py-1.5 text-[12px] text-gray-300 rounded-md border border-surface-border hover:bg-surface-hover disabled:opacity-40">
            Check again
          </button>
          {cloud.length > 0 && (
            <button type="button" onClick={() => void download()} disabled={downloading}
              className="px-3 py-1.5 text-[12px] font-medium text-white rounded-md bg-accent hover:bg-accent-hover disabled:opacity-40">
              Download {cloud.length} online-only file{cloud.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
