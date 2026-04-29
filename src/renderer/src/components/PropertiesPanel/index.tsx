import type React from 'react'
import { useSessionStore } from '../../store/sessionStore'

function formatDuration(s: number): string {
  const m = Math.floor(s / 60)
  const sec = String(Math.floor(s % 60)).padStart(2, '0')
  const ms = String(Math.round((s % 1) * 10))
  return `${m}:${sec}.${ms}`
}

export function PropertiesPanel(): JSX.Element {
  const selectedClipId = useSessionStore((s) => s.selectedClipId)
  const clips = useSessionStore((s) => s.clips)
  const tracks = useSessionStore((s) => s.tracks)
  const updateClip = useSessionStore((s) => s.updateClip)

  const clip = clips.find((c) => c.id === selectedClipId) ?? null
  const track = clip ? tracks.find((t) => t.id === clip.trackId) ?? null : null

  const effectiveDuration = clip ? clip.duration - clip.trimStart - clip.trimEnd : 0

  if (!clip || !track) {
    return (
      <div className="h-14 shrink-0 border-t border-surface-border bg-surface-panel flex items-center justify-center">
        <span className="text-xs text-gray-600">Select a clip to view properties</span>
      </div>
    )
  }

  return (
    <div data-tour="properties-panel" className="h-14 shrink-0 border-t border-surface-border bg-surface-panel flex items-stretch">
      {/* Colour strip */}
      <div className="w-1 shrink-0" style={{ background: track.color }} />

      <div className="flex items-center gap-5 px-4 overflow-x-auto">
        {/* File name */}
        <div className="flex flex-col gap-0.5 min-w-0">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">File</label>
          <span className="text-xs text-gray-300" title={clip.filePath}>
            {clip.fileName}
          </span>
        </div>

        <div className="w-px h-8 bg-surface-border shrink-0" />

        {/* Duration (read-only) */}
        <Field label="Duration">
          <span className="text-xs text-gray-400 tabular-nums">
            {formatDuration(effectiveDuration)}
          </span>
        </Field>

        <div className="w-px h-8 bg-surface-border shrink-0" />

        {/* Clip gain */}
        <Field label="Clip Gain">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={clip.volume}
              onChange={(e) => updateClip(clip.id, { volume: parseFloat(e.target.value) })}
              className="w-20 h-1 appearance-none bg-surface-hover rounded-full cursor-ew-resize accent-accent"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            />
            <span className="text-[10px] font-mono tabular-nums text-gray-400 w-8">
              {Math.round(clip.volume * 100)}%
            </span>
          </div>
        </Field>

      </div>
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

