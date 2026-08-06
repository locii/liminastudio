import { useEffect, useRef } from 'react'

interface Props {
  peaks: number[]
  color: string
  duration: number
  trimStart: number
  trimEnd: number
  gain?: number
}

export function MiniWaveform({ peaks, color, duration, trimStart, trimEnd, gain = 1 }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || peaks.length < 2 || duration <= 0) return

    // Chromium caps a canvas at 32767px per side and ~2^28px total area. Render
    // as many device pixels as we can afford so the buffer rarely needs CSS
    // stretching (the old, much lower cap is what made deep zoom look blurry).
    const MAX_DIM = 32767
    const MAX_AREA = 16_000_000

    const draw = (): void => {
      const dpr = window.devicePixelRatio || 1
      const cssW = canvas.offsetWidth
      const cssH = canvas.offsetHeight
      if (cssW === 0 || cssH === 0) return

      const physH = Math.round(cssH * dpr)
      const capW = Math.min(MAX_DIM, Math.floor(MAX_AREA / Math.max(1, physH)))
      const physW = Math.min(Math.round(cssW * dpr), capW)
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

      // Draw one min/max bar per PHYSICAL pixel column, aggregating every peak
      // that maps to that column. This stays crisp at any zoom: when peaks
      // outnumber columns we downsample here; when columns outnumber peaks each
      // peak spans ~1px, so it never degrades into chunky blocks.
      for (let x = 0; x < physW; x++) {
        const from = startPair + Math.floor((x / physW) * visibleCount)
        const to = Math.max(from + 1, startPair + Math.floor(((x + 1) / physW) * visibleCount))
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

    // Redraw whenever the clip block resizes (e.g. zoom changes).
    // RAF-debounce so rapid zoom events only trigger one redraw per frame.
    let rafId: number | null = null
    const scheduleDraw = (): void => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => { rafId = null; draw() })
    }
    const ro = new ResizeObserver(scheduleDraw)
    ro.observe(canvas)
    return () => { ro.disconnect(); if (rafId !== null) cancelAnimationFrame(rafId) }
  }, [peaks, color, duration, trimStart, trimEnd, gain])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  )
}
