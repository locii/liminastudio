import { useCallback } from 'react'
import type React from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { useTransportStore } from '../../store/transportStore'
import { audioEngine } from '../../audio/audioEngine'
import type { Clip } from '../../types'

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`
}

function getSortedBoundaries(clips: Clip[]): number[] {
  const set = new Set(clips.map((c) => Math.round(c.startTime * 100) / 100))
  return [...set].sort((a, b) => a - b)
}

function getEndTime(clips: Clip[]): number {
  if (clips.length === 0) return 0
  return Math.max(...clips.map((c) => c.startTime + c.duration - c.trimStart - c.trimEnd))
}

export function BottomTransport(): JSX.Element {
  const playing = useTransportStore((s) => s.playing)
  const playhead = useTransportStore((s) => s.playhead)
  const looping = useTransportStore((s) => s.looping)
  const toggleLoop = useTransportStore((s) => s.toggleLoop)
  const tracks = useSessionStore((s) => s.tracks)
  const clips = useSessionStore((s) => s.clips)

  const handlePlayStop = useCallback(async () => {
    if (playing) audioEngine.pause()
    else await audioEngine.play(clips, tracks)
  }, [playing, clips, tracks])

  const handleStart = useCallback(() => audioEngine.seek(0), [])

  const handleEnd = useCallback(() => {
    const end = getEndTime(clips)
    if (end > 0) audioEngine.seek(end)
  }, [clips])

  const handlePrev = useCallback(() => {
    const boundaries = getSortedBoundaries(clips)
    const current = audioEngine.getCurrentPosition()
    // Find the last boundary strictly before current position (with 0.2s tolerance)
    const prev = [...boundaries].reverse().find((t) => t < current - 0.2)
    audioEngine.seek(prev ?? 0)
  }, [clips])

  const handleNext = useCallback(() => {
    const boundaries = getSortedBoundaries(clips)
    const current = audioEngine.getCurrentPosition()
    const next = boundaries.find((t) => t > current + 0.2)
    if (next !== undefined) audioEngine.seek(next)
  }, [clips])

  const disabled = tracks.length === 0

  return (
    <div data-tour="bottom-transport" className="shrink-0 flex items-center justify-center gap-1 px-4 py-2 bg-surface-panel border-t border-surface-border">
      {/* Time display — current / total */}
      <span className="font-mono text-sm text-gray-400 tabular-nums mr-4 shrink-0">
        {formatTime(playhead)}
        <span className="text-gray-600 mx-1">/</span>
        <span className="text-gray-500">{formatTime(getEndTime(clips))}</span>
      </span>

      {/* Start */}
      <TransportBtn onClick={handleStart} disabled={disabled} title="Go to start">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
          <rect x="2" y="2" width="2" height="12" rx="0.5" />
          <path d="M6 8l7-4.5v9L6 8z" />
        </svg>
      </TransportBtn>

      {/* Prev clip */}
      <TransportBtn onClick={handlePrev} disabled={disabled} title="Previous clip">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M11 3L4 8l7 5V3z" />
        </svg>
      </TransportBtn>

      {/* Play / Stop */}
      <button
        onClick={handlePlayStop}
        disabled={disabled}
        title={playing ? 'Stop (Space)' : 'Play (Space)'}
        className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors mx-1 ${
          disabled
            ? 'bg-surface-hover text-gray-600 cursor-not-allowed'
            : playing
            ? 'bg-accent text-white hover:bg-accent/80'
            : 'bg-surface-hover hover:bg-accent text-gray-300 hover:text-white'
        }`}
      >
        {playing ? (
          <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="currentColor">
            <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="currentColor">
            <path d="M2.5 2l8 4-8 4V2z" />
          </svg>
        )}
      </button>

      {/* Next clip */}
      <TransportBtn onClick={handleNext} disabled={disabled} title="Next clip">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M5 3l7 5-7 5V3z" />
        </svg>
      </TransportBtn>

      {/* End */}
      <TransportBtn onClick={handleEnd} disabled={disabled} title="Go to end">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
          <rect x="12" y="2" width="2" height="12" rx="0.5" />
          <path d="M10 8L3 3.5v9L10 8z" />
        </svg>
      </TransportBtn>

      {/* Loop toggle */}
      <button
        onClick={toggleLoop}
        className={`ml-4 transition-colors ${looping ? 'text-accent' : 'text-gray-600 hover:text-gray-300'}`}
        title="Loop (L)"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 5.5A4 4 0 016.5 2h1M11.5 8.5A4 4 0 017.5 12h-1M10 1l2 2-2 2M4 9l-2 2 2 2" />
        </svg>
      </button>
    </div>
  )
}

function TransportBtn({
  onClick, disabled, title, children,
}: {
  onClick: () => void
  disabled?: boolean
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
        disabled
          ? 'text-gray-700 cursor-not-allowed'
          : 'text-gray-400 hover:text-white hover:bg-surface-hover'
      }`}
    >
      {children}
    </button>
  )
}
