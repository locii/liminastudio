import { useEffect, useRef } from 'react'
import { audioEngine } from '../../audio/audioEngine'

const SEGMENTS = 12
const DB_MIN = -48
const DB_MAX = 6

function levelToSegCount(peak: number): number {
  if (peak < 0.004) return 0
  const db = 20 * Math.log10(peak)
  const t = (db - DB_MIN) / (DB_MAX - DB_MIN)
  return Math.round(Math.max(0, Math.min(1, t)) * SEGMENTS)
}

function segColor(seg: number): [string, string] {
  const db = DB_MIN + (seg / (SEGMENTS - 1)) * (DB_MAX - DB_MIN)
  if (db >= 0) return ['#ef4444', '#1a0000']
  if (db >= -6) return ['#f59e0b', '#1a1200']
  if (db >= -18) return ['#818cf8', '#090b1e']
  return ['#6366f1', '#060818']
}

function computePeak(buf: Float32Array): number {
  let max = 0
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i])
    if (v > max) max = v
  }
  return max
}

interface Props {
  trackId: string
}

export function TrackVUMeter({ trackId }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const smooth = useRef(0)
  const rafId = useRef<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ATTACK = 0.95
    const RELEASE = 0.83
    const buf = new Float32Array(1024)

    const tick = (): void => {
      rafId.current = requestAnimationFrame(tick)
      const analyser = audioEngine.getTrackAnalyser(trackId)
      if (!analyser) {
        smooth.current *= RELEASE
      } else {
        analyser.getFloatTimeDomainData(buf)
        const pk = computePeak(buf)
        smooth.current = pk > smooth.current
          ? pk + (smooth.current - pk) * (1 - ATTACK)
          : smooth.current * RELEASE
      }

      const dpr = window.devicePixelRatio || 1
      const cw = canvas.offsetWidth
      const ch = canvas.offsetHeight
      if (cw === 0 || ch === 0) return
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr)
        canvas.height = Math.round(ch * dpr)
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cw, ch)

      const segCount = levelToSegCount(smooth.current)
      const GAP = 1
      const sh = Math.max(2, Math.floor((ch - (SEGMENTS - 1) * GAP) / SEGMENTS))
      const totalH = SEGMENTS * sh + (SEGMENTS - 1) * GAP
      const yOff = ch - totalH

      for (let i = 0; i < SEGMENTS; i++) {
        const seg = SEGMENTS - 1 - i
        const y = yOff + i * (sh + GAP)
        const [lit, unlit] = segColor(seg)
        ctx.fillStyle = seg < segCount ? lit : unlit
        ctx.fillRect(0, y, cw, sh)
      }
    }

    rafId.current = requestAnimationFrame(tick)
    return () => { if (rafId.current !== null) cancelAnimationFrame(rafId.current) }
  }, [trackId])

  return <canvas ref={canvasRef} className="w-2 h-full shrink-0" />
}
