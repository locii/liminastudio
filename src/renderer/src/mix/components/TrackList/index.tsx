import { useSessionStore } from '../../store/sessionStore'
import { TrackRow } from '../TrackRow'

export function TrackList(): JSX.Element {
  const tracks = useSessionStore((s) => s.tracks)

  if (tracks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-600">
        <svg
          className="w-12 h-12 opacity-30"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1}
            d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
          />
        </svg>
        <p className="text-sm">Click <span className="text-accent font-medium">Add Track</span> to load audio files</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden">
      {tracks
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((track) => (
          <TrackRow key={track.id} track={track} />
        ))}
    </div>
  )
}
