import { useCallback, useState } from 'react'
import type React from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { useTransportStore } from '../../store/transportStore'
import { useUpdaterStore } from '../../store/updaterStore'
import { audioEngine } from '../../audio/audioEngine'
import { NowPlayingOverlay } from '../NowPlayingOverlay'
import type { Clip } from '../../types'

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`
}

function getSortedBoundaries(clips: Clip[]): number[] {
  const set = new Set(clips.map((c) => Math.round(c.startTime * 100) / 100))
  return [...set].sort((a, b) => a - b)
}

function getEndTime(clips: Clip[]): number {
  if (clips.length === 0) return 0
  return Math.max(...clips.map((c) => c.startTime + c.duration - c.trimStart - c.trimEnd))
}

export function BottomTransport(): JSX.Element {
  const playing = useTransportStore((s) => s.playing)
  const playhead = useTransportStore((s) => s.playhead)
  const masterVolume = useTransportStore((s) => s.masterVolume)
  const setMasterVolume = useTransportStore((s) => s.setMasterVolume)
  const tracks = useSessionStore((s) => s.tracks)
  const clips = useSessionStore((s) => s.clips)
  const [overlayOpen, setOverlayOpen] = useState(false)

  const { downloading, downloadPercent, readyVersion } = useUpdaterStore()
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'upToDate'>('idle')

  const handleCheckForUpdates = useCallback(async (): Promise<void> => {
    if (checkState !== 'idle') return
    setCheckState('checking')
    try {
      const [result] = await Promise.all([
        window.electronAPI.checkForUpdates(),
        new Promise<void>((r) => setTimeout(r, 800)),
      ])
      if (!result.hasUpdate) {
        setCheckState('upToDate')
        setTimeout(() => setCheckState('idle'), 3000)
      } else {
        setCheckState('idle')
      }
    } catch {
      setCheckState('upToDate')
      setTimeout(() => setCheckState('idle'), 3000)
    }
  }, [checkState])

  const currentClip = clips.find((c) => {
    const end = c.startTime + c.duration - c.trimStart - c.trimEnd
    return playhead >= c.startTime && playhead < end
  }) ?? null

  const handlePlayStop = useCallback(async () => {
    if (playing) audioEngine.pause()
    else await audioEngine.play(clips, tracks)
  }, [playing, clips, tracks])

  const handleStart = useCallback(() => audioEngine.seek(0), [])

  const handleEnd = useCallback(() => {
    const end = getEndTime(clips)
    if (end > 0) audioEngine.seek(end)
  }, [clips])

  const handlePrev = useCallback(() => {
    const boundaries = getSortedBoundaries(clips)
    const current = audioEngine.getCurrentPosition()
    const prev = [...boundaries].reverse().find((t) => t < current - 0.2)
    audioEngine.seek(prev ?? 0)
  }, [clips])

  const handleNext = useCallback(() => {
    const boundaries = getSortedBoundaries(clips)
    const current = audioEngine.getCurrentPosition()
    const next = boundaries.find((t) => t > current + 0.2)
    if (next !== undefined) audioEngine.seek(next)
  }, [clips])

  const disabled = tracks.length === 0
  const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties
  const endTime = getEndTime(clips)

  return (
    <>
      <div
        data-tour="bottom-transport"
        className="flex items-center px-4 border-t shrink-0 bg-surface-panel border-surface-border"
        style={{ height: 44 }}
      >
        {/* Left — thumbnail + time */}
        <div className="flex flex-1 items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => currentClip && setOverlayOpen(true)}
            title={currentClip ? 'Expand now playing' : undefined}
            disabled={!currentClip}
            className="flex items-center justify-center w-7 h-7 rounded overflow-hidden shrink-0 transition-opacity disabled:opacity-0"
            style={noDrag}
          >
            {currentClip?.mfbAlbumImageUrl ? (
              <img src={currentClip.mfbAlbumImageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="flex w-full h-full items-center justify-center bg-surface-hover rounded">
                <svg className="w-3.5 h-3.5 text-gray-600" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M5 2v6.55A2 2 0 1 0 7 10V4h2V2H5z" />
                </svg>
              </div>
            )}
          </button>

          <span className="font-mono text-xs tabular-nums text-gray-400 select-none pointer-events-none whitespace-nowrap">
            {formatTime(playhead)}
            <span className="mx-1 text-gray-600">/</span>
            <span className="text-gray-500">{formatTime(endTime)}</span>
          </span>
        </div>

        {/* Centre — transport buttons */}
        <div className="flex items-center gap-1 shrink-0" style={noDrag}>
          <TransportBtn onClick={handleStart} disabled={disabled} title="Go to start">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <rect x="2" y="2" width="2" height="12" rx="0.5" />
              <path d="M6 8l7-4.5v9L6 8z" />
            </svg>
          </TransportBtn>

          <TransportBtn onClick={handlePrev} disabled={disabled} title="Previous clip">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M11 3L4 8l7 5V3z" />
            </svg>
          </TransportBtn>

          <button
            onClick={handlePlayStop}
            disabled={disabled}
            title={playing ? 'Stop (Space)' : 'Play (Space)'}
            className={`flex items-center justify-center w-9 h-9 mx-1 rounded-full transition-colors ${
              disabled
                ? 'text-gray-600 cursor-not-allowed bg-surface-hover'
                : playing
                ? 'text-white bg-accent hover:bg-accent/80'
                : 'text-gray-300 bg-surface-hover hover:bg-accent hover:text-white'
            }`}
            style={noDrag}
          >
            {playing ? (
              <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="currentColor">
                <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="currentColor">
                <path d="M2.5 2l8 4-8 4V2z" />
              </svg>
            )}
          </button>

          <TransportBtn onClick={handleNext} disabled={disabled} title="Next clip">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M5 3l7 5-7 5V3z" />
            </svg>
          </TransportBtn>

          <TransportBtn onClick={handleEnd} disabled={disabled} title="Go to end">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <rect x="12" y="2" width="2" height="12" rx="0.5" />
              <path d="M10 8L3 3.5v9L10 8z" />
            </svg>
          </TransportBtn>
        </div>

        {/* Right — master volume + version/update */}
        <div className="flex flex-1 items-center justify-end gap-3" style={noDrag}>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold tracking-widest uppercase shrink-0 text-accent/70">Master</span>
            <input
              type="range"
              min={0} max={1} step={0.01}
              value={masterVolume}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                setMasterVolume(v)
                audioEngine.setMasterVolume(v)
              }}
              onMouseUp={(e) => (e.target as HTMLInputElement).blur()}
              className="w-24 h-1 rounded-full appearance-none cursor-ew-resize bg-surface-hover accent-accent"
              title={`Master volume: ${Math.round(masterVolume * 100)}%`}
            />
            <span className="text-[9px] font-mono tabular-nums text-gray-400 w-6 text-right shrink-0">
              {Math.round(masterVolume * 100)}
            </span>
          </div>

          <div className="w-px h-4 bg-surface-border shrink-0" />

          {/* Version / update status */}
          {readyVersion ? (
            <button
              type="button"
              onClick={() => window.electronAPI.quitAndInstall()}
              className="flex items-center gap-1 text-[10px] text-accent hover:text-accent/80 transition-colors"
              title={`Install update v${readyVersion} and restart`}
            >
              <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 1v6M2 5l3 3 3-3" />
                <path d="M1 9h8" />
              </svg>
              v{readyVersion}
            </button>
          ) : downloading ? (
            <div className="flex items-center gap-1 text-[10px] text-gray-500">
              <svg className="animate-spin w-2.5 h-2.5 text-accent shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              {downloadPercent > 0 ? `${downloadPercent}%` : '…'}
            </div>
          ) : checkState === 'checking' ? (
            <span className="text-[10px] text-gray-600">checking…</span>
          ) : checkState === 'upToDate' ? (
            <span className="text-[10px] text-gray-600">up to date</span>
          ) : (
            <button
              type="button"
              onClick={handleCheckForUpdates}
              title="Check for updates"
              className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors tabular-nums"
            >
              v{__APP_VERSION__}
            </button>
          )}
        </div>
      </div>

      {overlayOpen && <NowPlayingOverlay onClose={() => setOverlayOpen(false)} />}
    </>
  )
}

function TransportBtn({
  onClick, disabled, title, children,
}: {
  onClick: () => void
  disabled?: boolean
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
        disabled
          ? 'text-gray-700 cursor-not-allowed'
          : 'text-gray-400 hover:text-white hover:bg-surface-hover'
      }`}
    >
      {children}
    </button>
  )
}
