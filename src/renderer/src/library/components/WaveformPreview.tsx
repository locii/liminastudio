import { useEffect, useRef, useState, useCallback } from 'react'
import { useLibraryStore } from '../store/libraryStore'
import { audioStreamUrl } from '../lib/audioStreamUrl'

interface Props {
  fileId: string
  filePath: string
  duration: number
  peaks: number[]
  sampleRate?: number
  clipStartMs?: number | null
  clipEndMs?: number | null
  introEndMs?: number | null
  outroStartMs?: number | null
  onSetCuePoints?: () => void
}

const WAVEFORM_COLORS: [string, string][] = [
  ['#6366f1', '#818cf8'], // indigo
  ['#a855f7', '#c084fc'], // purple
  ['#ec4899', '#f472b6'], // pink
  ['#f43f5e', '#fb7185'], // rose
  ['#f97316', '#fb923c'], // orange
  ['#f59e0b', '#fbbf24'], // amber
  ['#22c55e', '#4ade80'], // green
  ['#14b8a6', '#2dd4bf'], // teal
  ['#06b6d4', '#22d3ee'], // cyan
  ['#0ea5e9', '#38bdf8'], // sky
]

export function pickColor(fileId: string): [string, string] {
  const hash = fileId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return WAVEFORM_COLORS[hash % WAVEFORM_COLORS.length]
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function WaveformPreview({ fileId, filePath, duration, peaks, sampleRate, clipStartMs, clipEndMs, introEndMs, outroStartMs, onSetCuePoints }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const updateFile = useLibraryStore((s) => s.updateFile)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [port, setPort] = useState<number | null>(null)
  const [loadingPeaks, setLoadingPeaks] = useState(false)
  const [canvasWidth, setCanvasWidth] = useState(0)

  // Get audio server port once
  useEffect(() => {
    window.electronAPI.getAudioServerPort().then(setPort)
  }, [])

  // Track canvas size so the draw effect re-fires once layout is complete
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => setCanvasWidth(canvas.offsetWidth))
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // Fetch waveform peaks if not cached
  useEffect(() => {
    if (peaks.length > 0 || loadingPeaks) return
    setLoadingPeaks(true)
    window.electronAPI
      .getLibraryPeaks(filePath, 800)
      .then((p) => updateFile(fileId, { peaks: p }))
      .catch(console.error)
      .finally(() => setLoadingPeaks(false))
  }, [fileId, filePath, peaks.length, loadingPeaks, updateFile])

  // Create audio element; replace when file changes
  useEffect(() => {
    if (port === null) return
    const audio = new Audio(audioStreamUrl(port, filePath, sampleRate))
    audioRef.current = audio
    audio.addEventListener('ended', () => { setPlaying(false); setCurrentTime(0) })
    return () => {
      audio.pause()
      audioRef.current = null
      setPlaying(false)
      setCurrentTime(0)
    }
  }, [filePath, port])

  // RAF loop for playhead position
  useEffect(() => {
    if (!playing) return
    const tick = (): void => {
      if (audioRef.current) setCurrentTime(audioRef.current.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [playing])

  // Draw waveform on canvas
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

    if (peaks.length === 0) {
      // Empty state — draw a flat line
      ctx.fillStyle = '#2a2a3a'
      ctx.fillRect(0, h / 2 - 0.5, w, 1)
      return
    }

    const [colorPlayed, colorHead] = pickColor(fileId)
    const barW = w / peaks.length
    const mid = h / 2
    const splitX = duration > 0 ? (currentTime / duration) * w : 0

    ctx.fillStyle = colorPlayed
    for (let i = 0; i < peaks.length; i++) {
      const x = i * barW
      const barH = Math.max(1, peaks[i] * h * 0.85)
      ctx.globalAlpha = x < splitX ? 1 : 0.25
      ctx.fillRect(x, mid - barH / 2, Math.max(0.5, barW - 0.5), barH)
    }
    ctx.globalAlpha = 1

    // Playhead
    if (splitX > 0) {
      ctx.fillStyle = colorHead
      ctx.fillRect(Math.round(splitX) - 0.5, 0, 1, h)
    }

    // Cue markers
    const drawCueLine = (timeMs: number, color: string): void => {
      if (duration === 0) return
      const x = Math.round((timeMs / 1000 / duration) * w)
      if (x < 0 || x > w) return
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
    if (clipStartMs != null) drawCueLine(clipStartMs, '#60a5fa')
    if (clipEndMs != null) drawCueLine(clipEndMs, '#a78bfa')
    if (introEndMs != null) drawCueLine(introEndMs, '#14b8a6')
    if (outroStartMs != null) drawCueLine(outroStartMs, '#f97316')
  }, [peaks, currentTime, duration, fileId, canvasWidth, clipStartMs, clipEndMs, introEndMs, outroStartMs])

  // Stop when table preview starts
  useEffect(() => {
    const handler = (e: Event): void => {
      if ((e as CustomEvent).detail !== 'waveform' && playing) {
        audioRef.current?.pause()
        setPlaying(false)
      }
    }
    window.addEventListener('app:audio-start', handler)
    return () => window.removeEventListener('app:audio-start', handler)
  }, [playing])

  const togglePlay = useCallback((): void => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      audio.play().then(() => {
        setPlaying(true)
        window.dispatchEvent(new CustomEvent('app:audio-start', { detail: 'waveform' }))
      }).catch(console.error)
    }
  }, [playing])

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current
    const audio = audioRef.current
    if (!canvas || !audio || duration === 0) return
    const rect = canvas.getBoundingClientRect()
    const seekTime = ((e.clientX - rect.left) / rect.width) * duration
    audio.currentTime = seekTime
    setCurrentTime(seekTime)
  }, [duration])

  return (
    <div className="flex flex-col gap-2 p-3 border-b border-surface-border">
      <canvas
        ref={canvasRef}
        className="w-full h-14 rounded cursor-pointer"
        onClick={handleCanvasClick}
        title="Click to seek"
      />
      <div className="flex gap-2 items-center">
        <button
          onClick={togglePlay}
          disabled={port === null}
          className="flex justify-center items-center w-6 h-6 text-gray-400 rounded-full border transition-colors bg-surface-hover hover:bg-accent/20 border-surface-border hover:text-accent shrink-0 disabled:opacity-40"
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
        <span className="font-mono text-[10px] tabular-nums text-gray-600">
          {formatTime(currentTime)}
          <span className="mx-1 text-gray-500">/</span>
          {formatTime(duration)}
        </span>
        {loadingPeaks && (
          <span className="ml-auto text-[10px] text-gray-500">Loading waveform…</span>
        )}
        {onSetCuePoints && (
          <button
            type="button"
            onClick={onSetCuePoints}
            className="ml-auto text-[10px] text-gray-500 hover:text-gray-200 transition-colors"
          >
            Set Cue Points
          </button>
        )}
      </div>
    </div>
  )
}
