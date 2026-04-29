import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface TourStep {
  id: string
  title: string
  body: string
  target?: string  // CSS selector of element to highlight
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center'
  spotlight?: boolean  // whether to punch a hole in the overlay
}

const STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Limina Studio',
    body: 'This quick tour will show you the key features of the app. Click Next to step through, or Skip to jump straight in.',
    placement: 'center',
  },
  {
    id: 'add-track',
    title: 'Adding Audio Files',
    body: 'Click "Add Track" to open a file picker and load WAV or MP3 files onto the timeline. Each file becomes a clip on its own track. You can also drag files directly from Finder onto a track row.',
    target: '[data-tour="add-track"]',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'add-empty-track',
    title: 'Empty Tracks',
    body: 'Use "Empty Track" to create a track with no audio — useful for dropping files onto later or organising your layout.',
    target: '[data-tour="empty-track"]',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'file-menu',
    title: 'File Menu',
    body: 'Open, Save, Save As, and collect project files live here. Use ⌘S to save quickly and ⌘O to open a session. Sessions are saved as .limina files that remember all your tracks, clips, and fades.',
    target: '[data-tour="file-menu"]',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'zoom',
    title: 'Zoom Control',
    body: 'Drag the slider to zoom in or out. Use + / − on your keyboard or pinch on a trackpad. The "fit" button zooms to show the entire session at once.',
    target: '[data-tour="zoom"]',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'timeline',
    title: 'The Timeline',
    body: 'Clips appear here as coloured blocks. Drag a clip horizontally to reposition it. Drag a clip\'s right edge to trim. When two clips overlap on the same track, a crossfade is applied automatically.',
    target: '[data-tour="timeline"]',
    placement: 'center',
    spotlight: false,
  },
  {
    id: 'ruler',
    title: 'Time Ruler & Markers',
    body: 'Click anywhere on the ruler to jump the playhead to that position. Double-click to drop a section marker — great for labelling intro, build, peak, and integration sections. Drag markers to move them; right-click to rename or delete.',
    target: '[data-tour="ruler"]',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'track-header',
    title: 'Track Controls',
    body: 'Each track header shows the name, volume fader, mute (M), and solo (S) buttons. Double-click the name to rename it. The small VU strip on the right edge shows real-time playback level.',
    target: '[data-tour="track-header-first"]',
    placement: 'right',
    spotlight: true,
  },
  {
    id: 'automation',
    title: 'Volume Automation',
    body: 'Click the automation chevron on a track to expand the automation lane. Click the lane to add a node, then drag nodes up/down to draw a volume curve. Right-click a node to delete it.',
    target: '[data-tour="automation-toggle"]',
    placement: 'right',
    spotlight: true,
  },
  {
    id: 'master-volume',
    title: 'Master Volume',
    body: 'The Master fader at the bottom-left controls the overall output level. Changes take effect immediately during playback.',
    target: '[data-tour="master-volume"]',
    placement: 'top',
    spotlight: true,
  },
  {
    id: 'master-vu',
    title: 'Master VU Meter',
    body: 'The stereo VU meter on the right shows real-time output levels. The top squares latch red when the signal clips — click them to reset. Aim to keep your mix below 0 dB.',
    target: '[data-tour="master-vu"]',
    placement: 'left',
    spotlight: true,
  },
  {
    id: 'transport',
    title: 'Transport Controls',
    body: 'Start, Prev, Play/Stop, Next, and End are at the bottom. Prev and Next jump between clip boundaries across all tracks. The loop button (↺) repeats the current session.',
    target: '[data-tour="bottom-transport"]',
    placement: 'top',
    spotlight: true,
  },
  {
    id: 'properties',
    title: 'Clip Properties',
    body: 'Select any clip to open the properties panel. Edit start time, fade in/out durations, clip volume, and which track the clip belongs to. Changes are reflected immediately in playback.',
    target: '[data-tour="properties-panel"]',
    placement: 'top',
    spotlight: true,
  },
  {
    id: 'export',
    title: 'Exporting Your Mix',
    body: 'Click "Export" (or ⌘E) to render the full mix to WAV or MP3. Choose your format, bit rate, and sample rate. A progress bar shows render status. The resulting file is a single, continuous audio file ready to play.',
    target: '[data-tour="export-btn"]',
    placement: 'bottom',
    spotlight: true,
  },
  {
    id: 'done',
    title: 'You\'re all set!',
    body: 'Press ? at any time to see the full keyboard shortcut reference. Happy mixing!',
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

const PAD = 12

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
    style = {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: 380,
    }
  } else {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const BOX_W = 320
    const BOX_H = 180

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
      style={{ ...style, zIndex: 10000 }}
      className="bg-surface-panel border border-accent/60 rounded-lg shadow-2xl p-4 flex flex-col gap-3"
    >
      {/* Step indicator */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500 font-mono">{stepIndex + 1} / {total}</span>
        <button onClick={onSkip} className="text-[10px] text-gray-600 hover:text-gray-300 transition-colors">
          Skip tour
        </button>
      </div>

      {/* Progress dots */}
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
            onClick={onPrev}
            className="px-3 h-7 text-xs text-gray-400 hover:text-gray-200 bg-surface-hover rounded transition-colors"
          >
            Back
          </button>
        )}
        <button
          onClick={onNext}
          className="px-4 h-7 text-xs font-medium text-white bg-accent hover:bg-accent/80 rounded transition-colors"
        >
          {isLast ? 'Done' : 'Next'}
        </button>
      </div>
    </div>
  )
}

interface Props {
  onClose: () => void
}

export function GuidedTour({ onClose }: Props): JSX.Element {
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const rafRef = useRef<number | null>(null)

  const step = STEPS[stepIndex]

  const updateRect = useCallback(() => {
    if (step.target) {
      setTargetRect(getTargetRect(step.target))
    } else {
      setTargetRect(null)
    }
  }, [step.target])

  useEffect(() => {
    updateRect()
    const onResize = (): void => updateRect()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [updateRect])

  // Poll for target element in case it isn't mounted yet
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
    if (stepIndex >= STEPS.length - 1) { onClose(); return }
    setStepIndex((i) => i + 1)
  }, [stepIndex, onClose])

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

  // Build SVG clip path to punch a hole over the target element
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
      {/* Overlay — SVG with punched-out spotlight */}
      <svg
        style={{ position: 'fixed', inset: 0, zIndex: 9998, pointerEvents: 'all' }}
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
          fill="rgba(0,0,0,0.65)"
          mask={sp ? 'url(#tour-mask)' : undefined}
        />
        {/* Spotlight border */}
        {sp && (
          <rect
            x={sp.x} y={sp.y} width={sp.w} height={sp.h} rx={sp.r}
            fill="none" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="4 3"
          />
        )}
      </svg>

      {/* Tooltip */}
      <TooltipBox
        step={step}
        targetRect={targetRect}
        stepIndex={stepIndex}
        total={STEPS.length}
        onNext={handleNext}
        onPrev={handlePrev}
        onSkip={onClose}
      />
    </>,
    document.body
  )
}
