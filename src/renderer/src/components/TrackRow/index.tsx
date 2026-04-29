import { useSessionStore } from '../../store/sessionStore'
import { useTransportStore } from '../../store/transportStore'
import { WaveformDisplay } from '../WaveformDisplay'
import type { Track } from '../../types'

interface Props {
  track: Track
}

export function TrackRow({ track }: Props): JSX.Element {
  const waveformData = useSessionStore((s) => s.waveforms[track.id])
  const clips = useSessionStore((s) => s.clips.filter((c) => c.trackId === track.id))
  const removeTrack = useSessionStore((s) => s.removeTrack)
  const updateTrack = useSessionStore((s) => s.updateTrack)
  const playhead = useTransportStore((s) => s.playhead)

  const clip = clips[0] // Phase 1: one clip per track
  const duration = clip?.duration ?? 0

  return (
    <div className="flex items-stretch border-b border-surface-border" style={{ height: '96px' }}>
      {/* Track header */}
      <div
        className="flex flex-col justify-between shrink-0 w-44 px-3 py-2 bg-surface-panel border-r border-surface-border"
        style={{ borderLeft: `3px solid ${track.color}` }}
      >
        <div className="flex items-center gap-1">
          <span
            className="text-xs font-medium text-gray-300 truncate flex-1"
            title={track.name}
          >
            {track.name}
          </span>
          <button
            onClick={() => removeTrack(track.id)}
            className="text-gray-600 hover:text-red-400 text-xs leading-none px-1"
            title="Remove track"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Mute */}
          <button
            onClick={() => updateTrack(track.id, { muted: !track.muted })}
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded leading-none transition-colors ${
              track.muted
                ? 'bg-yellow-500 text-black'
                : 'bg-surface-hover text-gray-400 hover:text-gray-200'
            }`}
          >
            M
          </button>

          {/* Volume */}
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={track.volume}
            onChange={(e) => updateTrack(track.id, { volume: parseFloat(e.target.value) })}
            className="flex-1 h-1 accent-accent cursor-pointer"
            title={`Volume: ${Math.round(track.volume * 100)}%`}
          />
        </div>
      </div>

      {/* Waveform area */}
      <div className="flex-1 flex items-center px-2 py-2 overflow-hidden">
        {clip ? (
          <WaveformDisplay
            trackId={track.id}
            peaks={waveformData?.peaks ?? []}
            duration={duration}
            color={track.color}
            playhead={playhead}
            loading={waveformData?.loading ?? true}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center h-full text-xs text-gray-600">
            No audio loaded
          </div>
        )}
      </div>
    </div>
  )
}
