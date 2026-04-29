import { useEffect, useRef, useCallback } from 'react'
import { audioEngine } from '../../audio/audioEngine'

const SEGMENTS = 32
const DB_MIN = -54
const DB_MAX = 6
function levelToSegCount(peak: number): number {
  if (peak < 0.0002) return 0
  const db = 20 * Math.log10(peak)
  const t = (db - DB_MIN) / (DB_MAX - DB_MIN)
  return Math.round(Math.max(0, Math.min(1, t)) * SEGMENTS)
}

function segColors(seg: number): [string, string] {
  const db = DB_MIN + (seg / (SEGMENTS - 1)) * (DB_MAX - DB_MIN)
  if (db >= 0) return ['#ef4444', '#220000']
  if (db >= -3) return ['#ec4899', '#220010']
  if (db >= -9) return ['#f59e0b', '#1e1600']
  if (db >= -18) return ['#818cf8', '#0c0e28']
  return ['#6366f1', '#080a1e']
}

function computePeak(buf: Float32Array): number {
  let max = 0
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i])
    if (v > max) max = v
  }
  return max
}

export function MasterChannel(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const smoothL = useRef(0)
  const smoothR = useRef(0)
  const peakL = useRef(0)
  const peakR = useRef(0)
  const peakHoldL = useRef(0)
  const peakHoldR = useRef(0)
  const clipL = useRef(false)
  const clipR = useRef(false)
  const rafId = useRef<number | null>(null)

  const resetClip = useCallback(() => {
    clipL.current = false
    clipR.current = false
  }, [])


  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const HOLD_MS = 1600
    const ATTACK = 0.97
    const RELEASE = 0.88
    const PEAK_DECAY = 0.18
    const CLIP_H = 6   // height of the clip indicator square in CSS px
    const buf = new Float32Array(2048)

    const tick = (): void => {
      rafId.current = requestAnimationFrame(tick)

      const [aL, aR] = audioEngine.getAnalysers()
      aL.getFloatTimeDomainData(buf)
      const pkL = computePeak(buf)
      aR.getFloatTimeDomainData(buf)
      const pkR = computePeak(buf)

      smoothL.current = pkL > smoothL.current ? pkL + (smoothL.current - pkL) * (1 - ATTACK) : smoothL.current * RELEASE
      smoothR.current = pkR > smoothR.current ? pkR + (smoothR.current - pkR) * (1 - ATTACK) : smoothR.current * RELEASE

      const segCountL = levelToSegCount(smoothL.current)
      const segCountR = levelToSegCount(smoothR.current)
      const now = performance.now()

      if (segCountL >= peakL.current) { peakL.current = segCountL; peakHoldL.current = now }
      else if (now - peakHoldL.current > HOLD_MS) peakL.current = Math.max(0, peakL.current - PEAK_DECAY)

      if (segCountR >= peakR.current) { peakR.current = segCountR; peakHoldR.current = now }
      else if (now - peakHoldR.current > HOLD_MS) peakR.current = Math.max(0, peakR.current - PEAK_DECAY)

      // Latch clip indicators — only when signal rails the top segment
      if (segCountL >= SEGMENTS) clipL.current = true
      if (segCountR >= SEGMENTS) clipR.current = true

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

      // Clip indicator squares at the very top
      const COLGAP = 3
      const bw = Math.floor((cw - COLGAP) / 2)
      ctx.fillStyle = clipL.current ? '#ef4444' : '#220000'
      ctx.fillRect(0, 0, bw, CLIP_H)
      ctx.fillStyle = clipR.current ? '#ef4444' : '#220000'
      ctx.fillRect(bw + COLGAP, 0, bw, CLIP_H)

      // Meter bars fill remaining height below clip indicator
      const meterTop = CLIP_H + 2
      const meterH = ch - meterTop
      const SEGCAP = 1
      const sh = Math.max(2, Math.floor((meterH - (SEGMENTS - 1) * SEGCAP) / SEGMENTS))
      const totalH = SEGMENTS * sh + (SEGMENTS - 1) * SEGCAP
      const yOff = ch - totalH

      const holdSegL = Math.round(peakL.current) - 1
      const holdSegR = Math.round(peakR.current) - 1

      for (let i = 0; i < SEGMENTS; i++) {
        const seg = SEGMENTS - 1 - i
        const y = yOff + i * (sh + SEGCAP)
        const [litCol, unlitCol] = segColors(seg)

        const litL = seg < segCountL
        const isPkL = seg === holdSegL && seg >= segCountL
        ctx.fillStyle = litL || isPkL ? litCol : unlitCol
        ctx.fillRect(0, y, bw, sh)

        const litR = seg < segCountR
        const isPkR = seg === holdSegR && seg >= segCountR
        ctx.fillStyle = litR || isPkR ? litCol : unlitCol
        ctx.fillRect(bw + COLGAP, y, bw, sh)
      }

      // dB tick marks
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      for (const markDb of [0, -9, -18, -36]) {
        const t = (markDb - DB_MIN) / (DB_MAX - DB_MIN)
        const seg = Math.round(t * (SEGMENTS - 1))
        const ii = SEGMENTS - 1 - seg
        const y = yOff + ii * (sh + SEGCAP) - 1
        if (y >= meterTop && y < ch) ctx.fillRect(0, y, cw, 1)
      }
    }

    rafId.current = requestAnimationFrame(tick)
    return () => { if (rafId.current !== null) cancelAnimationFrame(rafId.current) }
  }, [])

  return (
    <div data-tour="master-vu" className="w-16 shrink-0 flex flex-col border-l border-surface-border bg-surface-panel select-none">
      <div className="shrink-0 flex flex-col items-center pt-2 pb-1 gap-1">
        <span className="text-[8px] font-bold tracking-widest text-gray-500 uppercase">Out</span>
        <div className="flex w-full px-1 text-[7px] text-gray-700">
          <span className="flex-1 text-center">L</span>
          <span className="flex-1 text-center">R</span>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="w-full flex-1 min-h-0 cursor-pointer"
        title="Click to reset clip indicators"
        onClick={resetClip}
      />

    </div>
  )
}
