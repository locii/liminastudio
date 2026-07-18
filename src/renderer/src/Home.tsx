import { useRef, useState } from 'react'
import logo from './mix/assets/limina-logo.png'
import { useUIStore } from './uiStore'
import { useLibraryStore } from './library/store/libraryStore'
import { GlobalControls } from './GlobalControls'
import { requestNavigate } from './navigate'
import { addFolder } from './library/lib/addFolder'
import { useWizardHasFiles, useWizardIsLoggedIn } from './OnboardingWizard'

interface Tile {
  label: string
  desc: string
  icon: JSX.Element
  go: () => void
}

export function Home(): JSX.Element {
  const setSurface = useUIStore((s) => s.setSurface)
  const loginSkipped = useUIStore((s) => s.loginSkipped)
  const setLoginSkipped = useUIStore((s) => s.setLoginSkipped)
  const hasFiles = useWizardHasFiles()
  const isLoggedIn = useWizardIsLoggedIn()

  // Kick off a folder scan, then hand off to the Library so its polished
  // "Setting up your library" progress screen takes over. scanning flips to true
  // synchronously with the surface switch, so the Library never flashes its own
  // empty drop zone first.
  const goAddFolder = async (droppedPath?: string): Promise<void> => {
    const path = droppedPath ?? (await window.electronAPI.libraryPickFolder()) ?? undefined
    if (!path) return
    setSurface('library')
    await addFolder(path)
  }

  const tiles: Tile[] = [
    {
      label: 'Library',
      desc: 'Browse and tag your catalogue and match tracks to Music for Breathwork.',
      go: () => {
        useLibraryStore.getState().exitMixMode()
        setSurface('library')
      },
      icon: (
        <>
          <path d="M4 5h11l3 3v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
          <path d="M7 9h7M7 12h7M7 15h4" />
        </>
      ),
    },
    {
      label: 'Collections',
      desc: 'Browse MFB playlists, session templates, recorded sessions, and saved mixes.',
      go: () => setSurface('playlists'),
      icon: (
        <>
          <path d="M8 6h13M8 12h13M8 18h13" />
          <path d="M3 6h.01M3 12h.01M3 18h.01" />
        </>
      ),
    },
    {
      label: 'Session Mode',
      desc: 'Run a live, tag-driven session with automatic crossfades.',
      go: () => {
        useLibraryStore.getState().enterMixMode()
        setSurface('library')
      },
      icon: (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M10 9l5 3-5 3V9z" />
        </>
      ),
    },
    {
      label: 'Mix Mode',
      desc: 'Arrange tracks on a timeline, set crossfades, and export the full mix.',
      go: () => requestNavigate(() => setSurface('mix'), 'mix'),
      icon: (
        <>
          <path d="M4 8h16M4 12h16M4 16h16" />
          <circle cx="9" cy="8" r="1.6" fill="currentColor" />
          <circle cx="15" cy="12" r="1.6" fill="currentColor" />
          <circle cx="7" cy="16" r="1.6" fill="currentColor" />
        </>
      ),
    },
  ]

  const dragBar = (
    <div className="flex items-center justify-end px-3 h-9 shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <GlobalControls />
    </div>
  )

  // Step 1: sign in to M4B — directive, but skippable.
  if (!isLoggedIn && !loginSkipped) {
    return (
      <div className="flex flex-col h-full text-gray-200 bg-surface-base">
        {dragBar}
        <div className="flex flex-col items-center justify-center flex-1 gap-8 px-8 select-none">
          <div className="flex flex-col items-center gap-3">
            <img src={logo} alt="Limina Studio" className="object-contain w-14 h-14 rounded-xl" draggable={false} />
            <div className="text-center">
              <h2 className="mt-2 text-xl font-semibold text-gray-100">Welcome to Limina Studio</h2>
              <p className="text-[14px] text-gray-500 mt-2 max-w-xs mx-auto leading-relaxed">
                Limina Studio is a library, session player and multi-track mixer for your work with music and expanded states of awareness.
              </p>
            </div>
          </div>
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => {
                useLibraryStore.getState().setShowLoginModal(true)
                setSurface('library')
              }}
              className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white rounded-lg bg-accent hover:bg-accent/80 transition-colors"
            >
             Get Started
            </button>

            <button
              type="button"
              onClick={() => setLoginSkipped(true)}
              className="text-[12px] text-gray-600 hover:text-gray-400 transition-colors"
            >
              Continue without an account →
            </button>

            <p className="text-[12px] text-center text-gray-600 mt-1 max-w-xs mx-auto leading-relaxed">
              Built by the team behind<br />{' '}
              <a target="_blank" className="text-accent hover:underline" href="https://musicforbreathwork.com">
                Music for Breathwork
              </a>.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Step 2: add a folder (no files yet) — a real drop zone.
  if (!hasFiles) {
    return (
      <div className="flex flex-col h-full text-gray-200 bg-surface-base">
        {dragBar}
        <div className="flex flex-col items-center justify-center flex-1 gap-8 px-8 select-none">
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-widest text-accent">Getting started</p>
            <h2 className="mt-2 text-xl font-semibold text-gray-100">Add your music</h2>
            <p className="text-[13px] text-gray-500 mt-2 max-w-sm mx-auto leading-relaxed">
              Point Limina at a folder of audio files. It scans automatically and
              keeps your library in sync.
            </p>
          </div>
          <HomeDropZone onAdd={goAddFolder} />
          <p className="text-[11px] text-gray-700 tracking-wide">
            WAV · MP3 · AIFF · FLAC · M4A · OGG
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full text-gray-200 bg-surface-base">
      <div className="flex items-center justify-end px-3 h-9 shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <GlobalControls />
      </div>
      <div className="flex flex-col items-center justify-center flex-1 gap-10 px-8 select-none">
        <div className="flex flex-col items-center gap-3">
          <img src={logo} alt="Limina Studio" className="object-contain w-20 h-20 rounded-2xl" draggable={false} />
          <div className="text-center">
            <h1 className="text-lg font-semibold tracking-wide text-gray-100">Limina Studio</h1>
            <p className="text-[11px] text-gray-600 mt-0.5">v{__APP_VERSION__} · for breathwork &amp; psychedelic facilitators</p>
          </div>
        </div>
        <div className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
          {tiles.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={t.go}
              className="flex flex-col gap-3 p-5 text-left transition-all border group rounded-xl border-surface-border bg-surface-panel hover:border-accent/60 hover:bg-surface-hover"
            >
              <span className="flex items-center justify-center w-10 h-10 text-gray-400 transition-colors border rounded-lg border-surface-border bg-surface-base group-hover:text-accent group-hover:border-accent/40">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  {t.icon}
                </svg>
              </span>
              <span className="text-sm font-medium text-gray-100">{t.label}</span>
              <span className="text-[11px] leading-relaxed text-gray-500">{t.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Drop-or-click zone for the Home "add your music" step. Mirrors the Library
 *  welcome zone's affordance so the two feel like one product. */
function HomeDropZone({ onAdd }: { onAdd: (path?: string) => void }): JSX.Element {
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  const onDragEnter = (e: React.DragEvent): void => {
    e.preventDefault()
    dragCounterRef.current++
    setIsDragOver(true)
  }
  const onDragOver = (e: React.DragEvent): void => { e.preventDefault() }
  const onDragLeave = (): void => {
    dragCounterRef.current--
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDragOver(false)
    }
  }
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    const path = file && (file as File & { path?: string }).path
    if (path) onAdd(path)
  }

  return (
    <button
      type="button"
      onClick={() => onAdd()}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`w-full max-w-lg flex flex-col items-center gap-4 py-14 px-8 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
        isDragOver
          ? 'border-accent bg-accent/5 text-accent'
          : 'border-surface-border bg-surface-panel hover:border-accent/40 hover:bg-surface-hover text-gray-500 hover:text-gray-400'
      }`}
    >
      <svg className="w-10 h-10 pointer-events-none" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 15a3 3 0 013-3h6l3 3h16a3 3 0 013 3v11a3 3 0 01-3 3H9a3 3 0 01-3-3V15z" />
        <path d="M20 21v7M17 24l3-3 3 3" />
      </svg>
      <div className="text-center pointer-events-none">
        <p className="text-[14px] font-medium text-gray-200">
          {isDragOver ? 'Drop to add folder' : 'Drop a folder here'}
        </p>
        <p className="text-[12px] text-gray-600 mt-1">or click to browse</p>
      </div>
    </button>
  )
}
