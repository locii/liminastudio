import { useEffect, useRef } from 'react'
import WaveSurfer from 'wavesurfer.js'

interface Props {
  trackId: string
  peaks: number[]
  duration: number
  color: string
  playhead: number
  loading: boolean
}

export function WaveformDisplay({ peaks, duration, color, playhead, loading }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)

  // Create WaveSurfer when peaks arrive
  useEffect(() => {
    if (!containerRef.current || peaks.length === 0 || duration === 0) return

    // Destroy previous instance
    wsRef.current?.destroy()
    wsRef.current = null

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: color,
      progressColor: color + '66', // 40% opacity tint for progress
      cursorWidth: 0,
      height: 72,
      interact: false,
      normalize: true,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
    })

    // Load waveform from peaks only — no audio decoding in renderer
    ws.load('', [Float32Array.from(peaks)], duration)

    wsRef.current = ws

    return () => {
      ws.destroy()
      wsRef.current = null
    }
  }, [peaks, duration, color])

  // Update progress line visually — WaveSurfer is not used for audio playback
  useEffect(() => {
    const ws = wsRef.current
    if (!ws) return
    if (duration <= 0) return
    const progress = Math.min(1, Math.max(0, playhead / duration))
    try {
      ws.seekTo(progress)
    } catch {
      // ignore if not ready
    }
  }, [playhead, duration])

  const playheadPct = duration > 0 ? (playhead / duration) * 100 : 0

  return (
    <div className="relative flex-1 h-[80px] bg-surface-panel overflow-hidden rounded-sm">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      <div ref={containerRef} className="w-full h-full" />

      {/* Custom playhead line — reliable regardless of WaveSurfer state */}
      {!loading && duration > 0 && (
        <div
          className="absolute inset-y-0 w-px bg-red-500 pointer-events-none z-20"
          style={{ left: `${playheadPct}%` }}
        />
      )}
    </div>
  )
}
