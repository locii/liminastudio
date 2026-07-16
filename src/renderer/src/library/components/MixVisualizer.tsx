import { useEffect, useRef } from 'react'

/**
 * Canvas visualizer for Auto-Mix — a central disc with radial spokes emanating
 * outward, the whole figure rotating at the track's tempo (BPM); spoke length is
 * driven by the waveform (peaks ending at the playhead).
 *
 * Styling borrows the Music for Breathwork tension-chart finesse: a radial
 * purple-glow backdrop and a soft Gaussian glow (canvas shadowBlur) on the
 * strokes. Peaks-driven (no Web Audio) so it can't trip the autoplay-silencing
 * pitfall the mix engine avoids. Fills whatever container it's given.
 */
export function MixVizCanvas({ getWave, getTempo, className }: {
  getWave: (count: number) => number[]
  getTempo: () => number
  className?: string
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const getWaveRef = useRef(getWave)
  const getTempoRef = useRef(getTempo)
  getWaveRef.current = getWave
  getTempoRef.current = getTempo

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    const GRID = 'rgba(150,140,180,0.05)'
    const DIM = 'rgba(130,210,200,0.18)'
    const LINE = 'rgba(140,225,210,0.8)'
    const ACCENT = '#f2a65a'
    const MONO = 'ui-monospace, "SF Mono", Menlo, monospace'
    const SPOKES = 120

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const resize = (): void => {
      canvas.width = Math.max(2, Math.round(canvas.offsetWidth * dpr))
      canvas.height = Math.max(2, Math.round(canvas.offsetHeight * dpr))
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let raf = 0
    let smooth = 0
    let angle = 0
    let last = performance.now()

    const loop = (now: number): void => {
      const w = canvas.width, h = canvas.height
      const cx = w / 2, cy = h / 2
      const unit = Math.min(w, h)
      const px = dpr
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      const wave = getWaveRef.current(SPOKES)
      let peak = 0
      for (const v of wave) if (v > peak) peak = v
      smooth += (peak - smooth) * (peak > smooth ? 0.3 : 0.09)

      const bpm = getTempoRef.current() || 90
      angle += (bpm / 60 / 8) * Math.PI * 2 * dt

      // Radial purple-glow backdrop (à la the tension chart).
      const bg = ctx.createRadialGradient(cx, h * -0.1, 0, cx, h * -0.1, Math.max(w, h) * 1.15)
      bg.addColorStop(0, '#221C33')
      bg.addColorStop(0.55, '#14121C')
      bg.addColorStop(1, '#0d0b14')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)

      // Grid (crisp, no glow).
      ctx.shadowBlur = 0
      ctx.lineWidth = px
      ctx.strokeStyle = GRID
      ctx.beginPath()
      const step = unit / 20
      for (let x = cx % step; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h) }
      for (let y = cy % step; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y) }
      ctx.stroke()

      const discR = unit * 0.09
      const maxLen = unit * 0.34

      // Reference rings.
      ctx.strokeStyle = DIM
      ctx.lineWidth = px
      for (const r of [discR, discR + maxLen * 0.5, discR + maxLen]) {
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
      }

      // Radial spokes — with a soft glow.
      ctx.lineWidth = 1.2 * px
      ctx.shadowBlur = (4 + smooth * 8) * px
      for (let i = 0; i < SPOKES; i++) {
        const s = wave[i]
        const a = angle + (i / SPOKES) * Math.PI * 2
        const len = discR + maxLen * (0.06 + 0.94 * s) * (0.35 + 0.65 * smooth)
        const ca = Math.cos(a), sa = Math.sin(a)
        const hot = s > 0.72
        ctx.strokeStyle = hot ? ACCENT : LINE
        ctx.shadowColor = hot ? ACCENT : 'rgba(140,225,210,0.9)'
        ctx.globalAlpha = 0.35 + 0.65 * s
        ctx.beginPath()
        ctx.moveTo(cx + ca * discR, cy + sa * discR)
        ctx.lineTo(cx + ca * len, cy + sa * len)
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      // Central disc.
      ctx.shadowBlur = 0
      ctx.fillStyle = '#0c0a14'
      ctx.beginPath(); ctx.arc(cx, cy, discR, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = LINE
      ctx.shadowColor = 'rgba(140,225,210,0.9)'
      ctx.shadowBlur = 6 * px
      ctx.lineWidth = 1.3 * px
      ctx.beginPath(); ctx.arc(cx, cy, discR, 0, Math.PI * 2); ctx.stroke()
      // Spindle + rotation index mark.
      ctx.fillStyle = ACCENT
      ctx.shadowColor = ACCENT
      ctx.shadowBlur = (6 + smooth * 14) * px
      ctx.beginPath(); ctx.arc(cx, cy, unit * (0.008 + smooth * 0.02), 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = ACCENT
      ctx.lineWidth = 1.4 * px
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * discR, cy + Math.sin(angle) * discR)
      ctx.stroke()
      ctx.shadowBlur = 0

      // Readouts (only when there's room).
      if (h > 120 * px) {
        ctx.fillStyle = 'rgba(150,141,168,0.65)'
        ctx.font = `${10 * px}px ${MONO}`
        ctx.textBaseline = 'top'
        ctx.fillText(`${Math.round(bpm)} BPM`, 12 * px, 12 * px)
        const bw = unit * 0.16, bh = 3 * px, bx = w - 12 * px - bw, by = h - 14 * px
        ctx.strokeStyle = DIM; ctx.lineWidth = px
        ctx.strokeRect(bx, by, bw, bh)
        ctx.fillStyle = ACCENT
        ctx.fillRect(bx, by, bw * smooth, bh)
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return <canvas ref={canvasRef} className={className ?? 'block w-full h-full'} />
}

/** Fullscreen overlay wrapper around the visualizer canvas. */
export function MixVisualizer({ getWave, getTempo, onClose }: {
  getWave: (count: number) => number[]
  getTempo: () => number
  onClose: () => void
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[9000] bg-black">
      <MixVizCanvas getWave={getWave} getTempo={getTempo} />
      <div className="absolute top-0 right-0 p-4 opacity-30 hover:opacity-100 transition-opacity">
        <button type="button" onClick={onClose}
          className="flex items-center gap-1.5 text-[12px] text-white/80 hover:text-white transition-colors">
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
          </svg>
          Exit (Esc)
        </button>
      </div>
    </div>
  )
}
