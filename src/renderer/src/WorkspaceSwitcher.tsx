import { useEffect, useMemo, useRef, useState } from 'react'
import { useUIStore } from './uiStore'
import { useLibraryStore } from './library/store/libraryStore'
import { useTransportStore } from './mix/store/transportStore'
import * as actions from './workspaceActions'
import { goToWorkspace } from './workspaceActions'
import { buildSidebarTags } from './library/components/FolderPanel'
import { isInFolder } from './library/lib/isInFolder'

import type { Workspace } from './workspaceActions'
type Menu = 'library' | 'playlists' | 'mix' | 'session'

const LABELS: Record<Workspace, string> = {
  library: 'Library',
  playlists: 'Playlists',
  mix: 'Mix Mode',
  session: 'Session Mode',
  sessions: 'Sessions',
}

const MAX_RECENT = 8

function NowPlayingBars(): JSX.Element {
  return (
    <span className="inline-flex items-end gap-0.5 mb-px ml-1" aria-hidden>
      <span className="w-px h-1.5 bg-accent rounded-full animate-pulse" style={{ animationDelay: '0ms', animationDuration: '900ms' }} />
      <span className="w-px h-2.5 bg-accent rounded-full animate-pulse" style={{ animationDelay: '300ms', animationDuration: '900ms' }} />
      <span className="w-px h-1.5 bg-accent rounded-full animate-pulse" style={{ animationDelay: '600ms', animationDuration: '900ms' }} />
      <span className="w-px h-2 rounded-full bg-accent animate-pulse" style={{ animationDelay: '900ms', animationDuration: '900ms' }} />
    </span>
  )
}

const TAB = 'flex items-center px-2.5 py-1 text-[10px] font-semibold tracking-widest uppercase rounded transition-colors select-none'
const TAB_ACTIVE = 'text-accent bg-accent/10'
const TAB_IDLE = 'text-gray-500 hover:text-gray-200 hover:bg-surface-hover'

function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 60) return `${totalMin}m`
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`
}

// ── Dropdown building blocks (shared by every tab) ───────────────────────────

function MenuPanel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      role="menu"
      className="absolute left-0 top-full mt-1.5 z-[200] w-80 max-h-[70vh] flex flex-col overflow-hidden rounded-lg border border-surface-border bg-surface-panel shadow-2xl shadow-black/60"
    >
      {children}
    </div>
  )
}

/** Full-width section heading inside a dropdown. */
function MenuHeading({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="shrink-0 px-4 py-2 border-y border-surface-border first:border-t-0 bg-white/[0.03] text-[10px] font-semibold uppercase tracking-widest text-gray-400">
      {children}
    </div>
  )
}

/** `scroll` fills the remaining height and scrolls; `capped` scrolls within a
 *  fixed share of the panel so a following section always stays reachable. */
function MenuList({ children, scroll = false, capped = false }: { children: React.ReactNode; scroll?: boolean; capped?: boolean }): JSX.Element {
  const cls = capped ? 'shrink-0 max-h-[30vh] overflow-y-auto' : scroll ? 'min-h-0 overflow-y-auto' : 'shrink-0'
  return <div className={`py-1 ${cls}`}>{children}</div>
}

function MenuItem({ title, sub, count, onClick }: { title: string; sub?: string; count?: number; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex items-center w-full gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-hover"
    >
      <span className="flex flex-col flex-1 min-w-0">
        <span className="text-[12px] text-gray-200 truncate">{title}</span>
        {sub && <span className="text-[11px] text-gray-500 truncate">{sub}</span>}
      </span>
      {count != null && <span className="text-[11px] tabular-nums text-gray-500 shrink-0">{count}</span>}
    </button>
  )
}

function MenuEmpty({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="px-4 py-2 text-[11px] text-gray-500">{children}</p>
}

function MenuFooter({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="shrink-0 w-full px-4 py-2 text-left text-[11px] border-t border-surface-border text-gray-400 hover:text-gray-200 hover:bg-surface-hover transition-colors"
    >
      {label}
    </button>
  )
}

/**
 * Horizontal tab-style workspace switcher shown in the toolbar of every workspace.
 * Each tab is a split button: the label switches workspace, the chevron opens a
 * dropdown that jumps straight into something inside it (a folder or tag, a
 * playlist, a recent mix, a recent session).
 */
export function WorkspaceSwitcher(): JSX.Element {
  const surface = useUIStore((s) => s.surface)
  const collectionsView = useUIStore((s) => s.collectionsView)
  const mixMode = useLibraryStore((s) => s.mixMode)
  const mixSessions = useLibraryStore((s) => s.mixSessions)
  const watchedFolders = useLibraryStore((s) => s.watchedFolders)
  const files = useLibraryStore((s) => s.files)
  const playlists = useLibraryStore((s) => s.playlists)
  const userAccount = useLibraryStore((s) => s.userAccount)
  const mixPlaying = useTransportStore((s) => s.playing)
  const sessionPlaying = useLibraryStore((s) => s.mixPlayback.playing)
  const [openMenu, setOpenMenu] = useState<Menu | null>(null)
  const [recentMixes, setRecentMixes] = useState<string[]>([])
  const rootRef = useRef<HTMLDivElement>(null)

  const current: Workspace =
    surface === 'mix' ? 'mix'
      : surface === 'playlists' ? (collectionsView === 'sessions' ? 'sessions' : 'playlists')
        : mixMode ? 'session' : 'library'

  // Which workspace should show the now-playing indicator
  const playingWorkspace: Workspace | null = mixPlaying ? 'mix' : sessionPlaying ? 'session' : null

  // Only computed while the Library menu is open (they walk every file).
  const sidebarTags = useMemo(
    () => (openMenu === 'library' ? buildSidebarTags(files).filter(([, n]) => n > 0) : []),
    [openMenu, files],
  )
  // Live per-folder counts, matching the Library sidebar (WatchedFolder.fileCount
  // is only refreshed on a full scan).
  const folderCounts = useMemo(() => {
    const m = new Map<string, number>()
    if (openMenu !== 'library') return m
    for (const wf of watchedFolders) m.set(wf.id, files.filter((f) => isInFolder(f.filePath, wf.path)).length)
    return m
  }, [openMenu, files, watchedFolders])

  // Data that isn't always loaded: refresh when the relevant menu opens.
  useEffect(() => {
    if (openMenu === 'mix') {
      window.electronAPI.getRecentSessions().then(setRecentMixes).catch(() => {})
    } else if (openMenu === 'playlists' && userAccount && useLibraryStore.getState().playlists.length === 0) {
      window.electronAPI.getUserPlaylists().then(useLibraryStore.getState().setPlaylists).catch(() => {})
    }
  }, [openMenu, userAccount])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!openMenu) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpenMenu(null) }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [openMenu])

  const goTo = (w: Workspace): void => { setOpenMenu(null); goToWorkspace(w) }

  // ── Dropdown actions (shared with the Cmd+K palette) ──────────────────────
  const close = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A): void => { setOpenMenu(null); fn(...a) }
  const openLibraryAt = close(actions.openLibraryAt)
  const openPlaylist = close(actions.openPlaylistById)
  const openRecentMix = close(actions.openRecentMix)
  const openRecordedSession = close(actions.openRecordedSession)
  const openSessionsView = close(() => actions.openSessionsView('recorded'))

  // ── Menus ─────────────────────────────────────────────────────────────────

  const menus: Record<Menu, () => JSX.Element> = {
    library: () => (
      <MenuPanel>
        <MenuHeading>Folders</MenuHeading>
        <MenuList capped>
          {watchedFolders.length === 0
            ? <MenuEmpty>No folders added yet.</MenuEmpty>
            : watchedFolders.map((f) => (
              <MenuItem key={f.id} title={f.label} sub={f.path} count={folderCounts.get(f.id) ?? 0} onClick={() => openLibraryAt({ folderId: f.id })} />
            ))}
        </MenuList>
        <MenuHeading>Tags</MenuHeading>
        <MenuList scroll>
          {sidebarTags.length === 0
            ? <MenuEmpty>No tagged tracks yet.</MenuEmpty>
            : sidebarTags.map(([tag, n]) => (
              <MenuItem key={tag} title={tag} count={n} onClick={() => openLibraryAt({ tag })} />
            ))}
        </MenuList>
        <MenuFooter label="Library health →" onClick={() => { setOpenMenu(null); useUIStore.getState().setLibraryHealthOpen(true) }} />
      </MenuPanel>
    ),
    playlists: () => (
      <MenuPanel>
        <MenuHeading>Music for Breathwork playlists</MenuHeading>
        <MenuList scroll>
          {!userAccount
            ? <MenuEmpty>Sign in to see your playlists.</MenuEmpty>
            : playlists.length === 0
              ? <MenuEmpty>No playlists yet.</MenuEmpty>
              : playlists.map((p) => (
                <MenuItem key={p.id} title={p.title} count={p.trackIds?.length ?? 0} onClick={() => openPlaylist(p.id)} />
              ))}
        </MenuList>
      </MenuPanel>
    ),
    mix: () => (
      <MenuPanel>
        <MenuHeading>Recent mixes</MenuHeading>
        <MenuList scroll>
          {recentMixes.length === 0
            ? <MenuEmpty>No recent mixes yet.</MenuEmpty>
            : recentMixes.slice(0, MAX_RECENT).map((p) => (
              <MenuItem
                key={p}
                title={p.split(/[\\/]/).pop()?.replace(/\.limina$/, '') ?? p}
                sub={p.replace(/^.*[\\/]([^\\/]+[\\/][^\\/]+)$/, '…/$1')}
                onClick={() => openRecentMix(p)}
              />
            ))}
        </MenuList>
      </MenuPanel>
    ),
    session: () => (
      <MenuPanel>
        <MenuHeading>Recent sessions</MenuHeading>
        <MenuList scroll>
          {mixSessions.length === 0
            ? <MenuEmpty>No recorded sessions yet.</MenuEmpty>
            : mixSessions.slice(0, MAX_RECENT).map((s) => (
              <MenuItem
                key={s.id}
                title={s.name}
                sub={`${new Date(s.startedAt).toLocaleDateString()} · ${fmtDuration(s.durationMs)} · ${s.played.length} tracks`}
                onClick={() => openRecordedSession(s.id)}
              />
            ))}
        </MenuList>
        <MenuFooter label="All sessions & templates →" onClick={openSessionsView} />
      </MenuPanel>
    ),
  }

  const MENU_LABELS: Record<Menu, string> = {
    library: 'Folders and tags',
    playlists: 'Playlists',
    mix: 'Recent mixes',
    session: 'Recent sessions',
  }

  const tab = (w: Menu): JSX.Element => {
    // The Sessions view is reached from Session Mode's menu, so it lights that tab.
    const active = current === w || (w === 'session' && current === 'sessions')
    const menuOpen = openMenu === w
    return (
      <div key={w} className="relative flex items-center">
        <button
          type="button"
          onClick={() => goTo(w)}
          aria-current={current === w ? 'page' : undefined}
          className={`${TAB} ${active ? TAB_ACTIVE : TAB_IDLE} rounded-r-none pr-1.5`}
        >
          {LABELS[w]}
          {w === playingWorkspace && <NowPlayingBars />}
        </button>
        <button
          type="button"
          onClick={() => setOpenMenu((m) => (m === w ? null : w))}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={MENU_LABELS[w]}
          title={MENU_LABELS[w]}
          className={`flex items-center self-stretch px-1 rounded-r transition-colors ${
            active || menuOpen ? 'text-accent bg-accent/10 hover:bg-accent/20' : 'text-gray-500 hover:text-gray-200 hover:bg-surface-hover'
          }`}
        >
          <svg className={`w-2.5 h-2.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3.5l3 3 3-3" />
          </svg>
        </button>
        {menuOpen && menus[w]()}
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className="flex items-center gap-1.5"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {tab('library')}
      {tab('playlists')}
      {tab('mix')}
      {tab('session')}
    </div>
  )
}
