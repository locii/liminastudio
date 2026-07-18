import { useCallback } from 'react'
import { LibraryFile, BREATHWORK_PHASES, PHASE_COLORS } from '../types'
import { useLibraryStore } from '../store/libraryStore'
import { SharedNowPlayingOverlay } from '../../SharedNowPlayingOverlay'

interface Props {
  file: LibraryFile
  albumImageUrl: string | null | undefined
  playing: boolean
  currentTime: number
  hasPrev: boolean
  hasNext: boolean
  onTogglePlay: () => void
  onNavigate: (dir: -1 | 1) => void
  onClose: () => void
}

export function NowPlayingOverlay({
  file,
  albumImageUrl,
  playing,
  currentTime,
  hasPrev,
  hasNext,
  onTogglePlay,
  onNavigate,
  onClose,
}: Props): JSX.Element {
  const selectTag = useLibraryStore((s) => s.selectTag)

  const handleTagClick = useCallback((tag: string): void => {
    selectTag(tag)
    onClose()
  }, [selectTag, onClose])

  const phase = file.breathworkPhase
  const phaseLabel = phase ? (BREATHWORK_PHASES.find((p) => p.value === phase)?.label ?? null) : null
  const phaseColor = phase ? PHASE_COLORS[phase] : null

  return (
    <SharedNowPlayingOverlay
      colorSeed={file.id}
      title={file.trackTitle || file.fileName}
      artist={file.artist}
      albumImageUrl={albumImageUrl}
      peaks={file.peaks}
      duration={file.duration}
      currentTime={currentTime}
      playing={playing}
      hasPrev={hasPrev}
      hasNext={hasNext}
      onTogglePlay={onTogglePlay}
      onNavigate={onNavigate}
      onClose={onClose}
      tags={file.tags}
      breathworkPhaseLabel={phaseLabel}
      breathworkPhaseColor={phaseColor}
      onTagClick={handleTagClick}
      mfbTrackId={file.mfbTrackId}
    />
  )
}
