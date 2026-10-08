import { useState, useEffect } from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { useToastStore } from '../../store/toastStore'
import { useDialog } from '../../../useDialog'
import { ipcErrorMessage } from '../../../ipcError'

function formatDuration(totalSec: number): string {
  const s = Math.round(totalSec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

interface Props {
  open: boolean
  onClose: () => void
  defaultFormat?: 'wav' | 'mp3'
  /** Open the pre-session check (offered when clips aren't on disk). */
  onReadyCheck?: () => void
}

export function ExportDialog({ open, onClose, defaultFormat, onReadyCheck }: Props): JSX.Element | null {
  const [format, setFormat] = useState<'wav' | 'mp3'>(defaultFormat ?? 'wav')
  const [bitrate, setBitrate] = useState<128 | 192 | 320>(320)
  const [sampleRate, setSampleRate] = useState<44100 | 48000>(44100)
  const [outputPath, setOutputPath] = useState<string>('')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string>('')
  const [chapterMode, setChapterMode] = useState<'sections' | 'tracks' | 'none'>('sections')
  const [writeCue, setWriteCue] = useState(false)
  const segments = useSessionStore((s) => s.segments)

  const clips = useSessionStore((s) => s.clips)
  const tracks = useSessionStore((s) => s.tracks)
  const toast = useToastStore((s) => s.add)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setProgress(null)
      setError('')
      setOutputPath('')
      if (defaultFormat) setFormat(defaultFormat)
    }
  }, [open, defaultFormat])

  // Register progress listener
  useEffect(() => {
    if (!open) return
    const unsub = window.electronAPI.onExportProgress((pct) => setProgress(pct))
    return unsub
  }, [open])

  const busy = progress !== null && progress < 1
  const { ref: dialogRef, dialogProps } = useDialog(open, onClose, !busy)

  // Warn up front if any clip's file isn't really on disk (online-only cloud
  // placeholder, empty, or missing) — it would render as silence or fail.
  const [notReady, setNotReady] = useState(0)
  useEffect(() => {
    if (!open) return
    setNotReady(0)
    const paths = [...new Set(useSessionStore.getState().clips.map((c) => c.filePath))]
    window.electronAPI.checkFilesReady(paths)
      .then((res) => setNotReady(res.filter((r) => r.status !== 'ok').length))
      .catch(() => {})
  }, [open])

  if (!open) return null

  const totalDuration = clips.length
    ? Math.max(...clips.map((c) => c.startTime + c.duration - c.trimStart - c.trimEnd))
    : 0

  // Chapter markers: the segment lane's sections, or one per track (clip).
  const effectiveChapterMode = chapterMode === 'sections' && segments.length === 0 ? 'tracks' : chapterMode
  const buildChapters = (): { title: string; start: number; end: number }[] => {
    if (effectiveChapterMode === 'sections') {
      return [...segments]
        .sort((a, b) => a.startTime - b.startTime)
        .map((s) => ({ title: s.name, start: s.startTime, end: Math.min(s.endTime, totalDuration) }))
    }
    if (effectiveChapterMode === 'tracks') {
      const sorted = [...clips].sort((a, b) => a.startTime - b.startTime)
      return sorted.map((c, i) => ({
        title: c.fileName.replace(/\.[^.]+$/, ''),
        start: c.startTime,
        end: sorted[i + 1]?.startTime ?? totalDuration,
      }))
    }
    return []
  }

  const handlePickOutput = async (): Promise<void> => {
    const path = await window.electronAPI.showSaveAudio(format)
    if (path) setOutputPath(path)
  }

  const handleExport = async (): Promise<void> => {
    if (!outputPath) { setError('Choose an output file first.'); return }
    setProgress(0)
    setError('')
    try {
      await window.electronAPI.exportMix({
        clips: clips.map((c) => ({
          id: c.id, trackId: c.trackId, filePath: c.filePath,
          startTime: c.startTime, duration: c.duration,
          trimStart: c.trimStart, trimEnd: c.trimEnd,
          fadeIn: c.fadeIn, fadeOut: c.fadeOut,
          fadeInCurve: c.fadeInCurve ?? 0.5, fadeOutCurve: c.fadeOutCurve ?? 0.5,
          crossfadeIn: c.crossfadeIn ?? 0, crossfadeOut: c.crossfadeOut ?? 0,
          volume: c.volume,
        })),
        tracks: tracks.map((t) => ({
          id: t.id, volume: t.volume, muted: t.muted, solo: t.solo,
        })),
        outputPath, format, sampleRate,
        bitrate: format === 'mp3' ? bitrate : undefined,
        chapters: buildChapters(),
        writeCueSheet: writeCue,
      })
      toast('Export complete!', 'success')
      onClose()
    } catch (e) {
      const msg = ipcErrorMessage(e)
      setError(msg === 'EXPORT_CANCELLED' ? '' : msg)
      setProgress(null)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div ref={dialogRef} {...dialogProps} aria-labelledby="export-dialog-title" className="bg-surface-panel border border-surface-border rounded-xl p-6 w-[420px] shadow-2xl flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h2 id="export-dialog-title" className="text-base font-semibold text-gray-200">Export Mix</h2>
          <button onClick={onClose} disabled={busy} aria-label="Close" title="Close"
            className="text-gray-500 hover:text-gray-300 disabled:opacity-30">✕</button>
        </div>

        {/* Info row */}
        <div className="text-xs text-gray-500">
          {clips.length} clip{clips.length !== 1 ? 's' : ''} · {formatDuration(totalDuration)} total
        </div>

        {notReady > 0 && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <p className="flex-1 text-[12px] text-amber-100">
              {notReady} file{notReady !== 1 ? 's aren’t' : ' isn’t'} on this Mac — the export may have gaps or fail.
            </p>
            {onReadyCheck && (
              <button type="button" onClick={() => { onClose(); onReadyCheck() }}
                className="shrink-0 text-[12px] font-medium text-amber-300 hover:text-amber-200">
                Check files…
              </button>
            )}
          </div>
        )}

        {/* Format */}
        <Row label="Format">
          <SegButton active={format === 'wav'} onClick={() => setFormat('wav')}>WAV</SegButton>
          <SegButton active={format === 'mp3'} onClick={() => setFormat('mp3')}>MP3</SegButton>
        </Row>

        {/* MP3 bitrate */}
        {format === 'mp3' && (
          <Row label="Bitrate">
            {([128, 192, 320] as const).map((b) => (
              <SegButton key={b} active={bitrate === b} onClick={() => setBitrate(b)}>
                {b} kbps
              </SegButton>
            ))}
          </Row>
        )}

        {/* Sample rate */}
        <Row label="Sample rate">
          <SegButton active={sampleRate === 44100} onClick={() => setSampleRate(44100)}>44.1 kHz</SegButton>
          <SegButton active={sampleRate === 48000} onClick={() => setSampleRate(48000)}>48 kHz</SegButton>
        </Row>

        {/* Chapters */}
        <Row label="Chapters">
          <SegButton active={effectiveChapterMode === 'sections'} onClick={() => setChapterMode('sections')} disabled={segments.length === 0}>Sections</SegButton>
          <SegButton active={effectiveChapterMode === 'tracks'} onClick={() => setChapterMode('tracks')}>Tracks</SegButton>
          <SegButton active={effectiveChapterMode === 'none'} onClick={() => setChapterMode('none')}>None</SegButton>
        </Row>
        {effectiveChapterMode !== 'none' && (
          <div className="flex flex-col gap-1.5 pl-[92px] -mt-2">
            <p className="text-[11px] text-gray-500">
              {format === 'mp3' ? 'Embedded in the MP3 — players that support chapters show them.' : 'WAV can’t hold chapters — save a cue sheet to keep them.'}
            </p>
            <label className="flex items-center gap-2 text-[12px] text-gray-300 cursor-pointer select-none">
              <input type="checkbox" checked={writeCue} onChange={(e) => setWriteCue(e.target.checked)} className="accent-[rgb(var(--accent))]" />
              Also save a cue sheet (.cue) next to the file
            </label>
          </div>
        )}

        {/* Output path */}
        <Row label="Output">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="flex-1 text-xs text-gray-400 truncate min-w-0">
              {outputPath || <span className="text-gray-500">No file chosen</span>}
            </span>
            <button onClick={handlePickOutput} disabled={busy}
              className="shrink-0 px-2.5 py-1 text-xs bg-surface-hover hover:bg-surface-border rounded transition-colors disabled:opacity-30">
              Browse…
            </button>
          </div>
        </Row>

        {/* Progress bar */}
        {progress !== null && (
          <div className="h-1.5 bg-surface-base rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-200 rounded-full"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}

        {/* Error */}
        {error && <p className="text-xs text-red-400 break-words">{error}</p>}

        {/* Export button (+ Cancel while rendering — a 3-hour mix takes minutes) */}
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={busy || !outputPath}
            className="flex-1 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {busy ? `Exporting… ${Math.round((progress ?? 0) * 100)}%` : 'Export'}
          </button>
          {busy && (
            <button
              onClick={() => { void window.electronAPI.cancelExport() }}
              className="px-4 py-2 bg-surface-hover hover:bg-surface-border text-gray-300 text-sm font-medium rounded-lg transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-20 shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 flex-1 min-w-0">{children}</div>
    </div>
  )
}

function SegButton({
  active, onClick, children, disabled = false,
}: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Add sections in the segment lane first' : undefined}
      className={`px-3 py-1 rounded text-xs font-medium transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
        active ? 'bg-accent text-white' : 'bg-surface-hover text-gray-400 hover:text-gray-200'
      }`}
    >
      {children}
    </button>
  )
}
