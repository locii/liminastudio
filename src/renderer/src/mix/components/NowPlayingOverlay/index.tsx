import { useCallback } from 'react'
import type { Clip } from '../../types'
import { audioEngine } from '../../audio/audioEngine'
import { useTransportStore } from '../../store/transportStore'
import { useSessionStore } from '../../store/sessionStore'
import { SharedNowPlayingOverlay } from '../../../SharedNowPlayingOverlay'

function getSortedBoundaries(clips: Clip[]): number[] {
  const set = new Set(clips.map((c) => Math.round(c.startTime * 100) / 100))
  return [...set].sort((a, b) => a - b)
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

  const currentClip = clips.find((c) => {
    const end = c.startTime + c.duration - c.trimStart - c.trimEnd
    return playhead >= c.startTime && playhead < end
  }) ?? clips.reduce<Clip | null>((nearest, c) => {
    if (!nearest) return c
    return Math.abs(c.startTime - playhead) < Math.abs(nearest.startTime - playhead) ? c : nearest
  }, null)

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
    <SharedNowPlayingOverlay
      colorSeed={currentClip.id}
      title={title}
      artist={artist}
      albumImageUrl={currentClip.mfbAlbumImageUrl ?? null}
      playing={playing}
      hasPrev={hasPrev}
      hasNext={hasNext}
      onTogglePlay={handlePlayStop}
      onNavigate={(dir) => dir === -1 ? handlePrev() : handleNext()}
      onClose={onClose}
      segmentName={currentSegment?.name ?? null}
      segmentColor={currentSegment?.color ?? null}
      trackIndex={trackIndex}
      trackTotal={trackTotal}
      sessionProgress={sessionProgress}
      currentTime={playhead}
      timeRemaining={timeRemaining}
    />
  )
}
