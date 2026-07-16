import { useEffect, useRef, useState, useCallback } from 'react'
import { useLibraryStore } from '../store/libraryStore'
import type { LibraryFile } from '../types'
import { pickColor } from './WaveformPreview'

interface Props {
  file: LibraryFile
  onSave: (updates: {
    introEndMs: number | null
    outroStartMs: number | null
    fadeInCurve: LibraryFile['fadeInCurve']
    fadeOutCurve: LibraryFile['fadeOutCurve']
    clipStartMs: number | null
    clipEndMs: number | null
  }) => void
  onClose: () => void
}

function timeToX(timeS: number, duration: number, vs: number, ve: number, w: number): number {
  return ((timeS / duration - vs) / (ve - vs)) * w
}
function xToTime(x: number, duration: number, vs: number, ve: number, w: number): number {
  return (vs + (x / w) * (ve - vs)) * duration
}
function formatMs(ms: number): string {
  const s = ms / 1000
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1)
  return `${m}:${sec.padStart(4, '0')}`
}

// Power-law fade overlay matching Limina Mix. curve ∈ [-1, 1]: 0=linear, -1=slow/concave, 1=fast/convex.
// exponent = 4^(-curve); fade-in gain(t) = t^exp, fade-out gain(t) = (1-t)^exp.
function drawFadeShape(
  ctx: CanvasRenderingContext2D,
  lx: number,
  rx: number,
  isFadeIn: boolean,
  curve: number,
  fillStyle: string,
  strokeStyle: string,
  mid: number,
  h: number,
  canvasW: number,
): void {
  const vlx = Math.max(lx, 0)
  const vrx = Math.min(rx, canvasW)
  if (vlx >= vrx) return

  const N = 32
  const exponent = Math.pow(4, -curve)
  const span = rx - lx

  const samples: Array<[number, number]> = []
  for (let i = 0; i <= N; i++) {
    const px = vlx + (vrx - vlx) * (i / N)
    const t = span > 0 ? Math.max(0, Math.min(1, (px - lx) / span)) : (isFadeIn ? 1 : 0)
    const gain = isFadeIn ? Math.pow(t, exponent) : Math.pow(1 - t, exponent)
    samples.push([px, mid * (1 - gain)])
  }

  ctx.fillStyle = fillStyle
  ctx.setLineDash([])

  ctx.beginPath()
  ctx.moveTo(vlx, 0); ctx.lineTo(vrx, 0)
  ctx.lineTo(samples[N][0], samples[N][1])
  for (let i = N - 1; i >= 0; i--) ctx.lineTo(samples[i][0], samples[i][1])
  ctx.closePath(); ctx.fill()

  ctx.beginPath()
  ctx.moveTo(vlx, h); ctx.lineTo(vrx, h)
  ctx.lineTo(samples[N][0], h - samples[N][1])
  for (let i = N - 1; i >= 0; i--) ctx.lineTo(samples[i][0], h - samples[i][1])
  ctx.closePath(); ctx.fill()

  ctx.strokeStyle = strokeStyle; ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(samples[0][0], samples[0][1])
  for (let i = 1; i <= N; i++) ctx.lineTo(samples[i][0], samples[i][1])
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(samples[0][0], h - samples[0][1])
  for (let i = 1; i <= N; i++) ctx.lineTo(samples[i][0], h - samples[i][1])
  ctx.stroke()
}

export function MixCueEditorModal({ file, onSave, onClose }: Props): JSX.Element {
  const updateFile = useLibraryStore((s) => s.updateFile)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasW, setCanvasW] = useState(0)

  const [peaks, setPeaks] = useState(file.peaks)
  const [loadingPeaks, setLoadingPeaks] = useState(false)

  const [introEnd, setIntroEnd] = useState(file.introEndMs)
  const [outroStart, setOutroStart] = useState(file.outroStartMs)
  const [fadeInCurve, setFadeInCurve] = useState(file.fadeInCurve)
  const [fadeOutCurve, setFadeOutCurve] = useState(file.fadeOutCurve)
  const [clipStart, setClipStart] = useState(file.clipStartMs)
  const [clipEnd, setClipEnd] = useState(file.clipEndMs)

  const [viewStart, setViewStart] = useState(0)
  const [viewEnd, setViewEnd] = useState(1)

  const [serverPort, setServerPort] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playheadTime, setPlayheadTime] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef<number | null>(null)

  const viewRef = useRef({ start: 0, end: 1 })
  const introEndRef = useRef(file.introEndMs)
  const outroStartRef = useRef(file.outroStartMs)
  const clipStartRef = useRef(file.clipStartMs)
  const clipEndRef = useRef(file.clipEndMs)
  const fadeInCurveRef = useRef(file.fadeInCurve)
  const fadeOutCurveRef = useRef(file.fadeOutCurve)
  const draggingRef = useRef<'clipStart' | 'clipEnd' | 'intro' | 'outro' | 'pan' | null>(null)
  const panBaseRef = useRef({ x: 0, viewStart: 0, viewEnd: 1 })
  const fadeDragRef = useRef<{ startY: number; startCurve: number } | null>(null)

  useEffect(() => { viewRef.current = { start: viewStart, end: viewEnd } }, [viewStart, viewEnd])
  useEffect(() => { introEndRef.current = introEnd }, [introEnd])
  useEffect(() => { outroStartRef.current = outroStart }, [outroStart])
  useEffect(() => { clipStartRef.current = clipStart }, [clipStart])
  useEffect(() => { clipEndRef.current = clipEnd }, [clipEnd])
  useEffect(() => { fadeInCurveRef.current = fadeInCurve }, [fadeInCurve])
  useEffect(() => { fadeOutCurveRef.current = fadeOutCurve }, [fadeOutCurve])

  const duration = file.duration

  useEffect(() => {
    window.electronAPI.getAudioServerPort().then(setServerPort)
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const tickPlayhead = useCallback(() => {
    const audio = audioRef.current
    if (!audio || audio.paused) return
    setPlayheadTime(audio.currentTime)
    rafRef.current = requestAnimationFrame(tickPlayhead)
  }, [])

  const togglePlay = useCallback(() => {
    if (!serverPort) return
    const audio = audioRef.current
    if (audio && !audio.paused) {
      audio.pause()
      setPlaying(false)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      return
    }
    const clipStartS = clipStartRef.current != null ? clipStartRef.current / 1000 : 0
    const src = `http://127.0.0.1:${serverPort}${encodeURI(file.filePath)}`
    const newAudio = audio ?? new Audio(src)
    if (!audio) {
      newAudio.src = src
      audioRef.current = newAudio
    }
    newAudio.currentTime = clipStartS
    newAudio.play().then(() => {
      setPlaying(true)
      window.dispatchEvent(new CustomEvent('app:audio-start', { detail: 'mix-cue-editor' }))
      rafRef.current = requestAnimationFrame(tickPlayhead)
    }).catch(console.error)
    const onEnded = (): void => { setPlaying(false); if (rafRef.current) cancelAnimationFrame(rafRef.current) }
    newAudio.addEventListener('ended', onEnded, { once: true })
  }, [serverPort, file.filePath, tickPlayhead])

  useEffect(() => {
    const onOtherAudio = (e: Event): void => {
      const detail = (e as CustomEvent).detail
      if (detail === 'mix-cue-editor') return
      audioRef.current?.pause()
      setPlaying(false)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    window.addEventListener('app:audio-start', onOtherAudio)
    return () => window.removeEventListener('app:audio-start', onOtherAudio)
  }, [])

  useEffect(() => {
    if (peaks.length >= 1000 || loadingPeaks) return
    setLoadingPeaks(true)
    window.electronAPI
      .getLibraryPeaks(file.filePath, 2000)
      .then((p) => { setPeaks(p); updateFile(file.id, { peaks: p }) })
      .catch(console.error)
      .finally(() => setLoadingPeaks(false))
  }, [file.filePath, file.id, peaks.length, loadingPeaks, updateFile])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => setCanvasW(canvas.offsetWidth))
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // ─── Canvas draw ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.offsetWidth
    const h = canvas.offsetHeight
    if (w === 0 || h === 0) return
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.setLineDash([])

    const mid = h / 2
    const clipStartS = clipStart != null ? clipStart / 1000 : 0
    const clipEndS = clipEnd != null ? clipEnd / 1000 : duration
    const introS = introEnd != null ? introEnd / 1000 : null
    const outroS = outroStart != null ? outroStart / 1000 : null

    const [colorPlayed, colorHead] = pickColor(file.id)
    const playheadS = playheadTime ?? -1

    if (peaks.length === 0) {
      ctx.fillStyle = '#374151'
      ctx.fillRect(0, mid - 0.5, w, 1)
    } else {
      // 1. Waveform bars — progress split at playhead, dimmed outside clip
      const startIdx = Math.floor(viewStart * peaks.length)
      const endIdx = Math.ceil(viewEnd * peaks.length)
      const visible = peaks.slice(startIdx, endIdx)
      const barW = w / Math.max(visible.length, 1)

      for (let i = 0; i < visible.length; i++) {
        const bx = i * barW
        const t = xToTime(bx + barW / 2, duration, viewStart, viewEnd, w)
        const inClip = t >= clipStartS && t <= clipEndS

        let fill: string; let alpha: number
        if (!inClip) {
          fill = '#4b5563'; alpha = 0.25
        } else if (t <= playheadS) {
          fill = colorPlayed; alpha = 0.9
        } else {
          fill = colorPlayed; alpha = 0.25
        }

        ctx.fillStyle = fill
        ctx.globalAlpha = alpha
        const barH = Math.max(1, visible[i] * h * 0.8)
        ctx.fillRect(bx, mid - barH / 2, Math.max(0.5, barW - 0.5), barH)
      }
      ctx.globalAlpha = 1
    }

    // 2. Shaped fade overlays (drawn after bars so they appear on top)
    if (introS !== null) {
      const lx = timeToX(clipStartS, duration, viewStart, viewEnd, w)
      const rx = timeToX(introS, duration, viewStart, viewEnd, w)
      drawFadeShape(ctx, lx, rx, true, fadeInCurve,
        'rgba(20,184,166,0.18)', 'rgba(20,184,166,0.65)', mid, h, w)
    }
    if (outroS !== null) {
      const lx = timeToX(outroS, duration, viewStart, viewEnd, w)
      const rx = timeToX(clipEndS, duration, viewStart, viewEnd, w)
      drawFadeShape(ctx, lx, rx, false, fadeOutCurve,
        'rgba(249,115,22,0.18)', 'rgba(249,115,22,0.65)', mid, h, w)
    }

    // 3. Dark overlay for excluded regions (before clip start / after clip end)
    ctx.setLineDash([])
    if (clipStart != null) {
      const csx = timeToX(clipStartS, duration, viewStart, viewEnd, w)
      if (csx > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.52)'
        ctx.fillRect(0, 0, Math.min(csx, w), h)
      }
    }
    if (clipEnd != null) {
      const cex = timeToX(clipEndS, duration, viewStart, viewEnd, w)
      if (cex < w) {
        ctx.fillStyle = 'rgba(0,0,0,0.52)'
        ctx.fillRect(Math.max(cex, 0), 0, w - Math.max(cex, 0), h)
      }
    }

    // 4. Handle lines + circle grips (circle at top, dual-drag for fade handles)
    const drawHandle = (timeS: number, color: string, label?: string): void => {
      const hx = timeToX(timeS, duration, viewStart, viewEnd, w)
      if (hx < -20 || hx > w + 20) return

      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, h); ctx.stroke()

      const cy = 10; const cr = 7
      ctx.beginPath(); ctx.arc(hx, cy, cr, 0, Math.PI * 2)
      ctx.fillStyle = color; ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5; ctx.stroke()

      if (label) {
        ctx.fillStyle = 'rgba(0,0,0,0.75)'
        ctx.font = `bold ${Math.round(8 * dpr) / dpr}px sans-serif`
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center'
        ctx.fillText(label, hx, cy)
        ctx.textAlign = 'left'
      }
    }

    // Clip handles drawn first (behind cue handles)
    if (clipStart != null) drawHandle(clipStartS, '#60a5fa', 'S')
    if (clipEnd != null) drawHandle(clipEndS, '#a78bfa', 'E')
    // Fade cue handles on top
    if (introEnd != null) drawHandle(introS!, '#14b8a6')
    if (outroStart != null) drawHandle(outroS!, '#f97316')

    // 5. Playhead
    if (playheadTime != null) {
      const phx = timeToX(playheadTime, duration, viewStart, viewEnd, w)
      if (phx >= 0 && phx <= w) {
        ctx.strokeStyle = colorHead
        ctx.lineWidth = 1.5
        ctx.setLineDash([])
        ctx.beginPath(); ctx.moveTo(phx, 0); ctx.lineTo(phx, h); ctx.stroke()
      }
    }

    // 6. Time ruler
    const visibleDurationS = (viewEnd - viewStart) * duration
    const tickInterval =
      visibleDurationS < 15 ? 2
      : visibleDurationS < 45 ? 5
      : visibleDurationS < 120 ? 15
      : visibleDurationS < 300 ? 30
      : 60

    const startT = viewStart * duration
    const firstTick = Math.ceil(startT / tickInterval) * tickInterval
    ctx.font = `${Math.round(9 * dpr) / dpr}px monospace`
    ctx.textBaseline = 'bottom'; ctx.textAlign = 'left'

    for (let t = firstTick; t < viewEnd * duration; t += tickInterval) {
      const tx = timeToX(t, duration, viewStart, viewEnd, w)
      ctx.fillStyle = '#4b5563'; ctx.fillRect(tx, h - 10, 1, 10)
      const min = Math.floor(t / 60); const sec = Math.floor(t % 60)
      ctx.fillStyle = '#6b7280'
      ctx.fillText(`${min}:${String(sec).padStart(2, '0')}`, tx + 3, h - 2)
    }

  }, [peaks, clipStart, clipEnd, introEnd, outroStart, fadeInCurve, fadeOutCurve, viewStart, viewEnd, duration, canvasW, playheadTime, file.id])

  // ─── Mouse events ─────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const w = rect.width
    const { start, end } = viewRef.current

    const ix = introEndRef.current != null ? timeToX(introEndRef.current / 1000, duration, start, end, w) : -Infinity
    const ox = outroStartRef.current != null ? timeToX(outroStartRef.current / 1000, duration, start, end, w) : Infinity
    const csx = clipStartRef.current != null ? timeToX(clipStartRef.current / 1000, duration, start, end, w) : -Infinity
    const cex = clipEndRef.current != null ? timeToX(clipEndRef.current / 1000, duration, start, end, w) : Infinity

    // Clip handles → fade cue handles (dual drag: X=position, Y=curve) → pan
    if (clipStartRef.current != null && Math.abs(x - csx) < 12) {
      draggingRef.current = 'clipStart'
    } else if (clipEndRef.current != null && Math.abs(x - cex) < 12) {
      draggingRef.current = 'clipEnd'
    } else if (introEndRef.current != null && Math.abs(x - ix) < 12) {
      draggingRef.current = 'intro'
      fadeDragRef.current = { startY: e.clientY, startCurve: fadeInCurveRef.current }
    } else if (outroStartRef.current != null && Math.abs(x - ox) < 12) {
      draggingRef.current = 'outro'
      fadeDragRef.current = { startY: e.clientY, startCurve: fadeOutCurveRef.current }
    } else {
      draggingRef.current = 'pan'
      panBaseRef.current = { x, viewStart: start, viewEnd: end }
    }
    e.preventDefault()
  }, [duration])

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!draggingRef.current) return
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
      const w = rect.width
      const h = rect.height
      const { start, end } = viewRef.current

      if (draggingRef.current === 'pan') {
        const { x: bx, viewStart: bs, viewEnd: be } = panBaseRef.current
        const vw = be - bs
        const dx = ((x - bx) / w) * vw
        const ns = Math.max(0, Math.min(bs - dx, 1 - vw))
        setViewStart(ns); setViewEnd(ns + vw)
        return
      }

      const t = Math.max(0, Math.min(xToTime(x, duration, start, end, w), duration))

      if (draggingRef.current === 'clipStart') {
        const clipE = clipEndRef.current != null ? clipEndRef.current / 1000 : duration
        const introE = introEndRef.current != null ? introEndRef.current / 1000 : clipE
        setClipStart(Math.round(Math.min(t, Math.min(clipE, introE)) * 1000))
      } else if (draggingRef.current === 'clipEnd') {
        const clipS = clipStartRef.current != null ? clipStartRef.current / 1000 : 0
        const outroS = outroStartRef.current != null ? outroStartRef.current / 1000 : clipS
        setClipEnd(Math.round(Math.max(t, Math.max(clipS, outroS)) * 1000))
      } else if (draggingRef.current === 'intro') {
        const clipS = clipStartRef.current != null ? clipStartRef.current / 1000 : 0
        const maxT = outroStartRef.current != null
          ? outroStartRef.current / 1000
          : (clipEndRef.current != null ? clipEndRef.current / 1000 : duration)
        setIntroEnd(Math.round(Math.min(Math.max(t, clipS), maxT) * 1000))
        if (fadeDragRef.current) {
          const fd = fadeDragRef.current
          const newCurve = Math.max(-1, Math.min(1, fd.startCurve - (e.clientY - fd.startY) / (h / 2)))
          setFadeInCurve(newCurve)
        }
      } else {
        const clipE = clipEndRef.current != null ? clipEndRef.current / 1000 : duration
        const minT = introEndRef.current != null
          ? introEndRef.current / 1000
          : (clipStartRef.current != null ? clipStartRef.current / 1000 : 0)
        setOutroStart(Math.round(Math.max(Math.min(t, clipE), minT) * 1000))
        if (fadeDragRef.current) {
          const fd = fadeDragRef.current
          const newCurve = Math.max(-1, Math.min(1, fd.startCurve - (e.clientY - fd.startY) / (h / 2)))
          setFadeOutCurve(newCurve)
        }
      }
    }
    const onUp = (e: MouseEvent): void => {
      if (draggingRef.current === 'pan') {
        const canvas = canvasRef.current
        if (canvas) {
          const rect = canvas.getBoundingClientRect()
          const upX = e.clientX - rect.left
          const dx = Math.abs(upX - panBaseRef.current.x)
          if (dx < 4) {
            const { start, end } = viewRef.current
            const t = Math.max(0, Math.min(xToTime(panBaseRef.current.x, duration, start, end, rect.width), duration))
            const audio = audioRef.current
            if (audio) {
              audio.currentTime = t
              setPlayheadTime(t)
            }
          }
        }
      }
      draggingRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [duration])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>): void => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const w = rect.width
    const { start, end } = viewRef.current
    const frac = x / w
    const focal = start + frac * (end - start)
    const zf = e.deltaY > 0 ? 1.25 : 0.8
    const nw = Math.min(1, Math.max(0.02, (end - start) * zf))
    const ns = Math.max(0, Math.min(focal - frac * nw, 1 - nw))
    setViewStart(ns); setViewEnd(ns + nw)
  }, [])

  const [cursor, setCursor] = useState<string>('grab')
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (draggingRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const w = rect.width
    const { start, end } = viewRef.current

    const ix = introEndRef.current != null ? timeToX(introEndRef.current / 1000, duration, start, end, w) : -Infinity
    const ox = outroStartRef.current != null ? timeToX(outroStartRef.current / 1000, duration, start, end, w) : Infinity
    const csx = clipStartRef.current != null ? timeToX(clipStartRef.current / 1000, duration, start, end, w) : -Infinity
    const cex = clipEndRef.current != null ? timeToX(clipEndRef.current / 1000, duration, start, end, w) : Infinity

    if ([ix, ox].some((hx) => Math.abs(x - hx) < 12)) { setCursor('move'); return }
    if ([csx, cex].some((hx) => Math.abs(x - hx) < 12)) { setCursor('ew-resize'); return }
    setCursor('grab')
  }, [duration])

  function placeIntroHandle(): void {
    const clipS = clipStart != null ? clipStart / 1000 : 0
    const clipE = clipEnd != null ? clipEnd / 1000 : duration
    setIntroEnd(Math.round((clipS + Math.min(30, (clipE - clipS) * 0.15)) * 1000))
  }
  function placeOutroHandle(): void {
    const clipE = clipEnd != null ? clipEnd / 1000 : duration
    const clipS = clipStart != null ? clipStart / 1000 : 0
    setOutroStart(Math.round(Math.max(clipE - 30, clipS + (clipE - clipS) * 0.85) * 1000))
  }

  const numInput = 'text-[11px] text-gray-200 bg-surface-hover border border-surface-border rounded px-2 py-1 outline-none focus:border-accent/50 placeholder-gray-600 w-full'

  function curveLabel(v: number): string {
    if (v <= -0.7) return 'Slow'
    if (v <= -0.25) return 'Concave'
    if (v < 0.25) return 'Linear'
    if (v < 0.7) return 'Convex'
    return 'Fast'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-surface-panel rounded-xl shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">Mix Cue Editor</h2>
            <p className="text-[11px] text-gray-500 mt-0.5 truncate">{file.trackTitle || file.fileName}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors ml-4 shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>

        {/* Waveform canvas */}
        <div className="px-6 pt-5 shrink-0">
          <canvas
            ref={canvasRef}
            className="w-full rounded"
            style={{ height: 160, cursor }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onWheel={handleWheel}
          />
          <div className="flex items-center justify-between mt-1.5">
            <button
              type="button"
              onClick={togglePlay}
              disabled={!serverPort}
              className={`flex items-center justify-center w-6 h-6 rounded-full border transition-colors disabled:opacity-40 ${
                playing
                  ? 'border-accent text-accent'
                  : 'border-gray-600 text-gray-500 hover:border-accent hover:text-accent'
              }`}
              title={playing ? 'Pause' : 'Play from clip start'}
            >
              {playing ? (
                <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor">
                  <rect x="1.5" y="1" width="2.5" height="8" rx="0.5" />
                  <rect x="6" y="1" width="2.5" height="8" rx="0.5" />
                </svg>
              ) : (
                <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor">
                  <path d="M2 1.5l7 3.5-7 3.5V1.5z" />
                </svg>
              )}
            </button>
            <p className="text-[10px] text-gray-600 select-none">
              Scroll to zoom · Drag to pan · Drag handles to adjust
              {loadingPeaks && <span className="ml-2 text-gray-500">Loading waveform…</span>}
            </p>
            <div className="w-6" />
          </div>
        </div>

        {/* Fade cue controls */}
        <div className="grid grid-cols-2 gap-5 px-6 pt-5">

          {/* ── Intro / Fade-in ── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-teal-500 shrink-0" />
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Intro ends</span>
              {introEnd != null && (
                <span className="ml-auto font-mono text-[11px] text-teal-400">{formatMs(introEnd)}</span>
              )}
            </div>

            {introEnd == null ? (
              <button onClick={placeIntroHandle}
                className="w-full py-1.5 text-[11px] rounded border border-teal-500/30 bg-teal-500/8 text-teal-400 hover:bg-teal-500/15 transition-colors">
                + Place intro cue
              </button>
            ) : (
              <div className="flex gap-1.5">
                <input type="number" value={(introEnd / 1000).toFixed(1)} step="0.5" min="0"
                  onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setIntroEnd(Math.round(v * 1000)) }}
                  className={numInput} />
                <button onClick={() => setIntroEnd(null)}
                  className="px-2.5 text-[10px] text-gray-500 hover:text-red-400 border border-surface-border rounded transition-colors shrink-0">
                  Clear
                </button>
              </div>
            )}

            {introEnd != null && (
              <p className="text-[10px] text-gray-600 mt-0.5">
                Curve: <span className="text-teal-500">{curveLabel(fadeInCurve)}</span>
                <span className="text-gray-700 ml-1">— drag the circle on the waveform</span>
              </p>
            )}
          </div>

          {/* ── Outro / Fade-out ── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Outro starts</span>
              {outroStart != null && (
                <span className="ml-auto font-mono text-[11px] text-orange-400">{formatMs(outroStart)}</span>
              )}
            </div>

            {outroStart == null ? (
              <button onClick={placeOutroHandle}
                className="w-full py-1.5 text-[11px] rounded border border-orange-500/30 bg-orange-500/8 text-orange-400 hover:bg-orange-500/15 transition-colors">
                + Place outro cue
              </button>
            ) : (
              <div className="flex gap-1.5">
                <input type="number" value={(outroStart / 1000).toFixed(1)} step="0.5" min="0"
                  onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setOutroStart(Math.round(v * 1000)) }}
                  className={numInput} />
                <button onClick={() => setOutroStart(null)}
                  className="px-2.5 text-[10px] text-gray-500 hover:text-red-400 border border-surface-border rounded transition-colors shrink-0">
                  Clear
                </button>
              </div>
            )}

            {outroStart != null && (
              <p className="text-[10px] text-gray-600 mt-0.5">
                Curve: <span className="text-orange-500">{curveLabel(fadeOutCurve)}</span>
                <span className="text-gray-700 ml-1">— drag the circle on the waveform</span>
              </p>
            )}
          </div>
        </div>

        {/* Clip trim controls */}
        <div className="grid grid-cols-2 gap-5 px-6 pt-3 pb-2">

          {/* ── Clip Start ── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Clip start</span>
              {clipStart != null && (
                <span className="ml-auto font-mono text-[11px] text-blue-400">{formatMs(clipStart)}</span>
              )}
            </div>

            {clipStart == null ? (
              <button onClick={() => setClipStart(0)}
                className="w-full py-1.5 text-[11px] rounded border border-blue-400/30 bg-blue-400/8 text-blue-400 hover:bg-blue-400/15 transition-colors">
                + Set clip start
              </button>
            ) : (
              <div className="flex gap-1.5">
                <input type="number" value={(clipStart / 1000).toFixed(1)} step="0.5" min="0"
                  onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setClipStart(Math.round(v * 1000)) }}
                  className={numInput} />
                <button onClick={() => setClipStart(null)}
                  className="px-2.5 text-[10px] text-gray-500 hover:text-red-400 border border-surface-border rounded transition-colors shrink-0">
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* ── Clip End ── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-violet-400 shrink-0" />
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Clip end</span>
              {clipEnd != null && (
                <span className="ml-auto font-mono text-[11px] text-violet-400">{formatMs(clipEnd)}</span>
              )}
            </div>

            {clipEnd == null ? (
              <button onClick={() => setClipEnd(Math.round(duration * 1000))}
                className="w-full py-1.5 text-[11px] rounded border border-violet-400/30 bg-violet-400/8 text-violet-400 hover:bg-violet-400/15 transition-colors">
                + Set clip end
              </button>
            ) : (
              <div className="flex gap-1.5">
                <input type="number" value={(clipEnd / 1000).toFixed(1)} step="0.5" min="0"
                  onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setClipEnd(Math.round(v * 1000)) }}
                  className={numInput} />
                <button onClick={() => setClipEnd(null)}
                  className="px-2.5 text-[10px] text-gray-500 hover:text-red-400 border border-surface-border rounded transition-colors shrink-0">
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 mt-1 border-t border-surface-border shrink-0">
          <div className="flex items-center gap-4 text-[10px] text-gray-600">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />Clip
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500 inline-block" />Fade-in
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />Fade-out
            </span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-3 py-1.5 text-[11px] text-gray-400 hover:text-white border border-surface-border rounded transition-colors">
              Cancel
            </button>
            <button
              onClick={() => {
                onSave({ introEndMs: introEnd, outroStartMs: outroStart, fadeInCurve, fadeOutCurve, clipStartMs: clipStart, clipEndMs: clipEnd })
                onClose()
              }}
              className="px-4 py-1.5 text-[11px] text-white bg-accent rounded hover:bg-accent/80 transition-colors"
            >
              Save cue points
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
