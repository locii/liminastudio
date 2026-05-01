import type React from 'react'
import { useSessionStore } from '../../store/sessionStore'

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.round((s % 1) * 10)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${ms}`
  return `${m}:${String(sec).padStart(2, '0')}.${ms}`
}

export function PropertiesPanel(): JSX.Element {
  const selectedClipId = useSessionStore((s) => s.selectedClipId)
  const clips = useSessionStore((s) => s.clips)
  const tracks = useSessionStore((s) => s.tracks)
  const updateClip = useSessionStore((s) => s.updateClip)

  const clip = clips.find((c) => c.id === selectedClipId) ?? null
  const track = clip ? tracks.find((t) => t.id === clip.trackId) ?? null : null

  const effectiveDuration = clip ? clip.duration - clip.trimStart - clip.trimEnd : 0

  const versionBadge = (
    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-700 select-none tabular-nums bg-surface-panel pl-2">
      v{__APP_VERSION__}
    </span>
  )

  if (!clip || !track) {
    return (
      <div className="flex relative justify-center items-center h-14 border-t shrink-0 border-surface-border bg-surface-panel">
        <span className="text-xs text-gray-600">Select a clip to view properties</span>
        {versionBadge}
      </div>
    )
  }

  return (
    <div data-tour="properties-panel" className="flex relative items-stretch h-14 border-t shrink-0 border-surface-border bg-surface-panel">
      {/* Colour strip */}
      <div className="w-1 shrink-0" style={{ background: track.color }} />

      <div className="flex overflow-x-auto flex-grow gap-5 items-center px-4 w-full min-w-0">
        {/* File name */}
        <div className="flex flex-col flex-1 gap-0.5 min-w-0">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">File</label>
          <span className="text-xs text-gray-300" title={clip.filePath}>
            {clip.fileName}
          </span>
        </div>

        <div className="w-px h-8 bg-surface-border shrink-0" />

        {/* Duration (read-only) */}
        <Field label="Duration">
          <span className="text-xs tabular-nums text-gray-400">
            {formatDuration(effectiveDuration)}
          </span>
        </Field>

        <div className="w-px h-8 bg-surface-border shrink-0" />

        {/* Clip gain */}
        <Field label="Clip Gain">
          <div className="flex gap-2 items-center w-full">
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={clip.volume}
              onChange={(e) => updateClip(clip.id, { volume: parseFloat(e.target.value) })}
              className="w-96 h-1 rounded-full appearance-none bg-surface-hover cursor-ew-resize accent-accent"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            />
            <span className="text-[10px] font-mono tabular-nums text-gray-400 w-8">
              {Math.round(clip.volume * 100)}%
            </span>
          </div>
        </Field>
        <div className="mr-9 w-px h-8 bg-surface-border shrink-0" />


      </div>
      {versionBadge}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1 shrink-0">
      <label className="text-[10px] text-gray-500 uppercase tracking-wider whitespace-nowrap">
        {label}
      </label>
      {children}
    </div>
  )
}

