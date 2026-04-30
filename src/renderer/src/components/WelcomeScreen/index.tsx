import { useEffect, useState } from 'react'
import { basename } from '../../utils/path'
import logo from '../../assets/limina-logo.png'
import bgSphere from '../../assets/creamLogo.png'

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
    <div className="flex overflow-hidden relative flex-col flex-1 gap-8 justify-center items-center select-none bg-surface-base">
      {/* Background sphere */}
      <img
        src={bgSphere}
        alt=""
        className="absolute inset-0 w-full h-full object-cover opacity-[0.01] pointer-events-none select-none"
        draggable={false}
      />
      {/* Logo */}


      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onOpen}
          className="px-4 py-2 text-sm font-medium text-white rounded transition-colors bg-accent hover:bg-accent/80"
        >
          Open Session…
        </button>
        <button
          onClick={onNewSession}
          className="px-4 py-2 text-sm text-gray-300 rounded border transition-colors bg-surface-panel border-surface-border hover:bg-surface-hover"
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
              className="px-3 py-2 text-left rounded border transition-colors bg-surface-panel hover:bg-surface-hover border-surface-border group"
            >
              <span className="block text-sm text-gray-300 truncate group-hover:text-white">
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
