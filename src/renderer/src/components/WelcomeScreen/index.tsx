import { useEffect, useState } from 'react'
import { basename } from '../../utils/path'
import logo from '../../assets/limina-logo.png'

interface Props {
  onOpen: () => void
  onOpenRecent: (filePath: string) => void
  onNewSession: () => void
}

export function WelcomeScreen({ onOpen, onOpenRecent, onNewSession }: Props): JSX.Element {
  const [recents, setRecents] = useState<string[]>([])

  useEffect(() => {
    window.electronAPI.getRecentSessions().then(setRecents).catch(() => {})
  }, [])

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-8 bg-surface-base select-none">
      {/* Logo */}
      <img src={logo} alt="Limina Studio" className="w-40 rounded-2xl opacity-90 select-none mt-8" draggable={false} />

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onOpen}
          className="px-4 py-2 rounded bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors"
        >
          Open Session…
        </button>
        <button
          onClick={onNewSession}
          className="px-4 py-2 rounded bg-surface-panel border border-surface-border text-gray-300 text-sm hover:bg-surface-hover transition-colors"
        >
          New Session
        </button>
      </div>

      {/* Recent sessions */}
      {recents.length > 0 && (
        <div className="flex flex-col gap-1 w-72">
          <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Recent</p>
          {recents.map((fp) => (
            <button
              key={fp}
              onClick={() => onOpenRecent(fp)}
              className="text-left px-3 py-2 rounded bg-surface-panel hover:bg-surface-hover border border-surface-border transition-colors group"
            >
              <span className="text-sm text-gray-300 group-hover:text-white truncate block">
                {basename(fp)}
              </span>
              <span className="text-[10px] text-gray-600 truncate block">{fp}</span>
            </button>
          ))}
        </div>
      )}

      <p className="text-[10px] text-gray-700">
        Cmd+S to save · Cmd+O to open · Cmd+T to add a track
      </p>
    </div>
  )
}
