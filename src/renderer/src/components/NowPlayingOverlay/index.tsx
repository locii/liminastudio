import { useEffect, useState, useCallback } from 'react'
import type { Clip } from '../../types'
import { audioEngine } from '../../audio/audioEngine'
import { useTransportStore } from '../../store/transportStore'
import { useSessionStore } from '../../store/sessionStore'

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

function getSortedBoundaries(clips: Clip[]): number[] {
  const set = new Set(clips.map((c) => Math.round(c.startTime * 100) / 100))
  return [...set].sort((a, b) => a - b)
}

const ACCENT_COLORS = [
  '#6366f1', '#a855f7', '#ec4899', '#f43f5e',
  '#f97316', '#f59e0b', '#22c55e', '#14b8a6', '#06b6d4', '#0ea5e9',
]

function pickColor(clipId: string): string {
  const hash = clipId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return ACCENT_COLORS[hash % ACCENT_COLORS.length]
}

interface Props {
  onClose: () => void
}

export function NowPlayingOverlay({ onClose }: Props): JSX.Element | null {
  const playing = useTransportStore((s) => s.playing)
  const playhead = useTransportStore((s) => s.playhead)
  const clips = useSessionStore((s) => s.clips)
  const tracks = useSessionStore((s) => s.tracks)
  const segments = useSessionStore((s) => s.segments)

  const [imgLoaded, setImgLoaded] = useState(false)

  // Find the clip currently under the playhead
  const currentClip = clips.find((c) => {
    const end = c.startTime + c.duration - c.trimStart - c.trimEnd
    return playhead >= c.startTime && playhead < end
  }) ?? clips.reduce<Clip | null>((nearest, c) => {
    if (!nearest) return c
    return Math.abs(c.startTime - playhead) < Math.abs(nearest.startTime - playhead) ? c : nearest
  }, null)

  const clipColor = currentClip ? pickColor(currentClip.id) : '#6366f1'

  useEffect(() => { setImgLoaded(false) }, [currentClip?.id])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handlePlayStop = useCallback(async () => {
    if (playing) audioEngine.pause()
    else await audioEngine.play(clips, tracks)
  }, [playing, clips, tracks])

  const handlePrev = useCallback(() => {
    const boundaries = getSortedBoundaries(clips)
    const current = audioEngine.getCurrentPosition()
    const prev = [...boundaries].reverse().find((t) => t < current - 0.2)
    audioEngine.seek(prev ?? 0)
  }, [clips])

  const handleNext = useCallback(() => {
    const boundaries = getSortedBoundaries(clips)
    const current = audioEngine.getCurrentPosition()
    const next = boundaries.find((t) => t > current + 0.2)
    if (next !== undefined) audioEngine.seek(next)
  }, [clips])

  if (!currentClip) return null

  const albumImageUrl = currentClip.mfbAlbumImageUrl ?? null
  const title = currentClip.mfbTrackTitle ?? currentClip.fileName
  const artist = currentClip.mfbArtist ?? null
  const currentSegment = segments.find((s) => playhead >= s.startTime && playhead < s.endTime) ?? null

  const sortedClips = [...clips].sort((a, b) => a.startTime - b.startTime)
  const trackIndex = sortedClips.findIndex((c) => c.id === currentClip.id) + 1
  const trackTotal = sortedClips.length

  const totalDuration = clips.length > 0
    ? Math.max(...clips.map((c) => c.startTime + c.duration - c.trimStart - c.trimEnd))
    : 0
  const sessionProgress = totalDuration > 0 ? playhead / totalDuration : 0
  const timeRemaining = Math.max(0, totalDuration - playhead)

  const hasPrev = clips.some((c) => c.startTime < currentClip.startTime - 0.2)
  const hasNext = clips.some((c) => c.startTime > currentClip.startTime + 0.2)

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md select-none overflow-hidden"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Close */}
      <button
        type="button"
        onClick={onClose}
        title="Close (Esc)"
        className="absolute top-4 right-4 flex items-center justify-center w-8 h-8 rounded-full text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
      >
        <svg className="w-4 h-4" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 2l8 8M10 2l-8 8" />
        </svg>
      </button>

      {/* Full-screen blurred background */}
      {albumImageUrl && (
        <img
          src={albumImageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ opacity: 0.1 }}
        />
      )}

      <div className="relative flex flex-col items-center w-full max-w-lg px-8 gap-6">
        {/* Album art */}
        <div className="relative w-full aspect-square rounded-xl overflow-hidden shadow-2xl">
          {albumImageUrl ? (
            <img
              key={currentClip.id}
              src={albumImageUrl}
              alt=""
              onLoad={() => setImgLoaded(true)}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
            />
          ) : null}
          <div
            className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${albumImageUrl && imgLoaded ? 'opacity-0' : 'opacity-100'}`}
            style={{ background: `linear-gradient(135deg, ${clipColor}33, ${clipColor}11)` }}
          >
            <svg className="w-16 h-16 opacity-20" viewBox="0 0 24 24" fill="currentColor" style={{ color: clipColor }}>
              <path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z" />
            </svg>
          </div>
        </div>

        {/* Track info */}
        <div className="flex flex-col items-center gap-1.5 text-center w-full">
          <span className="text-white text-lg font-medium leading-tight">{title}</span>
          {artist && <span className="text-gray-400 text-sm">{artist}</span>}
          <div className="flex items-center gap-2 mt-1">
            {currentSegment && (
              <span
                className="text-[10px] px-2.5 py-0.5 rounded-full font-medium uppercase tracking-wider"
                style={{ background: `${currentSegment.color}22`, color: currentSegment.color, border: `1px solid ${currentSegment.color}44` }}
              >
                {currentSegment.name}
              </span>
            )}
            <span className="text-[10px] tabular-nums text-gray-600">
              {trackIndex} / {trackTotal}
            </span>
          </div>
        </div>

        {/* Session progress */}
        <div className="w-full flex flex-col gap-1.5">
          <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-none"
              style={{ width: `${sessionProgress * 100}%`, background: 'rgba(255,255,255,0.3)' }}
            />
          </div>
          <div className="flex justify-between text-[10px] font-mono tabular-nums text-gray-600">
            <span>{formatTime(playhead)}</span>
            <span>−{formatTime(timeRemaining)}</span>
          </div>
        </div>

        {/* Transport controls */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handlePrev}
            disabled={!hasPrev}
            title="Previous clip"
            className="flex items-center justify-center w-8 h-8 text-gray-500 rounded-full transition-colors hover:text-gray-200 disabled:opacity-25"
          >
            <svg className="w-4 h-4" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2 2h1.5v8H2zM10.5 2L4.5 6l6 4V2z" />
            </svg>
          </button>

          <button
            type="button"
            onClick={handlePlayStop}
            title={playing ? 'Stop' : 'Play'}
            className="flex items-center justify-center w-14 h-14 rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/20 hover:border-white/40 transition-colors"
          >
            {playing ? (
              <svg className="w-5 h-5" viewBox="0 0 12 12" fill="currentColor">
                <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
              </svg>
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 10 10" fill="currentColor">
                <path d="M2 1.5l7 3.5-7 3.5V1.5z" />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={handleNext}
            disabled={!hasNext}
            title="Next clip"
            className="flex items-center justify-center w-8 h-8 text-gray-500 rounded-full transition-colors hover:text-gray-200 disabled:opacity-25"
          >
            <svg className="w-4 h-4" viewBox="0 0 12 12" fill="currentColor">
              <path d="M10 2h-1.5v8H10zM1.5 2l6 4-6 4V2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
