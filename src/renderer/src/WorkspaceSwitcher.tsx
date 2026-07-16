import { useEffect, useRef, useState } from 'react'
import { useUIStore } from './uiStore'
import { useLibraryStore } from './library/store/libraryStore'

type Workspace = 'library' | 'session' | 'mix'

const LABELS: Record<Workspace, string> = { library: 'Library', session: 'Session', mix: 'Mix' }
const ORDER: Workspace[] = ['library', 'session', 'mix']

/**
 * Toolbar workspace switcher (sits next to the Home icon in both apps' toolbars).
 * Moves between the three workspaces: Library (browse), Session (Library's
 * Auto-Mix mode), and Mix (the timeline).
 */
export function WorkspaceSwitcher(): JSX.Element {
  const surface = useUIStore((s) => s.surface)
  const setSurface = useUIStore((s) => s.setSurface)
  const mixMode = useLibraryStore((s) => s.mixMode)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const current: Workspace = surface === 'mix' ? 'mix' : mixMode ? 'session' : 'library'

  const goTo = (w: Workspace): void => {
    setOpen(false)
    const lib = useLibraryStore.getState()
    if (w === 'library') { lib.exitMixMode(); setSurface('library') }
    else if (w === 'session') { lib.enterMixMode(); setSurface('library') }
    else setSurface('mix')
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="relative" ref={ref} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Switch workspace"
        className="flex items-center gap-1 text-xs font-semibold tracking-widest text-gray-300 uppercase transition-colors select-none hover:text-white"
      >
        {LABELS[current]}
        <svg className="w-2.5 h-2.5 text-gray-500" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 3.5l3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-[200] mt-1.5 min-w-[130px] rounded border border-surface-border bg-surface-panel shadow-lg py-1">
          {ORDER.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => goTo(w)}
              className={`w-full flex items-center justify-between text-left px-3 py-1.5 text-[11px] tracking-widest uppercase transition-colors ${current === w ? 'text-accent' : 'text-gray-300 hover:bg-surface-hover hover:text-white'}`}
            >
              {LABELS[w]}
              {current === w && (
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-5" /></svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
