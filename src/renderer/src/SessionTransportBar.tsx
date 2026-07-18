import { useEffect, useRef, useState } from 'react'
import { useLibraryStore } from './library/store/libraryStore'
import type { LibraryFile } from './library/types'
import { peekMixEngine } from './library/lib/mixEngineSingleton'
import { BREATHWORK_PHASES, PHASE_COLORS } from './library/types'
import { SharedNowPlayingOverlay } from './SharedNowPlayingOverlay'
import { useUIStore } from './uiStore'

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

/**
 * Session-mode transport bar shown at the bottom of Library and Playlists
 * workspaces when the Auto-Mix engine has a current track, the user is not in
 * session mode, and no library track preview is active.
 */
export function SessionTransportBar(): JSX.Element | null {
  const cur = useLibraryStore((s) => s.mixPlayback.current)
  const playing = useLibraryStore((s) => s.mixPlayback.playing)
  const fading = useLibraryStore((s) => s.mixPlayback.fading)
  const state = useLibraryStore((s) => s.mixPlayback)
  const mixMode = useLibraryStore((s) => s.mixMode)
  const files = useLibraryStore((s) => s.files)
  const updateFile = useLibraryStore((s) => s.updateFile)
  const previewFileId = useLibraryStore((s) => s.previewFileId)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasWidth, setCanvasWidth] = useState(0)
  const [overlayOpen, setOverlayOpen] = useState(false)

  const file: LibraryFile | null = cur
    ? (files.find((f) => f.id === cur.id) ?? cur)
    : null

  // Canvas resize observer
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => setCanvasWidth(canvas.offsetWidth))
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // Load peaks if missing
  useEffect(() => {
    if (!file || file.peaks.length > 0) return
    window.electronAPI.getLibraryPeaks(file.filePath, 800)
      .then((p) => updateFile(file.id, { peaks: p }))
      .catch(() => {})
  }, [file?.id, file?.peaks.length, updateFile])

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !file) return
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

    const mid = h / 2
    if (file.peaks.length === 0) {
      ctx.fillStyle = '#2a2a3a'
      ctx.fillRect(0, mid - 0.5, w, 1)
      return
    }

    const dur = state.duration || file.duration || 0
    const splitX = dur > 0 ? (state.currentTime / dur) * w : 0
    const barW = w / file.peaks.length

    for (let i = 0; i < file.peaks.length; i++) {
      const x = i * barW
      const barH = Math.max(1, file.peaks[i] * h * 0.85)
      const played = x < splitX
      ctx.fillStyle = played && !fading ? '#f2a65a' : '#4b4660'
      ctx.globalAlpha = played && !fading ? 1 : 0.35
      ctx.fillRect(x, mid - barH / 2, Math.max(0.5, barW - 0.5), barH)
    }
    ctx.globalAlpha = 1
    if (splitX > 0) {
      ctx.fillStyle = fading ? '#9ca3af' : '#ffd9a8'
      ctx.fillRect(Math.round(splitX) - 0.5, 0, 1, h)
    }
  }, [file, file?.peaks, file?.peaks.length, state.currentTime, state.duration, fading, canvasWidth])

  const devForceEmpty = useUIStore((s) => s.devForceEmpty)
  // Hide when in session mode (MixPanel owns the transport),
  // when no track is loaded, when a library preview is active, or dev empty mode.
  if (mixMode || !file || previewFileId || (import.meta.env.DEV && devForceEmpty)) return null

  const eng = peekMixEngine()
  const albumImageUrl = file.albumImageUrl ?? null
  const title = file.trackTitle || file.fileName
  const phase = file.breathworkPhase
  const phaseLabel = phase ? (BREATHWORK_PHASES.find((p) => p.value === phase)?.label ?? null) : null
  const phaseColor = phase ? PHASE_COLORS[phase] : null

  const handleSeek = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current
    if (!canvas || !file.duration) return
    const rect = canvas.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    eng?.seekFadeTo(frac * file.duration)
  }

  return (
    <>
      <div className="flex items-center gap-3 px-4 h-16 border-t shrink-0 border-surface-border bg-surface-panel">
        {/* Transport */}
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={() => eng?.toggle()} title={playing ? 'Pause' : 'Play'}
            className="flex items-center justify-center w-7 h-7 rounded-full border border-surface-border bg-surface-hover text-gray-300 hover:text-white hover:bg-accent/20 hover:border-accent/50 transition-colors">
            {playing
              ? <svg className="w-3 h-3" viewBox="0 0 10 10" fill="currentColor"><rect x="1.5" y="1" width="2.5" height="8" rx="0.5" /><rect x="6" y="1" width="2.5" height="8" rx="0.5" /></svg>
              : <svg className="w-3 h-3" viewBox="0 0 10 10" fill="currentColor"><path d="M2 1.5l7 3.5-7 3.5V1.5z" /></svg>}
          </button>
          <button type="button" onClick={() => eng?.next()} title="Skip to next"
            className="flex items-center justify-center w-6 h-6 text-gray-500 rounded transition-colors hover:text-gray-200">
            <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="currentColor"><path d="M10 2h-1.5v8H10zM1.5 2l6 4-6 4V2z" /></svg>
          </button>
        </div>

        {/* Album art + title — click to expand overlay */}
        <button
          type="button"
          className="group flex items-center gap-2 w-48 min-w-0 shrink-0 cursor-pointer"
          onClick={() => setOverlayOpen(true)}
          title="Expand now playing"
        >
          <div className="relative shrink-0">
            {albumImageUrl ? (
              <img src={albumImageUrl} alt="" className="object-cover w-10 h-10 rounded" />
            ) : (
              <div className="w-10 h-10 rounded bg-surface-hover flex items-center justify-center">
                <svg className="w-4 h-4 text-gray-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z" />
                </svg>
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center rounded bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 1h4v4M5 7L11 1M1 5v6h6" />
              </svg>
            </div>
          </div>
          <div className="flex flex-col justify-center min-w-0">
            <span className="text-[11px] text-gray-200 truncate leading-tight">{title}</span>
            {file.artist && <span className="text-[10px] text-gray-500 truncate leading-tight mt-0.5">{file.artist}</span>}
          </div>
        </button>

        {fading && (
          <svg className="w-3 h-3 text-accent shrink-0 animate-pulse" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 5h9l-2-2M15 11H6l2 2" />
          </svg>
        )}

        {/* Waveform — click to seek */}
        <canvas
          ref={canvasRef}
          className="flex-1 min-w-0 h-8 rounded cursor-pointer"
          onClick={handleSeek}
          title="Click to seek"
        />

        {/* Time */}
        <span className="font-mono text-[10px] tabular-nums text-gray-600 shrink-0 text-right w-20">
          {fmt(state.currentTime)}
          <span className="mx-0.5 text-gray-700">/</span>
          {fmt(state.duration || file.duration)}
        </span>
      </div>

      {overlayOpen && (
        <SharedNowPlayingOverlay
          colorSeed={file.id}
          title={title}
          artist={file.artist || null}
          albumImageUrl={albumImageUrl}
          peaks={file.peaks}
          duration={file.duration}
          currentTime={state.currentTime}
          playing={playing}
          hasPrev={false}
          hasNext={true}
          onTogglePlay={() => eng?.toggle()}
          onNavigate={(dir) => { if (dir === 1) eng?.next() }}
          onClose={() => setOverlayOpen(false)}
          tags={file.tags}
          breathworkPhaseLabel={phaseLabel}
          breathworkPhaseColor={phaseColor}
          mfbTrackId={file.mfbTrackId}
        />
      )}
    </>
  )
}
