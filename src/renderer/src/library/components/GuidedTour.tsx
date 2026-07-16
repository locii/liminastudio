import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

export interface TourStep {
  id: string
  title: string
  body: string
  target?: string
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center'
  spotlight?: boolean
}

const LIBRARY_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Limina Library',
    body: 'This quick tour covers the key features. Click Next or press → to step through, or Skip to jump straight in.',
    placement: 'center',
  },
  {
    id: 'add-folder',
    title: 'Adding Music Folders',
    body: 'Click Add Folder to pick a folder from disk — Limina scans it and imports all audio files automatically. You can also drag any folder from Finder directly into the left panel.',
    target: '[data-tour="add-folder"]',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'folder-panel',
    title: 'Browse by Folder, Tag, or Playlist',
    body: 'Switch between Folders, Tags, and Playlists at the top of this panel. Click any item to filter the file list. Drag new folders from Finder straight onto this panel to add them.',
    target: '[data-tour="folder-panel"]',
    placement: 'right',
    spotlight: true,
  },
  {
    id: 'search-bar',
    title: 'Search & Filter',
    body: 'Search across filenames, artists, albums, and tags in real time. Use the filter chips to show only Pending Music for Breathwork matches, Duplicate matches, or files you\'ve removed from the library.',
    target: '[data-tour="search-bar"]',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'column-headers',
    title: 'Sorting & Audio Features',
    body: 'Click any column header to sort. Shift+click a second header to add a secondary sort — a number badge shows the sort order. Audio feature columns (Intensity, Affective, Activation, Spaciousness, Tension, Energy, Valence, Danceability) populate automatically once a track is matched to Music for Breathwork.',
    target: '[data-tour="column-headers"]',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'track-panel',
    title: 'Track Details Panel',
    body: 'Click any file to open its details on the right. View and edit the artist, album, breathwork phase, tags, and notes. The waveform lets you preview the audio — click to play, scrub to seek. Drag the file icon from the panel header directly into Limina Studio to add it to a mix.',
    placement: 'center',
  },
  {
    id: 'mfb-matching',
    title: 'Music for Breathwork Matching',
    body: 'Limina automatically matches your files to the Music for Breathwork catalogue and enriches them with artist info, audio features, and breathwork tags. Matched files show a "pending" badge — click it to apply just that track, or use Apply All in the toolbar to stamp everything at once.',
    placement: 'center',
  },
  {
    id: 'playlists-tab',
    title: 'Music for Breathwork Playlists',
    body: 'Sign in with your Music for Breathwork account to sync your curated playlists. The file list shows which tracks you own and flags any missing ones — click a missing track to search for the file on disk or browse for it manually.',
    target: '[data-tour="playlists-tab"]',
    placement: 'right',
    spotlight: true,
  },
  {
    id: 're-index',
    title: 'Re-index & Rescan',
    body: 'Re-index runs the Music for Breathwork matcher again over any unmatched files — useful after adding new music. Rescan refreshes all watched folders to pick up files added outside the app. Use the backup clock icon to restore a previous catalogue snapshot if anything goes wrong.',
    target: '[data-tour="re-index"]',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'done',
    title: 'You\'re all set!',
    body: 'Add folders, let Limina match them to Music for Breathwork, sort by audio features to find the right energy, then drag tracks into Limina Studio. Come back to this tour any time with the ? button in the toolbar.',
    placement: 'center',
  },
]

interface Rect { top: number; left: number; width: number; height: number }

function getTargetRect(selector: string): Rect | null {
  const el = document.querySelector(selector)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

const PAD = 14

function TooltipBox({
  step,
  targetRect,
  stepIndex,
  total,
  onNext,
  onPrev,
  onSkip,
}: {
  step: TourStep
  targetRect: Rect | null
  stepIndex: number
  total: number
  onNext: () => void
  onPrev: () => void
  onSkip: () => void
}): JSX.Element {
  const isFirst = stepIndex === 0
  const isLast = stepIndex === total - 1
  const placement = step.placement ?? 'bottom'

  let style: React.CSSProperties = {}

  if (placement === 'center' || !targetRect) {
    style = { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 400 }
  } else {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const BOX_W = 340
    const BOX_H = 200

    if (placement === 'bottom') {
      let left = targetRect.left + targetRect.width / 2 - BOX_W / 2
      left = Math.max(PAD, Math.min(vw - BOX_W - PAD, left))
      style = { position: 'fixed', top: targetRect.top + targetRect.height + PAD, left, width: BOX_W }
    } else if (placement === 'top') {
      let left = targetRect.left + targetRect.width / 2 - BOX_W / 2
      left = Math.max(PAD, Math.min(vw - BOX_W - PAD, left))
      style = { position: 'fixed', top: targetRect.top - BOX_H - PAD, left, width: BOX_W }
    } else if (placement === 'right') {
      let top = targetRect.top + targetRect.height / 2 - BOX_H / 2
      top = Math.max(PAD, Math.min(vh - BOX_H - PAD, top))
      style = { position: 'fixed', top, left: targetRect.left + targetRect.width + PAD, width: BOX_W }
    } else if (placement === 'left') {
      let top = targetRect.top + targetRect.height / 2 - BOX_H / 2
      top = Math.max(PAD, Math.min(vh - BOX_H - PAD, top))
      style = { position: 'fixed', top, left: targetRect.left - BOX_W - PAD, width: BOX_W }
    }
  }

  return (
    <div
      style={{ ...style, zIndex: 10001 }}
      className="bg-surface-panel border border-accent/60 rounded-lg shadow-2xl p-4 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500 font-mono tabular-nums">{stepIndex + 1} / {total}</span>
        <button type="button" onClick={onSkip} className="text-[10px] text-gray-600 hover:text-gray-300 transition-colors">
          Skip tour
        </button>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`h-0.5 flex-1 rounded-full transition-colors ${i <= stepIndex ? 'bg-accent' : 'bg-surface-hover'}`}
          />
        ))}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-100 mb-1">{step.title}</h3>
        <p className="text-xs text-gray-400 leading-relaxed">{step.body}</p>
      </div>

      <div className="flex gap-2 justify-end">
        {!isFirst && (
          <button
            type="button"
            onClick={onPrev}
            className="px-3 h-7 text-xs text-gray-400 hover:text-gray-200 bg-surface-hover rounded transition-colors"
          >
            Back
          </button>
        )}
        <button
          type="button"
          onClick={onNext}
          className="px-4 h-7 text-xs font-medium text-white bg-accent hover:bg-accent/80 rounded transition-colors"
        >
          {isLast ? 'Done' : 'Next →'}
        </button>
      </div>
    </div>
  )
}

interface Props {
  onClose: () => void
  steps?: TourStep[]
}

export function GuidedTour({ onClose, steps = LIBRARY_STEPS }: Props): JSX.Element {
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const rafRef = useRef<number | null>(null)

  const step = steps[stepIndex]

  const updateRect = useCallback(() => {
    if (step.target) {
      setTargetRect(getTargetRect(step.target))
    } else {
      setTargetRect(null)
    }
  }, [step.target])

  useEffect(() => {
    updateRect()
    window.addEventListener('resize', updateRect)
    return () => window.removeEventListener('resize', updateRect)
  }, [updateRect])

  // Poll for target in case it isn't mounted yet
  useEffect(() => {
    if (!step.target) return
    let tries = 0
    const poll = (): void => {
      const rect = getTargetRect(step.target!)
      if (rect) { setTargetRect(rect); return }
      if (tries++ < 20) rafRef.current = requestAnimationFrame(poll)
    }
    rafRef.current = requestAnimationFrame(poll)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [step.target])

  const handleNext = useCallback(() => {
    if (stepIndex >= steps.length - 1) { onClose(); return }
    setStepIndex((i) => i + 1)
  }, [stepIndex, onClose, steps.length])

  const handlePrev = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1))
  }, [])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'Enter') handleNext()
    if (e.key === 'ArrowLeft') handlePrev()
    if (e.key === 'Escape') onClose()
  }, [handleNext, handlePrev, onClose])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const vw = window.innerWidth
  const vh = window.innerHeight

  const spotlight = step.spotlight && targetRect
  const sp = spotlight ? {
    x: Math.max(0, targetRect.left - PAD),
    y: Math.max(0, targetRect.top - PAD),
    w: targetRect.width + PAD * 2,
    h: targetRect.height + PAD * 2,
    r: 6,
  } : null

  return createPortal(
    <>
      <svg
        style={{ position: 'fixed', inset: 0, zIndex: 10000, pointerEvents: 'all' }}
        width={vw}
        height={vh}
        onClick={handleNext}
      >
        <defs>
          {sp && (
            <mask id="tour-mask">
              <rect width={vw} height={vh} fill="white" />
              <rect x={sp.x} y={sp.y} width={sp.w} height={sp.h} rx={sp.r} fill="black" />
            </mask>
          )}
        </defs>
        <rect
          width={vw}
          height={vh}
          fill="rgba(0,0,0,0.60)"
          mask={sp ? 'url(#tour-mask)' : undefined}
        />
        {sp && (
          <rect
            x={sp.x} y={sp.y} width={sp.w} height={sp.h} rx={sp.r}
            fill="none" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="4 3"
          />
        )}
      </svg>

      <TooltipBox
        step={step}
        targetRect={targetRect}
        stepIndex={stepIndex}
        total={steps.length}
        onNext={handleNext}
        onPrev={handlePrev}
        onSkip={onClose}
      />
    </>,
    document.body
  )
}
