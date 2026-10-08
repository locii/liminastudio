import { useMemo, useState } from 'react'
import { useLibraryStore } from '../store/libraryStore'
import { useUIStore } from '../../uiStore'
import { useDialog } from '../../useDialog'
import { syncLibraryToMfb } from '../lib/syncLibrary'
import { runFeatureScan } from '../lib/featureScan'
import type { LibraryFile } from '../types'

type DiskStatus = 'ok' | 'cloud' | 'empty' | 'missing'

const LOSSLESS = new Set(['wav', 'flac', 'aiff', 'aif'])

function ext(f: LibraryFile): string {
  return f.filePath.split('.').pop()?.toLowerCase() ?? ''
}

/** Which copy of a duplicated track to keep: on disk > lossless > bigger file. */
function rankCopy(f: LibraryFile, disk: Map<string, DiskStatus> | null): number {
  const onDisk = !disk || disk.get(f.filePath) === 'ok' ? 1 : 0
  return onDisk * 1e15 + (LOSSLESS.has(ext(f)) ? 1e14 : 0) + (f.fileSize || 0)
}

function fmtSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${Math.round(bytes / 1e3)} KB`
}

/**
 * One place to tidy the catalogue: apply waiting Music for Breathwork matches,
 * find unlinked tracks, resolve duplicates, fill in missing audio features, and
 * check which files are really on this Mac. Removals here are the Library's
 * normal soft-remove (restorable from the "removed" filter).
 */
export function LibraryHealthDialog(): JSX.Element | null {
  const open = useUIStore((s) => s.libraryHealthOpen)
  const setOpen = useUIStore((s) => s.setLibraryHealthOpen)
  const close = (): void => setOpen(false)
  const [checking, setChecking] = useState(false)
  const [disk, setDisk] = useState<Map<string, DiskStatus> | null>(null)
  const [showDupes, setShowDupes] = useState(false)
  const { ref: dialogRef, dialogProps } = useDialog(open, close, !checking)

  const files = useLibraryStore((s) => s.files)
  const removedFiles = useLibraryStore((s) => s.removedFiles)
  const pendingMatches = useLibraryStore((s) => s.pendingMatches)
  const userAccount = useLibraryStore((s) => s.userAccount)

  const stats = useMemo(() => {
    const byMfb = new Map<number, LibraryFile[]>()
    for (const f of files) {
      if (f.mfbTrackId == null) continue
      const arr = byMfb.get(f.mfbTrackId) ?? []
      arr.push(f)
      byMfb.set(f.mfbTrackId, arr)
    }
    const dupeGroups = [...byMfb.values()].filter((g) => g.length > 1)
    return {
      total: files.length,
      matched: files.filter((f) => f.mfbTrackId != null).length,
      unlinked: files.filter((f) => f.mfbTrackId == null).length,
      noFeatures: files.filter((f) => !f.audioFeatures && !f.featuresAnalyzed).length,
      dupeGroups,
      dupeExtras: dupeGroups.reduce((n, g) => n + g.length - 1, 0),
    }
  }, [files])

  if (!open) return null

  const pendingCount = Object.keys(pendingMatches).filter((id) => files.some((f) => f.id === id)).length
  const diskCounts = disk
    ? files.reduce((acc, f) => { const s = disk.get(f.filePath) ?? 'ok'; acc[s]++; return acc }, { ok: 0, cloud: 0, empty: 0, missing: 0 } as Record<DiskStatus, number>)
    : null

  const runDiskCheck = async (): Promise<void> => {
    setChecking(true)
    try {
      const res = await window.electronAPI.checkFilesReady([...new Set(files.map((f) => f.filePath))])
      setDisk(new Map(res.map((r) => [r.path, r.status])))
    } finally { setChecking(false) }
  }

  const tidyGroups = async (groups: LibraryFile[][]): Promise<void> => {
    const extras = groups.flatMap((g) => [...g].sort((a, b) => rankCopy(b, disk) - rankCopy(a, disk)).slice(1))
    if (extras.length === 0) return
    const ok = await window.electronAPI.confirm({
      message: `Remove ${extras.length} duplicate cop${extras.length === 1 ? 'y' : 'ies'} from your library?`,
      detail: 'For each track, the best copy is kept (on this Mac, lossless, then largest). Removed copies can be restored from the Library’s "removed" filter. Files on disk are not touched.',
      confirmLabel: 'Remove duplicates',
    })
    if (ok) useLibraryStore.getState().removeFiles(extras.map((f) => f.id))
  }

  const removeMissing = async (): Promise<void> => {
    if (!disk) return
    const missing = files.filter((f) => disk.get(f.filePath) === 'missing')
    if (missing.length === 0) return
    const ok = await window.electronAPI.confirm({
      message: `Remove ${missing.length} missing track${missing.length !== 1 ? 's' : ''} from your library?`,
      detail: 'These files no longer exist at their saved location. You can restore them from the "removed" filter if they come back.',
      confirmLabel: 'Remove missing',
    })
    if (ok) useLibraryStore.getState().removeFiles(missing.map((f) => f.id))
  }

  const showUnlinked = (): void => {
    close()
    const lib = useLibraryStore.getState()
    lib.exitMixMode()
    useLibraryStore.setState({ selectedFolderId: null, selectedTags: [], selectedPlaylistId: null })
    lib.setUnmatchedOnly(true)
    useUIStore.getState().setSurface('library')
  }

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60" onMouseDown={() => { if (!checking) close() }}>
      <div
        ref={dialogRef}
        {...dialogProps}
        aria-labelledby="health-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex flex-col w-[560px] max-h-[82vh] overflow-hidden rounded-xl border border-surface-border bg-surface-panel shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 shrink-0">
          <div>
            <h2 id="health-title" className="text-sm font-semibold text-gray-100">Library health</h2>
            <p className="text-[12px] text-gray-400 mt-0.5">
              {stats.total.toLocaleString()} tracks · {stats.matched.toLocaleString()} matched to Music for Breathwork
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close" title="Close" className="text-gray-500 hover:text-gray-300">✕</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto border-t border-surface-border divide-y divide-surface-border">
          <HealthRow
            title="Matches waiting"
            count={pendingCount}
            good={pendingCount === 0}
            desc={pendingCount ? 'Tracks matched to the Music for Breathwork catalogue, ready to apply (adds phase tags and audio features).' : 'No matches waiting.'}
            action={pendingCount > 0 ? { label: `Apply ${pendingCount}`, onClick: () => { useLibraryStore.getState().applyAllPendingMatches(); void syncLibraryToMfb() } } : undefined}
          />
          <HealthRow
            title="Unlinked"
            count={stats.unlinked}
            good={stats.unlinked === 0}
            desc={userAccount ? 'Not matched to the Music for Breathwork catalogue yet. Matching runs in the background; review them in the Library.' : 'Sign in to match tracks to the Music for Breathwork catalogue.'}
            action={stats.unlinked > 0 ? { label: 'Show unlinked', onClick: showUnlinked } : undefined}
          />
          <HealthRow
            title="Duplicates"
            count={stats.dupeExtras}
            good={stats.dupeExtras === 0}
            desc={stats.dupeExtras ? `${stats.dupeGroups.length} tracks exist in more than one copy. Keep the best copy of each (on this Mac, lossless, then largest).` : 'No duplicate tracks.'}
            action={stats.dupeExtras > 0 ? { label: 'Tidy all', onClick: () => void tidyGroups(stats.dupeGroups) } : undefined}
            secondary={stats.dupeExtras > 0 ? { label: showDupes ? 'Hide' : 'Review', onClick: () => setShowDupes((v) => !v) } : undefined}
          >
            {showDupes && (
              <ul className="mt-2 border rounded-md border-surface-border divide-y divide-surface-border max-h-64 overflow-y-auto">
                {stats.dupeGroups.map((g) => {
                  const sorted = [...g].sort((a, b) => rankCopy(b, disk) - rankCopy(a, disk))
                  return (
                    <li key={g[0].mfbTrackId} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[12px] text-gray-200 truncate">{g[0].trackTitle || g[0].fileName}</span>
                        <button type="button" onClick={() => void tidyGroups([g])} className="shrink-0 text-[11px] text-accent hover:text-accent-hover">Keep best</button>
                      </div>
                      {sorted.map((f, i) => (
                        <p key={f.id} className={`text-[11px] truncate ${i === 0 ? 'text-emerald-300/80' : 'text-gray-500'}`} title={f.filePath}>
                          {i === 0 ? 'keep · ' : ''}{ext(f).toUpperCase()} · {fmtSize(f.fileSize || 0)} · {f.filePath}
                        </p>
                      ))}
                    </li>
                  )
                })}
              </ul>
            )}
          </HealthRow>
          <HealthRow
            title="Missing audio features"
            count={stats.noFeatures}
            good={stats.noFeatures === 0}
            desc="Affective and activating intensity, tension and spaciousness power Feel EQ and the Mix energy arc. Estimating uploads a 30-second excerpt of each track to ReccoBeats for analysis."
            action={stats.noFeatures > 0 ? { label: 'Estimate', onClick: () => { void runFeatureScan(); close() } } : undefined}
          />
          <HealthRow
            title="On this Mac"
            count={diskCounts ? diskCounts.cloud + diskCounts.empty + diskCounts.missing : null}
            good={diskCounts ? diskCounts.cloud + diskCounts.empty + diskCounts.missing === 0 : undefined}
            desc={diskCounts
              ? `${diskCounts.ok.toLocaleString()} on disk · ${diskCounts.cloud.toLocaleString()} online-only · ${diskCounts.empty.toLocaleString()} empty (0 bytes) · ${diskCounts.missing.toLocaleString()} missing. Online-only files play as silence offline — use Pre-session Check before a session to download what you need.`
              : 'Check which library files are actually stored on this Mac rather than online-only in a cloud folder.'}
            action={!diskCounts
              ? { label: checking ? 'Checking…' : 'Check files', onClick: () => void runDiskCheck(), disabled: checking }
              : diskCounts.missing > 0 ? { label: `Remove ${diskCounts.missing} missing`, onClick: () => void removeMissing() } : undefined}
          />
          <HealthRow
            title="Removed"
            count={removedFiles.length}
            good
            desc="Tracks you've removed stay hidden — rescans won't bring them back. Restore any from the Library's “removed” filter."
          />
        </div>
      </div>
    </div>
  )
}

function HealthRow({ title, count, desc, good, action, secondary, children }: {
  title: string
  count: number | null
  desc: string
  good?: boolean
  action?: { label: string; onClick: () => void; disabled?: boolean }
  secondary?: { label: string; onClick: () => void }
  children?: React.ReactNode
}): JSX.Element {
  return (
    <section className="px-5 py-3.5">
      <div className="flex items-start gap-3">
        <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${good === undefined ? 'bg-gray-600' : good ? 'bg-emerald-400' : 'bg-amber-400'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="text-[13px] font-medium text-gray-100">{title}</h3>
            {count != null && <span className="text-[12px] tabular-nums text-gray-400">{count.toLocaleString()}</span>}
          </div>
          <p className="text-[11px] leading-relaxed text-gray-500 mt-0.5">{desc}</p>
          {children}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {secondary && (
            <button type="button" onClick={secondary.onClick}
              className="px-2.5 py-1 text-[11px] text-gray-400 rounded-md hover:text-gray-200 hover:bg-surface-hover">
              {secondary.label}
            </button>
          )}
          {action && (
            <button type="button" onClick={action.onClick} disabled={action.disabled}
              className="px-2.5 py-1 text-[11px] font-medium text-gray-200 rounded-md border border-surface-border hover:border-accent/50 hover:text-white disabled:opacity-40">
              {action.label}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
