import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useLibraryStore } from './library/store/libraryStore'
import type { SavedMix, MixSession, MixQueueItem } from './library/store/libraryStore'
import { PlaylistPanel } from './library/components/PlaylistPanel'
import { PlayerBar } from './library/components/PlayerBar'
import { SessionTransportBar } from './SessionTransportBar'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { GlobalControls } from './GlobalControls'
import { GuidedTour } from './library/components/GuidedTour'
import type { TourStep } from './library/components/GuidedTour'
import { useUIStore } from './uiStore'
import { openInMix } from './openInMix'
import { requestOpen } from './openGuard'
import { requestNavigate } from './navigate'
import { buildTwoTrackMix, buildTwoTrackMixFromRecording, type MixItem } from './buildLiminaMix'
import { getMixEngine } from './library/lib/mixEngineSingleton'
import { materializeGroup } from './library/lib/mixSelection'

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

type CollSel =
  | { kind: 'playlist'; id: number }
  | { kind: 'template'; id: string }
  | { kind: 'session'; id: string }
  | { kind: 'mix'; filePath: string }

function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 60) return `${totalMin}m`
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`
}

function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

function fadeSecs(ms: number): string {
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`
}

/** Plain-text export of a recorded session's tracklist + plan edits. */
function sessionToText(session: MixSession): string {
  const rows = [
    ...session.played.map((p) => ({ atMs: p.atMs, kind: 'track' as const, title: p.title, artist: p.artist, tags: p.fromTags, fadeInMs: p.fadeInMs ?? 0 })),
    ...session.edits.map((e) => ({ atMs: e.atMs, kind: 'edit' as const, summary: e.summary })),
  ].sort((a, b) => a.atMs - b.atMs)
  const lines: string[] = [
    session.name,
    `${new Date(session.startedAt).toLocaleString()} · ${fmtDuration(session.durationMs)} · ${session.played.length} tracks`,
    '',
  ]
  for (const r of rows) {
    if (r.kind === 'track') {
      const tags = r.tags && r.tags.length ? `  [${r.tags.join(', ')}]` : ''
      const who = r.artist ? ` — ${r.artist}` : ''
      const xf = r.fadeInMs > 0 ? `  (↝ ${fadeSecs(r.fadeInMs)} crossfade in)` : ''
      lines.push(`${fmtClock(r.atMs).padStart(6)}  ${r.title}${who}${tags}${xf}`)
    } else {
      lines.push(`${fmtClock(r.atMs).padStart(6)}  · ${r.summary}`)
    }
  }
  return lines.join('\n')
}

/** Collapsible sidebar section. */
// Persists section open/closed state across remounts (survives workspace navigation).
const sectionState: Record<string, boolean> = {}

// Remembers the last-selected collection item across visits (and app restarts).
const LAST_SEL_KEY = 'collections-last-sel'

/** The sidebar section a given selection lives in — so we can re-open it when
 *  restoring / deep-linking a selection. */
function sectionLabelFor(sel: CollSel): string {
  switch (sel.kind) {
    case 'playlist': return 'Music for Breathwork Playlists'
    case 'template': return 'Session Templates'
    case 'session': return 'Recorded Sessions'
    case 'mix': return 'Recent Mixes'
  }
}

function Section({
  label, count, children, defaultOpen = false,
}: {
  label: string
  count: number
  children: React.ReactNode
  defaultOpen?: boolean
}): JSX.Element {
  // On first ever render for this label use defaultOpen; on remounts use saved state.
  const [open, setOpen] = useState(() =>
    label in sectionState ? sectionState[label] : defaultOpen
  )

  const toggle = (): void => {
    setOpen((v) => {
      sectionState[label] = !v
      return !v
    })
  }

  return (
    <div className="border-b border-surface-border/60">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center justify-between w-full px-3 py-2 text-[9px] uppercase tracking-wider text-gray-500 hover:text-gray-300 transition-colors select-none"
      >
        <span>{label}</span>
        <span className="flex items-center gap-1.5">
          {count > 0 && <span className="tracking-normal text-gray-700 normal-case">{count}</span>}
          <svg className={`w-2.5 h-2.5 transition-transform ${open ? '' : '-rotate-90'}`} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 3.5l3 3 3-3" />
          </svg>
        </span>
      </button>
      {open && children}
    </div>
  )
}

function SidebarItem({
  label, sub, active, onClick,
}: {
  label: string
  sub?: string
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col w-full px-3 py-2 text-left transition-colors border-b border-surface-border/30 ${active ? 'bg-accent/15 text-accent' : 'text-gray-300 hover:bg-surface-hover'}`}
    >
      <span className="text-[11px] truncate leading-tight">{label}</span>
      {sub && <span className={`text-[10px] truncate leading-tight mt-0.5 ${active ? 'text-accent/70' : 'text-gray-600'}`}>{sub}</span>}
    </button>
  )
}

const COLLECTIONS_STEPS: TourStep[] = [
  {
    id: 'collections-welcome',
    title: 'Welcome to Collections',
    body: 'Collections is your hub for MFB playlists, session templates, recorded sessions, and saved mixes. Select any item on the left to see its details.',
    placement: 'center',
  },
  {
    id: 'collections-filter',
    title: 'Filter & Search',
    body: 'Type here to instantly filter across all collection types — playlists, templates, sessions, and mix files.',
    target: '[data-tour="collections-filter"]',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'collections-playlists',
    title: 'Music for Breathwork Playlists',
    body: 'Your curated MFB playlists appear here once you\'re signed in. Click a playlist to see which tracks you own and preview them.',
    target: '[data-tour="collections-playlists"]',
    placement: 'right',
    spotlight: true,
  },
  {
    id: 'collections-templates',
    title: 'Session Templates',
    body: 'Save your Session Mode queue as a reusable template. Load it here to quickly restore a set of tags, generators, and tracks.',
    target: '[data-tour="collections-templates"]',
    placement: 'right',
    spotlight: true,
  },
  {
    id: 'collections-sessions',
    title: 'Recorded Sessions',
    body: 'When you record a live session in Session Mode, it appears here with a full tracklist. Open it in Session Mode to replay it, or in Mix Mode to edit the timeline.',
    target: '[data-tour="collections-sessions"]',
    placement: 'right',
    spotlight: true,
  },
  {
    id: 'collections-mixes',
    title: 'Recent Mixes',
    body: 'Mix files (.limina) you\'ve saved appear here. Click to preview the tracklist, then open in Mix Mode to continue editing.',
    target: '[data-tour="collections-mixes"]',
    placement: 'right',
    spotlight: true,
  },
  {
    id: 'collections-detail',
    title: 'Detail Panel',
    body: 'Select any collection on the left to see its details — tracks, timestamps, durations, and actions like Open in Mix or Load in Session.',
    target: '[data-tour="collections-detail"]',
    placement: 'left',
    spotlight: true,
  },
]

export function PlaylistsSurface(): JSX.Element {
  const setSurface = useUIStore((s) => s.setSurface)
  const userAccount = useLibraryStore((s) => s.userAccount)
  const playlists = useLibraryStore((s) => s.playlists)
  const setPlaylists = useLibraryStore((s) => s.setPlaylists)
  const files = useLibraryStore((s) => s.files)
  const savedMixes = useLibraryStore((s) => s.savedMixes)
  const systemPresets = useLibraryStore((s) => s.systemPresets)
  const loadSystemPresets = useLibraryStore((s) => s.loadSystemPresets)
  const mixSessions = useLibraryStore((s) => s.mixSessions)
  const deleteMix = useLibraryStore((s) => s.deleteMix)
  const deleteMixSession = useLibraryStore((s) => s.deleteMixSession)
  const loadMix = useLibraryStore((s) => s.loadMix)
  const loadSession = useLibraryStore((s) => s.loadSession)
  const enterMixMode = useLibraryStore((s) => s.enterMixMode)
  const selectPlaylist = useLibraryStore((s) => s.selectPlaylist)
  const selectedPlaylistId = useLibraryStore((s) => s.selectedPlaylistId)

  // Initial selection, in priority order: a "View in Collections" deep-link, then
  // the selection from the last visit. Either way, force its sidebar section open
  // (set synchronously so the Section reads it when it first mounts, below).
  const [sel, setSel] = useState<CollSel | null>(() => {
    const pendingId = useUIStore.getState().collectionsPendingSessionId
    if (pendingId) { sectionState['Recorded Sessions'] = true; return { kind: 'session', id: pendingId } }
    try {
      const raw = localStorage.getItem(LAST_SEL_KEY)
      if (raw) {
        const restored = JSON.parse(raw) as CollSel
        sectionState[sectionLabelFor(restored)] = true
        return restored
      }
    } catch { /* ignore malformed */ }
    return null
  })
  const [query, setQuery] = useState('')
  const [recentMixes, setRecentMixes] = useState<string[]>([])
  const [opening, setOpening] = useState(false)
  const cancelledRef = useRef(false)
  const [tourOpen, setTourOpen] = useState(false)

  useEffect(() => {
    try { if (!localStorage.getItem('collections-tour-completed')) setTourOpen(true) } catch { /* noop */ }
  }, [])
  useEffect(() => {
    const handler = (): void => setTourOpen(true)
    window.addEventListener('app:start-tour', handler)
    return () => window.removeEventListener('app:start-tour', handler)
  }, [])
  const closeTour = useCallback(() => {
    setTourOpen(false)
    try { localStorage.setItem('collections-tour-completed', '1') } catch { /* noop */ }
  }, [])

  // Load MFB playlists when signed in
  useEffect(() => {
    if (!userAccount) { setPlaylists([]); return }
    window.electronAPI.getUserPlaylists().then(setPlaylists).catch(() => {})
  }, [userAccount, setPlaylists])

  // Load system presets when signed in
  useEffect(() => {
    if (userAccount) void loadSystemPresets()
  }, [userAccount, loadSystemPresets])

  // Load recent mix files
  useEffect(() => {
    window.electronAPI.getRecentSessions().then(setRecentMixes).catch(() => {})
  }, [])

  // Sync PlaylistPanel's store selection with our sel state
  useEffect(() => {
    if (sel?.kind === 'playlist') selectPlaylist(sel.id)
    else selectPlaylist(null)
  }, [sel, selectPlaylist])

  // Clear playlist selection on unmount
  useEffect(() => () => { useLibraryStore.getState().selectPlaylist(null) }, [])

  // Consume the deep-link so a later visit to Collections doesn't re-select it.
  useEffect(() => {
    if (useUIStore.getState().collectionsPendingSessionId) {
      useUIStore.getState().setCollectionsPendingSessionId(null)
    }
  }, [])

  // Remember the current selection so it's restored next time we visit.
  useEffect(() => {
    try {
      if (sel) localStorage.setItem(LAST_SEL_KEY, JSON.stringify(sel))
      else localStorage.removeItem(LAST_SEL_KEY)
    } catch { /* ignore */ }
  }, [sel])

  const matchedMfbIds = useMemo(
    () => new Set(files.filter((f) => f.mfbTrackId != null).map((f) => f.mfbTrackId as number)),
    [files],
  )

  const q = query.trim().toLowerCase()

  const filteredPlaylists = useMemo(() =>
    q ? playlists.filter((p) => p.title.toLowerCase().includes(q)) : playlists,
    [playlists, q])

  // Combine user templates + system presets into one "Templates" list
  const allTemplates = useMemo(() => [
    ...systemPresets.map((m) => ({ ...m, _system: true })),
    ...savedMixes.map((m) => ({ ...m, _system: false })),
  ], [systemPresets, savedMixes])

  const filteredTemplates = useMemo(() =>
    q ? allTemplates.filter((m) => m.name.toLowerCase().includes(q)) : allTemplates,
    [allTemplates, q])

  const filteredSessions = useMemo(() =>
    q ? mixSessions.filter((s) => s.name.toLowerCase().includes(q)) : mixSessions,
    [mixSessions, q])

  const filteredMixes = useMemo(() => {
    const mixes = recentMixes.map((p) => ({ filePath: p, name: p.split('/').pop()?.replace(/\.limina$/, '') ?? p }))
    return q ? mixes.filter((m) => m.name.toLowerCase().includes(q)) : mixes
  }, [recentMixes, q])

  // ---- actions ----

  const cancelOpen = useCallback(() => {
    cancelledRef.current = true
    setOpening(false)
  }, [])

  const openTemplateInMix = useCallback(async (mix: SavedMix & { _system?: boolean }) => {
    const st = useLibraryStore.getState()
    const byId = new Map(st.files.map((f) => [f.id, f]))
    const items: MixItem[] = []
    const used = new Set<string>()
    for (const item of mix.queue) {
      if (item.kind === 'track') {
        const f = byId.get(item.fileId)
        if (f?.filePath && !used.has(f.id)) { items.push({ file: f }); used.add(f.id) }
      } else {
        const ids = materializeGroup(item.tags, item.matchMode, item.feel, item.durationMin != null ? 300 : 15, used)
        const targetMs = (item.durationMin ?? 0) * 60000
        let accMs = 0
        for (const id of ids) {
          if (item.durationMin != null && accMs >= targetMs) break
          const f = byId.get(id)
          if (!f?.filePath || used.has(f.id)) continue
          items.push({ file: f }); used.add(f.id); accMs += (f.duration || 0) * 1000
        }
      }
    }
    if (items.length === 0) return
    cancelledRef.current = false
    setOpening(true)
    try {
      const built = await buildTwoTrackMix(items)
      if (!cancelledRef.current) requestOpen('mix', () => openInMix(JSON.stringify(built)))
    } finally { setOpening(false) }
  }, [])

  const openSessionInMix = useCallback(async (session: MixSession) => {
    const byId = new Map(useLibraryStore.getState().files.map((f) => [f.id, f]))
    const pairs = session.played
      .map((p) => {
        const file = byId.get(p.fileId)
        return file?.filePath ? { item: { file, title: p.title, artist: p.artist } as MixItem, played: p } : null
      })
      .filter((x): x is { item: MixItem; played: (typeof session.played)[number] } => x !== null)
    if (pairs.length === 0) return
    cancelledRef.current = false
    setOpening(true)
    try {
      const built = await buildTwoTrackMixFromRecording(
        pairs.map((x) => x.item),
        pairs.map((x) => x.played),
      )
      if (!cancelledRef.current) requestOpen('mix', () => openInMix(JSON.stringify(built)))
    } finally { setOpening(false) }
  }, [])

  const openMixFile = useCallback(async (filePath: string) => {
    cancelledRef.current = false
    setOpening(true)
    try {
      const result = await window.electronAPI.openRecentSession(filePath)
      if (result && !cancelledRef.current) requestOpen('mix', () => openInMix(result.json))
    } finally { setOpening(false) }
  }, [])

  const openSessionInSessionMode = useCallback((session: MixSession) => {
    requestNavigate(() => {
      loadSession(session.id)
      const e = getMixEngine()
      e.xfadeMs = session.skeleton.mixFadeMs
      e.play()
      enterMixMode()
      setSurface('library')
    }, 'session')
  }, [loadSession, enterMixMode, setSurface])

  const openTemplateInSessionMode = useCallback((mix: SavedMix) => {
    requestNavigate(() => {
      requestOpen('session', () => {
        loadMix(mix.id)
        enterMixMode()
        setSurface('library')
      })
    }, 'session')
  }, [loadMix, enterMixMode, setSurface])

  // ---- detail panels ----

  const selTemplate = useMemo(() =>
    sel?.kind === 'template' ? allTemplates.find((m) => m.id === sel.id) ?? null : null,
    [sel, allTemplates])

  const selSession = useMemo(() =>
    sel?.kind === 'session' ? mixSessions.find((s) => s.id === sel.id) ?? null : null,
    [sel, mixSessions])

  const selMixPath = sel?.kind === 'mix' ? sel.filePath : null

  return (
    <div className="flex flex-col h-full text-gray-200 bg-surface-base">
      <div className="h-7 shrink-0 bg-surface-panel" style={drag} />

      <div className="flex items-center justify-between h-10 px-3 border-b shrink-0 bg-surface-panel border-surface-border" style={drag}>
        <div className="flex items-center gap-2" style={noDrag}>
          <button type="button" onClick={() => setSurface('home')} title="Back to Home"
            className="flex items-center justify-center w-6 h-6 text-gray-400 transition-colors border rounded bg-surface-hover hover:bg-surface-border border-surface-border">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
            </svg>
          </button>
          <WorkspaceSwitcher />
        </div>
        <div className="flex items-center gap-2" style={noDrag}>
          <GlobalControls />
        </div>
      </div>

      {/* Collections body */}
      <div className="flex flex-1 min-h-0">
        {/* Left: grouped index */}
        <div className="flex flex-col w-64 min-h-0 border-r shrink-0 border-surface-border">
          {/* Filter */}
          <div data-tour="collections-filter" className="flex items-center gap-1.5 px-2 py-1.5 border-b border-surface-border shrink-0 bg-surface-panel">
            <svg className="w-3 h-3 text-gray-600 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5" cy="5" r="3.5" /><path d="M8 8l2.5 2.5" />
            </svg>
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter collections…"
              className="flex-1 min-w-0 bg-transparent text-[11px] text-gray-300 placeholder-gray-700 outline-none" />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="text-gray-600 hover:text-gray-400 shrink-0">
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
              </button>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto bg-surface-panel">
            {/* MFB Playlists */}
            {(!q || filteredPlaylists.length > 0) && (
              <div data-tour="collections-playlists">
                <Section label="Music for Breathwork Playlists" count={filteredPlaylists.length} defaultOpen={false}>
                  {!userAccount ? (
                    <p className="px-3 pb-2 text-[10px] text-gray-600">Sign in to see your playlists.</p>
                  ) : filteredPlaylists.length === 0 ? (
                    <p className="px-3 pb-2 text-[10px] text-gray-600">No playlists found.</p>
                  ) : filteredPlaylists.map((p) => {
                    const total = p.trackIds?.length ?? 0
                    const present = (p.trackIds ?? []).filter((id) => matchedMfbIds.has(id)).length
                    return (
                      <SidebarItem key={p.id} label={p.title} sub={`${present}/${total} tracks`}
                        active={sel?.kind === 'playlist' && sel.id === p.id}
                        onClick={() => setSel({ kind: 'playlist', id: p.id })} />
                    )
                  })}
                </Section>
              </div>
            )}

            {/* Session Templates */}
            {(!q || filteredTemplates.length > 0) && (
              <div data-tour="collections-templates">
                <Section label="Session Templates" count={filteredTemplates.length} defaultOpen={false}>
                  {filteredTemplates.length === 0 ? (
                    <p className="px-3 pb-2 text-[10px] text-gray-600">No templates saved yet.</p>
                  ) : filteredTemplates.map((m) => (
                    <SidebarItem key={m.id} label={m.name}
                      sub={`${m.queue.length} queue item${m.queue.length !== 1 ? 's' : ''}${m._system ? ' · system' : ''}`}
                      active={sel?.kind === 'template' && sel.id === m.id}
                      onClick={() => setSel({ kind: 'template', id: m.id })} />
                  ))}
                </Section>
              </div>
            )}

            {/* Recorded Sessions */}
            {(!q || filteredSessions.length > 0) && (
              <div data-tour="collections-sessions">
                <Section label="Recorded Sessions" count={filteredSessions.length} defaultOpen={false}>
                  {filteredSessions.length === 0 ? (
                    <p className="px-3 pb-2 text-[10px] text-gray-600">No sessions recorded yet.</p>
                  ) : filteredSessions.map((s) => (
                    <SidebarItem key={s.id} label={s.name}
                      sub={`${new Date(s.startedAt).toLocaleDateString()} · ${fmtDuration(s.durationMs)} · ${s.played.length} tracks`}
                      active={sel?.kind === 'session' && sel.id === s.id}
                      onClick={() => setSel({ kind: 'session', id: s.id })} />
                  ))}
                </Section>
              </div>
            )}

            {/* Recent Mixes */}
            {(!q || filteredMixes.length > 0) && (
              <div data-tour="collections-mixes">
                <Section label="Recent Mixes" count={filteredMixes.length} defaultOpen={false}>
                  {filteredMixes.length === 0 ? (
                    <p className="px-3 pb-2 text-[10px] text-gray-600">No recent mixes.</p>
                  ) : filteredMixes.map(({ filePath, name }) => (
                    <SidebarItem key={filePath} label={name}
                      sub={filePath.replace(/^.*\/([^/]+\/[^/]+)$/, '…/$1')}
                      active={sel?.kind === 'mix' && sel.filePath === filePath}
                      onClick={() => setSel({ kind: 'mix', filePath })} />
                  ))}
                </Section>
              </div>
            )}
          </div>
        </div>

        {/* Right: detail panel */}
        <div data-tour="collections-detail" className="flex flex-1 min-w-0">
          {sel?.kind === 'playlist' ? (
            selectedPlaylistId !== null ? <PlaylistPanel /> : null
          ) : sel?.kind === 'template' && selTemplate ? (
            <TemplateDetail
              mix={selTemplate}
              opening={opening}
              onOpenInMix={() => openTemplateInMix(selTemplate)}
              onOpenInSession={() => openTemplateInSessionMode(selTemplate)}
              onDelete={() => { deleteMix(selTemplate.id); setSel(null) }}
              onCancelOpen={cancelOpen}
            />
          ) : sel?.kind === 'session' && selSession ? (
            <SessionDetail
              session={selSession}
              opening={opening}
              onLoadPlay={() => openSessionInSessionMode(selSession)}
              onOpenInMix={() => openSessionInMix(selSession)}
              onDelete={() => { deleteMixSession(selSession.id); setSel(null) }}
              onCancelOpen={cancelOpen}
            />
          ) : sel?.kind === 'mix' && selMixPath ? (
            <MixDetail
              filePath={selMixPath}
              opening={opening}
              onOpen={() => openMixFile(selMixPath)}
              onCancelOpen={cancelOpen}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-[11px] text-gray-600 select-none">
              Select a collection
            </div>
          )}
        </div>
      </div>

      <PlayerBar />
      <SessionTransportBar />
      {tourOpen && <GuidedTour steps={COLLECTIONS_STEPS} onClose={closeTour} />}
    </div>
  )
}

// ---- shared helpers ----

function fmtSecs(s: number): string {
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`
}

function TrackThumb({
  albumImageUrl, isPreviewing, canPreview, onToggle,
}: {
  albumImageUrl?: string | null
  isPreviewing: boolean
  canPreview: boolean
  onToggle: (e: React.MouseEvent) => void
}): JSX.Element {
  return (
    <div className="relative w-5 h-5 overflow-hidden rounded shrink-0 bg-surface-hover">
      {albumImageUrl ? (
        <img src={albumImageUrl} alt="" className={`object-cover w-full h-full transition-opacity ${isPreviewing ? 'opacity-60' : 'opacity-100 group-hover:opacity-60'}`} />
      ) : null}
      {canPreview && (
        <button type="button" onClick={onToggle}
          className={`absolute inset-0 flex items-center justify-center transition-all ${
            albumImageUrl
              ? isPreviewing ? 'text-white opacity-100' : 'text-white opacity-0 group-hover:opacity-100'
              : isPreviewing ? 'rounded-full border border-accent text-accent opacity-100' : 'rounded-full border border-gray-600 text-gray-600 hover:border-accent hover:text-accent opacity-0 group-hover:opacity-100'
          }`}>
          {isPreviewing
            ? <svg className="w-2 h-2" viewBox="0 0 8 8" fill="currentColor"><rect x="0.5" y="0" width="2.5" height="8" rx="0.5" /><rect x="5" y="0" width="2.5" height="8" rx="0.5" /></svg>
            : <svg className="w-2 h-2" viewBox="0 0 8 8" fill="currentColor"><path d="M1 0.5l6.5 3.5L1 7.5V0.5z" /></svg>}
        </button>
      )}
    </div>
  )
}

function OpenInMixBtn({
  opening, disabled, onOpen, onCancel,
}: {
  opening: boolean
  disabled?: boolean
  onOpen: () => void
  onCancel: () => void
}): JSX.Element {
  if (opening) return (
    <span className="flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] text-accent/60 border border-accent/20 bg-accent/5 rounded">
        <svg className="w-2.5 h-2.5 animate-spin shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 1v2M6 9v2M1 6h2M9 6h2" /></svg>
        Opening…
      </span>
      <button type="button" onClick={onCancel}
        className="px-2 py-1 text-[10px] text-gray-400 border border-surface-border rounded hover:text-gray-200 hover:bg-surface-hover transition-colors">
        Cancel
      </button>
    </span>
  )
  return (
    <button type="button" onClick={onOpen} disabled={disabled}
      className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] text-accent border border-accent/40 bg-accent/10 rounded hover:bg-accent/20 transition-colors disabled:opacity-40">
      <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M1 3h10M1 6h10M1 9h6" /></svg>
      Open in Mix
    </button>
  )
}

// ---- Template detail ----

function TemplateDetail({
  mix, opening, onOpenInMix, onOpenInSession, onDelete, onCancelOpen,
}: {
  mix: SavedMix & { _system?: boolean }
  opening: boolean
  onOpenInMix: () => void
  onOpenInSession: () => void
  onDelete: () => void
  onCancelOpen: () => void
}): JSX.Element {
  const files = useLibraryStore((s) => s.files)
  const previewFileId = useLibraryStore((s) => s.previewFileId)
  const setPreview = useLibraryStore((s) => s.setPreview)
  const fileById = useMemo(() => new Map(files.map((f) => [f.id, f])), [files])

  // Build a preview queue from all resolved track items
  const previewQueue = useMemo(() =>
    mix.queue
      .filter((item): item is Extract<MixQueueItem, { kind: 'track' }> => item.kind === 'track')
      .map((item) => item.fileId)
      .filter((id) => fileById.has(id)),
    [mix.queue, fileById])

  const trackCount = mix.queue.filter((q) => q.kind === 'track').length
  const genCount = mix.queue.filter((q) => q.kind === 'tags').length

  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0 border-surface-border bg-surface-panel">
        <div className="flex flex-col flex-1 min-w-0">
          <h2 className="text-[12px] font-semibold text-gray-200 truncate">{mix.name}</h2>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[10px] text-gray-500 tabular-nums">
              {mix.queue.length} item{mix.queue.length !== 1 ? 's' : ''}
              {trackCount > 0 && ` · ${trackCount} track${trackCount !== 1 ? 's' : ''}`}
              {genCount > 0 && ` · ${genCount} generator${genCount !== 1 ? 's' : ''}`}
            </span>
            <span className="text-[10px] text-gray-600 tabular-nums">{Math.round(mix.mixFadeMs / 1000)}s xfade</span>
            {mix._system && <span className="text-[10px] text-gray-600">System preset</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button type="button" onClick={onOpenInSession}
            className="px-2.5 py-1 text-[10px] text-gray-300 border border-surface-border rounded hover:border-accent/50 hover:text-white transition-colors">
            Load in Session
          </button>
          <OpenInMixBtn opening={opening} onOpen={onOpenInMix} onCancel={onCancelOpen} />
          {!mix._system && (
            <button type="button" onClick={onDelete} title="Delete template"
              className="ml-1 text-gray-600 transition-colors hover:text-red-400">
              <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 3h8M4.5 3V2h3v1M4 3v6M6 3v6M8 3v6M3 3l.5 7h5l.5-7" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-2 px-3 h-7 border-b shrink-0 border-surface-border bg-surface-panel text-[10px] uppercase tracking-wider text-gray-600 select-none">
        <span className="w-5 text-center shrink-0">#</span>
        <span className="w-5 shrink-0" />
        <span className="flex-1 min-w-0">Track / Generator</span>
        <span className="w-12 text-right shrink-0">Duration</span>
      </div>

      {/* Rows */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {mix.queue.length === 0 ? (
          <p className="px-4 py-6 text-[11px] text-gray-600 text-center">Empty queue.</p>
        ) : mix.queue.map((item, i) => {
          if (item.kind === 'track') {
            const f = fileById.get(item.fileId)
            const isPreviewing = f != null && previewFileId === f.id
            return (
              <div key={item.id ?? i}
                className="flex items-center gap-2 px-3 transition-colors border-b group border-surface-border/50 hover:bg-surface-hover"
                style={{ minHeight: 36 }}>
                <span className="w-5 shrink-0 text-center text-[10px] text-gray-600 tabular-nums">{i + 1}</span>
                <TrackThumb
                  albumImageUrl={f?.albumImageUrl}
                  isPreviewing={isPreviewing}
                  canPreview={f != null}
                  onToggle={(e) => {
                    e.stopPropagation()
                    if (isPreviewing) setPreview(null, [])
                    else if (f) setPreview(f.id, previewQueue)
                  }}
                />
                <div className="flex flex-col flex-1 min-w-0 py-1.5">
                  <span className="text-[11px] text-gray-200 truncate leading-tight">
                    {f ? (f.trackTitle || f.fileName) : <span className="italic text-gray-600">Unknown track</span>}
                  </span>
                  {f?.artist && <span className="text-[10px] text-gray-500 truncate leading-tight">{f.artist}</span>}
                </div>
                <span className="w-12 text-right text-[10px] text-gray-600 tabular-nums shrink-0">
                  {f?.duration ? fmtSecs(f.duration) : '—'}
                </span>
              </div>
            )
          }
          // Tag generator
          return (
            <div key={item.id ?? i}
              className="flex items-center gap-2 px-3 border-b group border-surface-border/50 hover:bg-surface-hover"
              style={{ minHeight: 36 }}>
              <span className="w-5 shrink-0 text-center text-[10px] text-gray-600 tabular-nums">{i + 1}</span>
              {/* Tag icon placeholder */}
              <div className="flex items-center justify-center w-5 h-5 rounded shrink-0 bg-accent/10">
                <svg className="w-2.5 h-2.5 text-accent" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M1 3h8M1 5.5h6M1 8h4" /></svg>
              </div>
              <div className="flex flex-col flex-1 min-w-0 py-1.5">
                <span className="text-[11px] text-accent truncate leading-tight">
                  [{item.tags.length > 0 ? item.tags.join(', ') : 'any tag'}]
                </span>
                <span className="text-[10px] text-gray-600 leading-tight">
                  {item.matchMode === 'all' ? 'match all' : 'match any'}
                  {item.durationMin != null && ` · ${item.durationMin}m`}
                </span>
              </div>
              <span className="w-12 text-right text-[10px] text-gray-600 tabular-nums shrink-0">
                {item.durationMin != null ? `${item.durationMin}m` : '—'}
              </span>
            </div>
          )
        })}
        {mix.mixTailTags && (
          <div className="px-3 py-2 text-[10px] text-gray-600">
            then: random from [{mix.mixTailTags.join(', ')}]
          </div>
        )}
      </div>
    </div>
  )
}

// ---- Session detail ----

function SessionDetail({
  session, opening, onLoadPlay, onOpenInMix, onDelete, onCancelOpen,
}: {
  session: MixSession
  opening: boolean
  onLoadPlay: () => void
  onOpenInMix: () => void
  onDelete: () => void
  onCancelOpen: () => void
}): JSX.Element {
  const files = useLibraryStore((s) => s.files)
  const previewFileId = useLibraryStore((s) => s.previewFileId)
  const setPreview = useLibraryStore((s) => s.setPreview)
  const saveSessionAsTemplate = useLibraryStore((s) => s.saveSessionAsTemplate)
  const fileById = useMemo(() => new Map(files.map((f) => [f.id, f])), [files])

  const [copied, setCopied] = useState(false)
  const [naming, setNaming] = useState(false)
  const [templateName, setTemplateName] = useState('')

  const copyTracklist = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sessionToText(session))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }, [session])

  const previewQueue = useMemo(() =>
    session.played.map((p) => p.fileId).filter((id) => fileById.has(id)),
    [session.played, fileById])

  type Row =
    | { atMs: number; kind: 'track'; fileId: string; title: string; artist: string; fadeInMs: number; startMs: number; playedMs: number; ended: string | null }
    | { atMs: number; kind: 'edit'; summary: string }

  const timeline = useMemo((): Row[] => {
    const rows: Row[] = [
      ...session.played.map((p): Row => ({
        atMs: p.atMs, kind: 'track', fileId: p.fileId, title: p.title, artist: p.artist,
        fadeInMs: p.fadeInMs ?? 0, startMs: p.startMs ?? 0, playedMs: p.playedMs, ended: p.ended,
      })),
      ...session.edits.map((e): Row => ({ atMs: e.atMs, kind: 'edit', summary: e.summary })),
    ]
    return rows.sort((a, b) => a.atMs - b.atMs)
  }, [session])

  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0 border-surface-border bg-surface-panel">
        <div className="flex flex-col flex-1 min-w-0">
          <h2 className="text-[12px] font-semibold text-gray-200 truncate">{session.name}</h2>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[10px] text-gray-500 tabular-nums">
              {new Date(session.startedAt).toLocaleDateString()} · {fmtDuration(session.durationMs)} · {session.played.length} tracks
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button type="button" onClick={onLoadPlay} disabled={session.played.length === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] text-accent border border-accent/40 bg-accent/10 rounded hover:bg-accent/20 transition-colors disabled:opacity-40">
            <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor"><path d="M2 1.5l7 3.5-7 3.5V1.5z" /></svg>
            Load &amp; play
          </button>
          <OpenInMixBtn opening={opening} disabled={session.played.length === 0} onOpen={onOpenInMix} onCancel={onCancelOpen} />
          <button type="button" onClick={copyTracklist}
            className="px-2.5 py-1 text-[10px] text-gray-300 border border-surface-border rounded hover:border-accent/50 hover:text-white transition-colors">
            {copied ? 'Copied ✓' : 'Export tracklist'}
          </button>
          {naming ? (
            <span className="flex items-center gap-1">
              <input autoFocus value={templateName} onChange={(e) => setTemplateName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && templateName.trim()) { saveSessionAsTemplate(session.id, templateName.trim()); setNaming(false) } else if (e.key === 'Escape') setNaming(false) }}
                placeholder="Template name…"
                className="w-28 bg-surface-hover border border-surface-border rounded px-1.5 py-1 text-[10px] text-gray-200 placeholder-gray-600 outline-none focus:border-accent/50" />
              <button type="button" onMouseDown={(e) => { e.preventDefault(); if (templateName.trim()) { saveSessionAsTemplate(session.id, templateName.trim()); setNaming(false) } }}
                className="text-[10px] text-accent hover:text-accent/80 transition-colors">Save</button>
            </span>
          ) : (
            <button type="button" onClick={() => { setNaming(true); setTemplateName(`${session.name} (template)`) }}
              className="px-2.5 py-1 text-[10px] text-gray-300 border border-surface-border rounded hover:border-accent/50 hover:text-white transition-colors">
              Save as template
            </button>
          )}
          <button type="button" onClick={onDelete} title="Delete session"
            className="ml-1 text-gray-600 transition-colors hover:text-red-400">
            <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 3h8M4.5 3V2h3v1M4 3v6M6 3v6M8 3v6M3 3l.5 7h5l.5-7" /></svg>
          </button>
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-2 px-3 h-7 border-b shrink-0 border-surface-border bg-surface-panel text-[10px] uppercase tracking-wider text-gray-600 select-none">
        <span className="w-12 text-right shrink-0">Time</span>
        <span className="w-5 shrink-0" />
        <span className="flex-1 min-w-0">Track</span>
        <span className="text-right w-14 shrink-0">Played</span>
      </div>

      {/* Rows */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {timeline.length === 0 ? (
          <p className="px-4 py-6 text-[11px] text-gray-600 text-center">Nothing captured in this session.</p>
        ) : timeline.map((r, i) => {
          if (r.kind === 'edit') {
            return (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-border/30">
                <span className="w-12 text-right font-mono text-[10px] text-gray-600 tabular-nums shrink-0">{fmtClock(r.atMs)}</span>
                <span className="w-5 shrink-0" />
                <span className="flex-1 min-w-0 text-[10px] text-gray-500 italic truncate">· {r.summary}</span>
              </div>
            )
          }
          const f = fileById.get(r.fileId)
          const isPreviewing = f != null && previewFileId === f.id
          return (
            <div key={i}
              className="flex items-center gap-2 px-3 transition-colors border-b group border-surface-border/50 hover:bg-surface-hover"
              style={{ minHeight: 44 }}>
              {/* Timeline marker */}
              <span className="w-12 text-right font-mono text-[10px] text-gray-500 tabular-nums shrink-0">{fmtClock(r.atMs)}</span>
              <TrackThumb
                albumImageUrl={f?.albumImageUrl}
                isPreviewing={isPreviewing}
                canPreview={f != null}
                onToggle={(e) => {
                  e.stopPropagation()
                  if (isPreviewing) setPreview(null, [])
                  else if (f) setPreview(f.id, previewQueue)
                }}
              />
              <div className="flex flex-col flex-1 min-w-0 py-1.5">
                <span className="text-[11px] text-gray-200 truncate leading-tight">{r.title}</span>
                <span className="flex items-center gap-2 text-[10px] text-gray-500 leading-tight mt-0.5">
                  {r.artist && <span className="truncate">{r.artist}</span>}
                  {r.fadeInMs > 0 && (
                    <span className="flex items-center gap-0.5 text-accent/70 shrink-0">
                      <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 8V9 M3.5 6V9 M6 3.5V9 M8.5 1V9" /></svg>
                      {fadeSecs(r.fadeInMs)} xfade
                    </span>
                  )}
                  {r.ended === 'skip' && <span className="text-gray-600 shrink-0">skipped</span>}
                </span>
              </div>
              <span className="w-14 text-right text-[10px] text-gray-600 tabular-nums shrink-0">
                {r.playedMs > 0 ? fmtSecs(r.playedMs / 1000) : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---- Mix file detail ----

interface LiminaClip {
  id: string
  filePath: string
  fileName: string
  startTime: number
  duration: number
  trimStart: number
  trimEnd: number
  fadeIn: number
  fadeOut: number
  mfbTrackTitle?: string | null
  mfbArtist?: string | null
  mfbAlbumImageUrl?: string | null
}

function MixDetail({
  filePath, opening, onOpen, onCancelOpen,
}: {
  filePath: string
  opening: boolean
  onOpen: () => void
  onCancelOpen: () => void
}): JSX.Element {
  const name = filePath.split('/').pop()?.replace(/\.limina$/, '') ?? filePath
  const dir = filePath.split('/').slice(0, -1).join('/')
  const files = useLibraryStore((s) => s.files)
  const previewFileId = useLibraryStore((s) => s.previewFileId)
  const setPreview = useLibraryStore((s) => s.setPreview)

  const setSurface = useUIStore((s) => s.setSurface)
  const enterMixMode = useLibraryStore((s) => s.enterMixMode)
  const clearQueue = useLibraryStore((s) => s.clearQueue)
  const addQueueTrack = useLibraryStore((s) => s.addQueueTrack)

  const [clips, setClips] = useState<LiminaClip[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setClips([])
    setLoading(true)
    window.electronAPI.openRecentSession(filePath)
      .then((result) => {
        if (!result) return
        const data = JSON.parse(result.json) as { clips?: LiminaClip[] }
        const sorted = (data.clips ?? []).slice().sort((a, b) => a.startTime - b.startTime)
        setClips(sorted)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [filePath])

  // Match clips to library files by path for preview support
  const fileByPath = useMemo(() => new Map(files.map((f) => [f.filePath, f])), [files])
  const previewQueue = useMemo(() =>
    clips.map((c) => fileByPath.get(c.filePath)?.id).filter((id): id is string => id != null),
    [clips, fileByPath])

  const effectiveDuration = (c: LiminaClip): number => c.duration - c.trimStart - c.trimEnd

  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0 border-surface-border bg-surface-panel">
        <div className="flex flex-col flex-1 min-w-0">
          <h2 className="text-[12px] font-semibold text-gray-200 truncate">{name}</h2>
          <div className="flex items-center gap-3 mt-0.5">
            {loading
              ? <span className="text-[10px] text-gray-600">Loading…</span>
              : <span className="text-[10px] text-gray-500 tabular-nums">{clips.length} clip{clips.length !== 1 ? 's' : ''}</span>}
            <span className="text-[10px] text-gray-600 truncate">{dir}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button type="button" onClick={() => window.electronAPI.showInFolder(filePath)}
            className="px-2.5 py-1 text-[10px] text-gray-300 border border-surface-border rounded hover:border-accent/50 hover:text-white transition-colors">
            Show in Folder
          </button>
          <button
            type="button"
            disabled={clips.length === 0 || previewQueue.length === 0}
            onClick={() => {
              requestNavigate(() => {
                requestOpen('session', () => {
                  clearQueue()
                  previewQueue.forEach((id) => addQueueTrack(id))
                  enterMixMode()
                  setSurface('library')
                })
              }, 'session')
            }}
            className="px-2.5 py-1 text-[10px] text-gray-300 border border-surface-border rounded hover:border-accent/50 hover:text-white transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            Open in Session
          </button>
          <OpenInMixBtn opening={opening} onOpen={onOpen} onCancel={onCancelOpen} />
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-2 px-3 h-7 border-b shrink-0 border-surface-border bg-surface-panel text-[10px] uppercase tracking-wider text-gray-600 select-none">
        <span className="w-12 text-right shrink-0">Start</span>
        <span className="w-5 shrink-0" />
        <span className="flex-1 min-w-0">Track</span>
        <span className="w-12 text-right shrink-0">Length</span>
      </div>

      {/* Clip rows */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <svg className="w-4 h-4 text-gray-600 animate-spin" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 1v2M6 9v2M1 6h2M9 6h2" strokeLinecap="round" /></svg>
          </div>
        ) : clips.length === 0 ? (
          <p className="px-4 py-6 text-[11px] text-gray-600 text-center">No clips found.</p>
        ) : clips.map((c, i) => {
          const libFile = fileByPath.get(c.filePath)
          const isPreviewing = libFile != null && previewFileId === libFile.id
          const title = c.mfbTrackTitle || c.fileName
          const artist = c.mfbArtist
          const dur = effectiveDuration(c)
          return (
            <div key={c.id ?? i}
              className="flex items-center gap-2 px-3 transition-colors border-b group border-surface-border/50 hover:bg-surface-hover"
              style={{ minHeight: 44 }}>
              {/* Timeline start position */}
              <span className="w-12 text-right font-mono text-[10px] text-gray-500 tabular-nums shrink-0">
                {fmtClock(c.startTime * 1000)}
              </span>
              <TrackThumb
                albumImageUrl={c.mfbAlbumImageUrl}
                isPreviewing={isPreviewing}
                canPreview={libFile != null}
                onToggle={(e) => {
                  e.stopPropagation()
                  if (isPreviewing) setPreview(null, [])
                  else if (libFile) setPreview(libFile.id, previewQueue)
                }}
              />
              <div className="flex flex-col flex-1 min-w-0 py-1.5">
                <span className="text-[11px] text-gray-200 truncate leading-tight">{title}</span>
                <span className="flex items-center gap-2 text-[10px] text-gray-500 leading-tight mt-0.5">
                  {artist && <span className="truncate">{artist}</span>}
                  {c.fadeIn > 0 && (
                    <span className="flex items-center gap-0.5 text-accent/70 shrink-0">
                      <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 8V9 M3.5 6V9 M6 3.5V9 M8.5 1V9" /></svg>
                      {fmtSecs(c.fadeIn)} in
                    </span>
                  )}
                  {c.fadeOut > 0 && (
                    <span className="flex items-center gap-0.5 text-accent/70 shrink-0">
                      <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1V9 M3.5 3.5V9 M6 6V9 M8.5 8V9" /></svg>
                      {fmtSecs(c.fadeOut)} out
                    </span>
                  )}
                </span>
              </div>
              <span className="w-12 text-right text-[10px] text-gray-600 tabular-nums shrink-0">
                {fmtSecs(dur)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
