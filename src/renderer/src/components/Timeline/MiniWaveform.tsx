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
    if (!canvas || peaks.length === 0 || duration <= 0) return

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

      // Drawing coordinates in effective CSS pixels (may be < cssW when capped)
      const effectiveCssW = physW / dpr
      ctx.scale(dpr, dpr)

      const startIdx = Math.floor((trimStart / duration) * peaks.length)
      const endIdx = Math.ceil(((duration - trimEnd) / duration) * peaks.length)
      const visible = peaks.slice(Math.max(0, startIdx), Math.min(peaks.length, endIdx))
      if (visible.length === 0) return

      ctx.clearRect(0, 0, effectiveCssW, cssH)
      ctx.fillStyle = color + 'aa'

      const barW = effectiveCssW / visible.length
      const scale = Math.min(2, Math.max(0, gain))
      for (let i = 0; i < visible.length; i++) {
        const h = Math.max(1, visible[i] * cssH * scale)
        ctx.fillRect(i * barW, (cssH - h) / 2, Math.max(0.5, barW - 0.5), h)
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
