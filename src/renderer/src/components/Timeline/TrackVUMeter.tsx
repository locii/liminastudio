import { useEffect, useRef } from 'react'
import { audioEngine } from '../../audio/audioEngine'

const SEGMENTS = 32
const DB_MIN = -60
const DB_MAX = 0

function levelToSegCount(peak: number): number {
  if (peak < 0.004) return 0
  const db = 20 * Math.log10(peak)
  const t = (db - DB_MIN) / (DB_MAX - DB_MIN)
  return Math.floor(Math.max(0, Math.min(1, t)) * SEGMENTS)
}

function segColor(seg: number): [string, string] {
  const db = DB_MIN + (seg / (SEGMENTS - 1)) * (DB_MAX - DB_MIN)
  if (db >= -0.25) return ['#ff2233', '#1f0508'] // top — brightest red, at ceiling
  if (db >= -2)    return ['#e03444', '#1f0508'] // mid — standard red
  if (db >= -3)    return ['#e03444', '#1f0508'] // clip — red (3 steps)
  if (db >= -9)    return ['#e8722a', '#1a0e05'] // hot  — burnt orange
  if (db >= -18)   return ['#f0c040', '#1a1505'] // warm — gold
  return                  ['#00d4aa', '#051a15'] // safe — teal-green
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
  height: number
}

export function TrackVUMeter({ trackId, height }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const smooth = useRef(0)
  const peakHold = useRef(0)
  const peakHoldTime = useRef(0)
  const rafId = useRef<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const HOLD_MS = 1600
    const ATTACK = 0.97
    const RELEASE = 0.88
    const PEAK_DECAY = 0.18
    const buf = new Float32Array(2048)

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

      const now = performance.now()
      if (smooth.current >= peakHold.current) {
        peakHold.current = smooth.current
        peakHoldTime.current = now
      } else if (now - peakHoldTime.current > HOLD_MS) {
        peakHold.current = Math.max(0, peakHold.current - PEAK_DECAY)
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
      const sh = Math.max(1, Math.floor((ch - (SEGMENTS - 1) * GAP) / SEGMENTS))
      const totalH = SEGMENTS * sh + (SEGMENTS - 1) * GAP
      const yOff = ch - totalH

      for (let i = 0; i < SEGMENTS; i++) {
        const seg = SEGMENTS - 1 - i
        const y = yOff + i * (sh + GAP)
        const [lit, unlit] = segColor(seg)
        ctx.fillStyle = seg < segCount ? lit : unlit
        ctx.fillRect(0, y, cw, sh)
      }

      // Peak hold tick
      const holdSeg = levelToSegCount(peakHold.current)
      if (holdSeg > 0 && holdSeg <= SEGMENTS) {
        const hi = SEGMENTS - holdSeg
        const hy = yOff + hi * (sh + GAP)
        const [holdColor] = segColor(holdSeg - 1)
        ctx.fillStyle = holdColor
        ctx.fillRect(0, hy, cw, Math.max(2, sh))
      }

      // dB tick marks
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      for (const markDb of [0, -3, -6, -12, -18, -24]) {
        const t = (markDb - DB_MIN) / (DB_MAX - DB_MIN)
        const seg = Math.round(t * (SEGMENTS - 1))
        const ii = SEGMENTS - 1 - seg
        const y = yOff + ii * (sh + GAP) - 1
        if (y >= 0 && y < ch) ctx.fillRect(0, y, cw, 1)
      }
    }

    rafId.current = requestAnimationFrame(tick)
    return () => { if (rafId.current !== null) cancelAnimationFrame(rafId.current) }
  }, [trackId])

  return (
    <canvas
      ref={canvasRef}
      className="w-2 shrink-0 cursor-pointer"
      style={{ height }}
      title="Click to reset peak hold"
      onClick={() => { peakHold.current = 0; peakHoldTime.current = 0 }}
    />
  )
}
