import { useEffect, useRef } from 'react'
import { useTransportStore } from '../../store/transportStore'

interface Props {
  peaks: number[]
  color: string
  duration: number
  trimStart: number
  trimEnd: number
  gain?: number
  /** Clip's left edge in timeline px (startTime * zoom). */
  clipLeft: number
  /** Clip's rendered width in px. */
  clipWidth: number
}

// Only the on-screen part of a clip gets a canvas. A 20-minute clip at zoom 10
// on a 2x display would otherwise be a ~24000px-wide canvas (~18MB), and a
// 40-clip set held hundreds of MB of mostly off-screen pixels — all redrawn on
// every zoom step. The slice is snapped to TILE px with MARGIN of overscan so
// ordinary scrolling only redraws when it crosses a tile boundary.
const TILE = 1024
const MARGIN = 512

// Chromium caps a canvas at 32767px per side and ~2^28px total area.
const MAX_DIM = 32767
const MAX_AREA = 16_000_000

/** Visible slice of the clip in clip-local px, as a "start:end" key (stable across re-renders). */
function useVisibleSlice(clipLeft: number, clipWidth: number): [number, number] {
  const key = useTransportStore((s) => {
    const vw = s.viewportWidth || window.innerWidth
    const from = Math.max(0, s.scrollX - clipLeft - MARGIN)
    const to = Math.min(clipWidth, s.scrollX + vw - clipLeft + MARGIN)
    if (to <= from) return '0:0'
    const start = Math.floor(from / TILE) * TILE
    const end = Math.min(clipWidth, Math.ceil(to / TILE) * TILE)
    return `${start}:${end}`
  })
  const [start, end] = key.split(':').map(Number)
  return [start, end]
}

export function MiniWaveform({ peaks, color, duration, trimStart, trimEnd, gain = 1, clipLeft, clipWidth }: Props): JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [sliceStart, sliceEnd] = useVisibleSlice(clipLeft, clipWidth)
  const sliceWidth = sliceEnd - sliceStart

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || peaks.length < 2 || duration <= 0 || sliceWidth <= 0 || clipWidth <= 0) return

    const draw = (): void => {
      const dpr = window.devicePixelRatio || 1
      const cssH = canvas.offsetHeight
      if (cssH === 0) return

      const physH = Math.round(cssH * dpr)
      const capW = Math.min(MAX_DIM, Math.floor(MAX_AREA / Math.max(1, physH)))
      const physW = Math.min(Math.round(sliceWidth * dpr), capW)
      canvas.width = physW
      canvas.height = physH

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // peaks is flat interleaved [min0, max0, min1, max1, ...]
      const pairCount = peaks.length >> 1
      const startPair = Math.max(0, Math.floor((trimStart / duration) * pairCount))
      const endPair = Math.min(pairCount, Math.ceil(((duration - trimEnd) / duration) * pairCount))
      const visibleCount = endPair - startPair
      if (visibleCount <= 0) return

      ctx.clearRect(0, 0, physW, physH)
      ctx.fillStyle = color + 'aa'

      const scale = Math.min(2, Math.max(0, gain))
      const half = physH / 2
      // Physical column x covers clip-local px [sliceStart + x*pxPerCol, …).
      const pxPerCol = sliceWidth / physW
      const pairsPerPx = visibleCount / clipWidth

      // Draw one min/max bar per PHYSICAL pixel column, aggregating every peak
      // that maps to that column. This stays crisp at any zoom: when peaks
      // outnumber columns we downsample here; when columns outnumber peaks each
      // peak spans ~1px, so it never degrades into chunky blocks.
      for (let x = 0; x < physW; x++) {
        const from = startPair + Math.floor((sliceStart + x * pxPerCol) * pairsPerPx)
        const to = Math.max(from + 1, startPair + Math.floor((sliceStart + (x + 1) * pxPerCol) * pairsPerPx))
        let mn = 0
        let mx = 0
        for (let p = from; p < to && p < endPair; p++) {
          const v0 = peaks[p * 2] * scale
          const v1 = peaks[p * 2 + 1] * scale
          if (v0 < mn) mn = v0
          if (v1 > mx) mx = v1
        }
        const top = half - mx * half
        const bot = half - mn * half
        ctx.fillRect(x, Math.min(top, half - 0.5), 1, Math.max(1, bot - top))
      }
    }

    draw()

    // Redraw if the track height changes. RAF-debounced.
    let rafId: number | null = null
    const scheduleDraw = (): void => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => { rafId = null; draw() })
    }
    const ro = new ResizeObserver(scheduleDraw)
    ro.observe(canvas)
    return () => { ro.disconnect(); if (rafId !== null) cancelAnimationFrame(rafId) }
  }, [peaks, color, duration, trimStart, trimEnd, gain, sliceStart, sliceWidth, clipWidth])

  if (sliceWidth <= 0) return null

  return (
    <canvas
      ref={canvasRef}
      className="absolute top-0 h-full pointer-events-none"
      style={{ left: `${sliceStart}px`, width: `${sliceWidth}px` }}
    />
  )
}
