import { useState, useEffect } from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { useToastStore } from '../../store/toastStore'

interface Props {
  open: boolean
  onClose: () => void
  defaultFormat?: 'wav' | 'mp3'
}

export function ExportDialog({ open, onClose, defaultFormat }: Props): JSX.Element | null {
  const [format, setFormat] = useState<'wav' | 'mp3'>(defaultFormat ?? 'wav')
  const [bitrate, setBitrate] = useState<128 | 192 | 320>(320)
  const [sampleRate, setSampleRate] = useState<44100 | 48000>(44100)
  const [outputPath, setOutputPath] = useState<string>('')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string>('')

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

  if (!open) return null

  const totalDuration = clips.length
    ? Math.max(...clips.map((c) => c.startTime + c.duration - c.trimStart - c.trimEnd))
    : 0

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
          crossfadeIn: c.crossfadeIn ?? 0, crossfadeOut: c.crossfadeOut ?? 0,
          volume: c.volume,
        })),
        tracks: tracks.map((t) => ({
          id: t.id, volume: t.volume, muted: t.muted, solo: t.solo,
        })),
        outputPath, format, sampleRate,
        bitrate: format === 'mp3' ? bitrate : undefined,
      })
      toast('Export complete!', 'success')
      onClose()
    } catch (e) {
      setError(String(e))
      setProgress(null)
    }
  }

  const busy = progress !== null && progress < 1

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div className="bg-surface-panel border border-surface-border rounded-xl p-6 w-[420px] shadow-2xl flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-200">Export Mix</h2>
          <button onClick={onClose} disabled={busy}
            className="text-gray-600 hover:text-gray-300 disabled:opacity-30">✕</button>
        </div>

        {/* Info row */}
        <div className="text-xs text-gray-500">
          {clips.length} clip{clips.length !== 1 ? 's' : ''} · {Math.round(totalDuration)}s total
        </div>

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

        {/* Output path */}
        <Row label="Output">
          <div className="flex items-center gap-2 flex-1">
            <span className="flex-1 text-xs text-gray-400 truncate min-w-0">
              {outputPath || <span className="text-gray-600">No file chosen</span>}
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

        {/* Export button */}
        <button
          onClick={handleExport}
          disabled={busy || !outputPath}
          className="w-full py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
        >
          {busy ? `Exporting… ${Math.round((progress ?? 0) * 100)}%` : 'Export'}
        </button>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-20 shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 flex-1">{children}</div>
    </div>
  )
}

function SegButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
        active ? 'bg-accent text-white' : 'bg-surface-hover text-gray-400 hover:text-gray-200'
      }`}
    >
      {children}
    </button>
  )
}
