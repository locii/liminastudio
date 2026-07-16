import logo from './mix/assets/limina-logo.png'
import { useUIStore, type Surface } from './uiStore'

interface Tile {
  surface: Exclude<Surface, 'home'>
  label: string
  desc: string
  icon: JSX.Element
}

const TILES: Tile[] = [
  {
    surface: 'library',
    label: 'Library',
    desc: 'Browse and tag your catalogue, match tracks to Music for Breathwork, and run tag-driven sessions.',
    icon: (
      <>
        <path d="M4 5h11l3 3v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
        <path d="M7 9h7M7 12h7M7 15h4" />
      </>
    ),
  },
  {
    surface: 'mix',
    label: 'Mix',
    desc: 'Arrange tracks on a timeline, set crossfades, run the session, and export the full mix.',
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

/** Umbrella launch screen — pick which app to open. */
export function Home(): JSX.Element {
  const setSurface = useUIStore((s) => s.setSurface)

  return (
    <div className="flex flex-col h-full text-gray-200 bg-surface-base">
      <div className="h-7 shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
      <div className="flex flex-col flex-1 gap-10 justify-center items-center px-8 select-none">
        <div className="flex flex-col gap-3 items-center">
          <img src={logo} alt="Limina Studio" className="object-contain w-20 h-20 rounded-2xl" draggable={false} />
          <div className="text-center">
            <h1 className="text-lg font-semibold tracking-wide text-gray-100">Limina Studio</h1>
            <p className="text-[11px] text-gray-600 mt-0.5">v{__APP_VERSION__} · for breathwork &amp; psychedelic facilitators</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 w-full max-w-2xl sm:grid-cols-2">
          {TILES.map((t) => (
            <button
              key={t.surface}
              type="button"
              onClick={() => setSurface(t.surface)}
              className="group flex flex-col gap-3 p-5 text-left rounded-xl border transition-all border-surface-border bg-surface-panel hover:border-accent/60 hover:bg-surface-hover"
            >
              <span className="flex justify-center items-center w-10 h-10 text-gray-400 rounded-lg border transition-colors border-surface-border bg-surface-base group-hover:text-accent group-hover:border-accent/40">
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
