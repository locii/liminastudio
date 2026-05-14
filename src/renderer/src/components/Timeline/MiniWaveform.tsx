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

    // Most browsers cap canvas width at 32767 physical px. If the clip is very
    // wide we cap the buffer and let CSS stretch it — still a clear overview.
    const MAX_CANVAS_PX = 16383

    const draw = (): void => {
      const dpr = window.devicePixelRatio || 1
      const cssW = canvas.offsetWidth
      const cssH = canvas.offsetHeight
      if (cssW === 0 || cssH === 0) return

      const physW = Math.min(Math.round(cssW * dpr), MAX_CANVAS_PX)
      const physH = Math.round(cssH * dpr)
      canvas.width = physW
      canvas.height = physH

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const effectiveCssW = physW / dpr
      ctx.scale(dpr, dpr)

      // peaks is flat interleaved [min0, max0, min1, max1, ...]
      const pairCount = peaks.length >> 1
      const startPair = Math.max(0, Math.floor((trimStart / duration) * pairCount))
      const endPair = Math.min(pairCount, Math.ceil(((duration - trimEnd) / duration) * pairCount))
      const visibleCount = endPair - startPair
      if (visibleCount <= 0) return

      ctx.clearRect(0, 0, effectiveCssW, cssH)
      ctx.fillStyle = color + 'aa'

      const barW = effectiveCssW / visibleCount
      const drawW = Math.max(0.5, barW - 0.25)
      const scale = Math.min(2, Math.max(0, gain))
      const half = cssH / 2

      for (let i = 0; i < visibleCount; i++) {
        const idx = (startPair + i) * 2
        const mn = peaks[idx] * scale
        const mx = peaks[idx + 1] * scale
        const top = half - mx * half
        const bot = half - mn * half
        const h = Math.max(1, bot - top)
        ctx.fillRect(i * barW, Math.min(top, half - 0.5), drawW, h)
      }
    }

    draw()

    // Redraw whenever the clip block resizes (e.g. zoom changes)
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [peaks, color, duration, trimStart, trimEnd, gain])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  )
}
