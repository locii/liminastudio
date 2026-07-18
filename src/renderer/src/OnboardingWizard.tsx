import { useState } from 'react'
import { useLibraryStore } from './library/store/libraryStore'
import { useUIStore } from './uiStore'
import { syncLibraryToMfb } from './library/lib/syncLibrary'
import { getMixEngine } from './library/lib/mixEngineSingleton'
import { requestNavigate } from './navigate'

// Onboarding is a set of contextual states rather than a persistent wizard:
//   1. Signed out          → Home shows a directive (skippable) sign-in screen
//   2. Signed in, no files → Home shows a drop zone (see Home.tsx / addFolder)
//   3. Matches ready       → the Library shows <MatchBanner /> below

/** True once the user has at least one watched folder (so the app is "set up"). */
export function useWizardHasFiles(): boolean {
  const watchedFolders = useLibraryStore((s) => s.watchedFolders)
  const devForceEmpty = useUIStore((s) => s.devForceEmpty)
  return watchedFolders.length > 0 && !(import.meta.env.DEV && devForceEmpty)
}

export function useWizardIsLoggedIn(): boolean {
  const userAccount = useLibraryStore((s) => s.userAccount)
  const devForceEmpty = useUIStore((s) => s.devForceEmpty)
  // Dev onboarding preview: pretend we're signed out so the sign-in step shows.
  if (import.meta.env.DEV && devForceEmpty) return false
  return !!userAccount
}

/**
 * Contextual nudge shown in the Library once Music for Breathwork matches are
 * ready to apply. Applying enriches local files with MFB metadata (phase tags,
 * audio features), keeping them in sync with the catalogue. Dismissible — but it
 * returns next session while matches remain unapplied.
 */
export function MatchBanner(): JSX.Element | null {
  const pendingMatches = useLibraryStore((s) => s.pendingMatches)
  const applyAll = useLibraryStore((s) => s.applyAllPendingMatches)
  const count = Object.keys(pendingMatches).length
  const [dismissed, setDismissed] = useState(false)

  if (count === 0 || dismissed) return null

  const label = count.toLocaleString()
  const noun = count === 1 ? 'match' : 'matches'

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b shrink-0 bg-accent/10 border-accent/25">
      <svg className="w-3.5 h-3.5 text-accent shrink-0" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 1.5l1.4 3 3.1.4-2.3 2.1.6 3L7 8.6 4.2 10l.6-3L2.5 4.9l3.1-.4z" />
      </svg>
      <span className="flex-1 text-[11px] text-accent leading-snug truncate">
        <span className="font-semibold">{label} track{count === 1 ? '' : 's'}</span> matched with Music for Breathwork — apply to sync phase tags &amp; audio features to your library.
      </span>
      <button
        type="button"
        onClick={() => { applyAll(); syncLibraryToMfb() }}
        className="px-3 py-1 text-[11px] font-medium text-white rounded shrink-0 bg-accent hover:bg-accent/80 transition-colors"
      >
        Apply {label} {noun}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        title="Dismiss"
        className="p-1 text-accent/60 hover:text-accent transition-colors shrink-0"
      >
        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 2l8 8M10 2l-8 8" />
        </svg>
      </button>
    </div>
  )
}

// --- "Try these next" (Session / Mix mode discovery) ------------------------

const TRIED_SESSION_KEY = 'limina-tried-session'
const TRIED_MIX_KEY = 'limina-tried-mix'
const NEXTSTEPS_DISMISS_KEY = 'limina-nextsteps-dismissed'

function readFlag(k: string): boolean { try { return !!localStorage.getItem(k) } catch { return false } }

/** Record that the user has opened Session / Mix mode (any entry path). Called
 *  from MixPanel / Mix App on mount so the next-steps card retires itself. */
export function markTriedSession(): void { try { localStorage.setItem(TRIED_SESSION_KEY, '1') } catch { /* noop */ } }
export function markTriedMix(): void { try { localStorage.setItem(TRIED_MIX_KEY, '1') } catch { /* noop */ } }

/**
 * Post-setup nudge in the Library pointing a first-time user at the two working
 * modes. Session Mode leads (the daily driver) and pre-seeds a few matched
 * tracks so it plays immediately. Auto-retires once both modes have been opened,
 * or dismissed, or for anyone who already has saved mixes / recorded sessions
 * (i.e. clearly not a newcomer).
 */
export function NextStepsCard(): JSX.Element | null {
  const enterMixMode = useLibraryStore((s) => s.enterMixMode)
  const setSurface = useUIStore((s) => s.setSurface)
  const savedMixes = useLibraryStore((s) => s.savedMixes)
  const mixSessions = useLibraryStore((s) => s.mixSessions)

  const [dismissed, setDismissed] = useState(() => readFlag(NEXTSTEPS_DISMISS_KEY))
  // Read once on mount — the card unmounts whenever a mode is actually entered
  // (mixMode / surface change), so it re-reads fresh state on its next mount.
  const [triedSession] = useState(() => readFlag(TRIED_SESSION_KEY))
  const [triedMix] = useState(() => readFlag(TRIED_MIX_KEY))

  const experienced = savedMixes.length > 0 || mixSessions.length > 0
  if (dismissed || experienced || (triedSession && triedMix)) return null

  const dismiss = (): void => {
    setDismissed(true)
    try { localStorage.setItem(NEXTSTEPS_DISMISS_KEY, '1') } catch { /* noop */ }
  }

  const trySession = (): void => {
    const st = useLibraryStore.getState()
    const playable = st.files.filter((f) => !!f.filePath)
    const matched = playable.filter((f) => f.mfbTrackId != null)
    const pool = matched.length >= 3 ? matched : playable
    if (pool.length > 0) {
      const picks = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(6, pool.length))
      let seq = Date.now()
      useLibraryStore.setState({
        mixQueue: picks.map((f) => ({ id: `mq_${(seq++).toString(36)}`, kind: 'track' as const, fileId: f.id })),
        playedIds: new Set<string>(),
        justLoaded: false,
      })
    }
    markTriedSession()
    enterMixMode()
    // This click is a valid audio gesture — start the session immediately.
    try { getMixEngine().play() } catch { /* engine not ready — user can hit play */ }
  }

  const tryMix = (): void => {
    markTriedMix()
    useUIStore.getState().setMixOpenLibraryOnMount(true)
    requestNavigate(() => setSurface('mix'), 'mix')
  }

  return (
    <div className="px-4 py-3 border-b shrink-0 bg-surface-panel border-surface-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest text-gray-600">You&rsquo;re all set — try these next</span>
        <button type="button" onClick={dismiss} title="Dismiss" className="p-1 text-gray-600 hover:text-gray-400 transition-colors">
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
        </button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <NextStepTile
          onClick={trySession}
          tried={triedSession}
          title="Session Mode"
          desc="Live, tag-driven set with automatic crossfades"
          icon={<><circle cx="12" cy="12" r="9" /><path d="M10 8.5l5 3.5-5 3.5v-7z" fill="currentColor" stroke="none" /></>}
        />
        <NextStepTile
          onClick={tryMix}
          tried={triedMix}
          title="Mix Mode"
          desc="Arrange tracks on a timeline and export the mix"
          icon={<><path d="M4 8h16M4 12h16M4 16h16" /><circle cx="9" cy="8" r="1.6" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="7" cy="16" r="1.6" fill="currentColor" stroke="none" /></>}
        />
      </div>
    </div>
  )
}

function NextStepTile({ onClick, tried, title, desc, icon }: {
  onClick: () => void
  tried: boolean
  title: string
  desc: string
  icon: JSX.Element
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-1 items-center gap-3 p-2.5 text-left transition-colors border rounded-lg border-surface-border bg-surface-base hover:border-accent/50 hover:bg-surface-hover"
    >
      <span className="flex items-center justify-center w-8 h-8 text-gray-400 transition-colors border rounded-lg shrink-0 border-surface-border bg-surface-panel group-hover:text-accent group-hover:border-accent/40">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      </span>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[12px] font-medium text-gray-200">{title}</span>
        <span className="text-[10px] text-gray-500 leading-snug truncate">{desc}</span>
      </div>
      {tried ? (
        <span className="flex items-center gap-1 text-[10px] text-green-400 shrink-0">
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-5.5" /></svg>
          Opened
        </span>
      ) : (
        <span className="text-[10px] text-accent shrink-0 whitespace-nowrap">Try →</span>
      )}
    </button>
  )
}
