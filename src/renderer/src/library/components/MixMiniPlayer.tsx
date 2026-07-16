import { useLibraryStore } from '../store/libraryStore'
import { peekMixEngine } from '../lib/mixEngineSingleton'

/**
 * Compact now-playing strip for the top navbar. Visible when the persistent mix
 * engine has a track and the Auto-Mix panel is closed, so playback started in
 * Auto-Mix stays visible/controllable after leaving the section.
 */
export function MixMiniPlayer(): JSX.Element | null {
  const cur = useLibraryStore((s) => s.mixPlayback.current)
  const playing = useLibraryStore((s) => s.mixPlayback.playing)
  const fading = useLibraryStore((s) => s.mixPlayback.fading)
  const mixMode = useLibraryStore((s) => s.mixMode)
  const enterMixMode = useLibraryStore((s) => s.enterMixMode)

  if (mixMode || !cur) return null
  const eng = peekMixEngine()
  const title = cur.trackTitle || cur.fileName

  return (
    <div className="flex items-center gap-1.5 pl-2 pr-1 h-6 rounded border border-surface-border bg-surface-hover">
      <svg className={`w-2.5 h-2.5 shrink-0 text-accent ${fading ? 'animate-pulse' : ''}`} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h2.5a4 4 0 013.2 1.6L9 6.5l1.3 1.9A4 4 0 0013.5 10M2 10h2.5a4 4 0 002.8-1.2M13.5 4h-1.5a4 4 0 00-3.2 1.6" />
      </svg>
      <button type="button" onClick={() => eng?.toggle()} title={playing ? 'Pause' : 'Play'}
        className="w-4 h-4 shrink-0 flex items-center justify-center text-gray-300 hover:text-white transition-colors">
        {playing
          ? <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor"><rect x="1.5" y="1" width="2.5" height="8" rx="0.5" /><rect x="6" y="1" width="2.5" height="8" rx="0.5" /></svg>
          : <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor"><path d="M2 1.5l7 3.5-7 3.5V1.5z" /></svg>}
      </button>
      <button type="button" onClick={() => eng?.next()} title="Next"
        className="w-4 h-4 shrink-0 flex items-center justify-center text-gray-400 hover:text-white transition-colors">
        <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="currentColor"><path d="M10 2h-1.5v8H10zM1.5 2l6 4-6 4V2z" /></svg>
      </button>
      <button type="button" onClick={() => enterMixMode()} title="Open Generate"
        className="text-[10px] text-gray-300 hover:text-white truncate max-w-[180px] transition-colors">
        {title}
      </button>
    </div>
  )
}
