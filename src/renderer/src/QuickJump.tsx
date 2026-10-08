import { useEffect, useMemo, useRef, useState } from 'react'
import { useLibraryStore } from './library/store/libraryStore'
import { useUIStore } from './uiStore'
import { useDialog } from './useDialog'
import { isEditableFocused } from './isEditableFocused'
import { buildSidebarTags } from './library/components/FolderPanel'
import * as actions from './workspaceActions'
import type { Workspace } from './workspaceActions'

/**
 * Cmd/Ctrl+K quick-jump palette: one search box for tracks, playlists, recorded
 * sessions, templates, recent mixes, tags, folders and the workspaces.
 * Cmd/Ctrl+1–4 switch straight to Library / Playlists / Mix / Session Mode.
 */

interface Result {
  id: string
  group: string
  title: string
  sub?: string
  run: () => void
}

const TAB_KEYS: Record<string, Workspace> = { '1': 'library', '2': 'playlists', '3': 'mix', '4': 'session' }
const PER_GROUP = 6 // Go to has up to 6 entries

const WORKSPACES: { w: Workspace; title: string; sub: string }[] = [
  { w: 'library', title: 'Library', sub: '⌘1' },
  { w: 'playlists', title: 'Playlists', sub: '⌘2' },
  { w: 'mix', title: 'Mix Mode', sub: '⌘3' },
  { w: 'session', title: 'Session Mode', sub: '⌘4' },
  { w: 'sessions', title: 'Sessions — templates & recordings', sub: '' },
]


function trackTitle(f: { trackTitle: string; fileName: string }): string {
  return f.trackTitle || f.fileName.replace(/\.[^.]+$/, '')
}

export function QuickJump(): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [recentMixes, setRecentMixes] = useState<string[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const close = (): void => setOpen(false)
  const { ref: dialogRef, dialogProps } = useDialog(open, close)

  const files = useLibraryStore((s) => s.files)
  const playlists = useLibraryStore((s) => s.playlists)
  const mixSessions = useLibraryStore((s) => s.mixSessions)
  const savedMixes = useLibraryStore((s) => s.savedMixes)
  const systemPresets = useLibraryStore((s) => s.systemPresets)
  const watchedFolders = useLibraryStore((s) => s.watchedFolders)

  // Global shortcuts. Cmd+K works everywhere (even in a text field, like most
  // apps); Cmd+1–4 only when not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.shiftKey || e.altKey) return
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
        return
      }
      const w = TAB_KEYS[e.key]
      if (w && !isEditableFocused()) {
        e.preventDefault()
        setOpen(false)
        actions.goToWorkspace(w)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    window.electronAPI.getRecentSessions().then(setRecentMixes).catch(() => {})
  }, [open])

  const results = useMemo((): Result[] => {
    if (!open) return []
    const q = query.trim().toLowerCase()
    const hit = (...fields: (string | null | undefined)[]): boolean =>
      !q || fields.some((f) => f?.toLowerCase().includes(q))
    const out: Result[] = []
    const add = (items: Result[]): void => { out.push(...items.slice(0, PER_GROUP)) }

    add([
      ...WORKSPACES.filter((x) => hit(x.title)).map((x) => ({
        id: `ws:${x.w}`, group: 'Go to', title: x.title, sub: x.sub, run: () => actions.goToWorkspace(x.w),
      })),
      ...(hit('Library health duplicates unlinked missing') ? [{
        id: 'act:health', group: 'Go to', title: 'Library health', sub: 'Duplicates, unlinked, missing files',
        run: () => useUIStore.getState().setLibraryHealthOpen(true),
      }] : []),
    ])
    if (q) {
      add(files.filter((f) => hit(f.trackTitle, f.fileName, f.artist, f.album)).slice(0, PER_GROUP).map((f) => ({
        id: `track:${f.id}`, group: 'Tracks', title: trackTitle(f), sub: f.artist || undefined, run: () => actions.revealTrack(f.id),
      })))
    }
    add(playlists.filter((p) => hit(p.title)).map((p) => ({
      id: `pl:${p.id}`, group: 'Playlists', title: p.title, sub: `${p.trackIds?.length ?? 0} tracks`, run: () => actions.openPlaylistById(p.id),
    })))
    add(mixSessions.filter((s) => hit(s.name)).map((s) => ({
      id: `ses:${s.id}`, group: 'Recent sessions', title: s.name, sub: new Date(s.startedAt).toLocaleDateString(), run: () => actions.openRecordedSession(s.id),
    })))
    add([...savedMixes, ...systemPresets].filter((m) => hit(m.name)).map((m) => ({
      id: `tpl:${m.id}`, group: 'Templates', title: m.name, sub: 'Load in Session Mode', run: () => actions.openTemplate(m.id),
    })))
    add(recentMixes.filter((p) => hit(p)).map((p) => ({
      id: `mix:${p}`, group: 'Recent mixes', title: p.split(/[\\/]/).pop()?.replace(/\.limina$/, '') ?? p, sub: 'Open in Mix', run: () => actions.openRecentMix(p),
    })))
    if (q) {
      add(buildSidebarTags(files).filter(([t, n]) => n > 0 && hit(t)).map(([t, n]) => ({
        id: `tag:${t}`, group: 'Tags', title: t, sub: `${n} tracks`, run: () => actions.openLibraryAt({ tag: t }),
      })))
      add(watchedFolders.filter((f) => hit(f.label, f.path)).map((f) => ({
        id: `folder:${f.id}`, group: 'Folders', title: f.label, sub: f.path, run: () => actions.openLibraryAt({ folderId: f.id }),
      })))
    }
    return out
  }, [open, query, files, playlists, mixSessions, savedMixes, systemPresets, recentMixes, watchedFolders])

  useEffect(() => { setActive(0) }, [query])

  // Keep the highlighted row visible while arrowing through.
  useEffect(() => {
    listRef.current?.querySelector(`[data-qj-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const runAt = (i: number): void => {
    const r = results[i]
    if (!r) return
    setOpen(false)
    r.run()
  }

  const onInputKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); runAt(active) }
  }

  let lastGroup = ''
  return (
    <div className="fixed inset-0 z-[600] flex items-start justify-center pt-[12vh] bg-black/50" onMouseDown={close}>
      <div
        ref={dialogRef}
        {...dialogProps}
        aria-label="Quick jump"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex flex-col w-[560px] max-h-[65vh] overflow-hidden rounded-xl border border-surface-border bg-surface-panel shadow-2xl shadow-black/60"
      >
        <div className="flex items-center gap-2 px-4 border-b shrink-0 border-surface-border">
          <svg className="w-4 h-4 text-gray-500 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <circle cx="5" cy="5" r="3.5" /><path d="M8 8l2.5 2.5" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Jump to a track, playlist, session, mix, tag…"
            className="flex-1 py-3 text-sm text-gray-100 bg-transparent outline-none placeholder:text-gray-500"
          />
          <kbd className="text-[10px] text-gray-500 border border-surface-border rounded px-1.5 py-0.5">esc</kbd>
        </div>
        <div ref={listRef} role="listbox" className="flex-1 min-h-0 py-1 overflow-y-auto">
          {results.length === 0 && <p className="px-4 py-6 text-center text-[12px] text-gray-500">No matches</p>}
          {results.map((r, i) => {
            const heading = r.group !== lastGroup ? r.group : null
            lastGroup = r.group
            return (
              <div key={r.id}>
                {heading && (
                  <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">{heading}</div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-qj-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => runAt(i)}
                  className={`flex items-center w-full gap-3 px-4 py-2 text-left ${i === active ? 'bg-accent/15' : ''}`}
                >
                  <span className={`flex-1 min-w-0 text-[13px] truncate ${i === active ? 'text-white' : 'text-gray-200'}`}>{r.title}</span>
                  {r.sub && <span className="text-[11px] text-gray-500 truncate max-w-[45%]">{r.sub}</span>}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
