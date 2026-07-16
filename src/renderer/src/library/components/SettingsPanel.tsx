import { useState } from 'react'
import { ACCENT_PRESETS, ZOOM_OPTIONS, type AppSettings } from '../lib/settings'

interface Props {
  settings: AppSettings
  onClose: () => void
  onChange: (s: AppSettings) => void
}

export function SettingsPanel({ settings, onClose, onChange }: Props): JSX.Element {
  const [draft, setDraft] = useState<AppSettings>(settings)

  function update(patch: Partial<AppSettings>): void {
    const next = { ...draft, ...patch }
    setDraft(next)
    onChange(next)
  }

  return (
    <div className="flex fixed inset-0 z-50 justify-center items-center bg-black/60" onClick={onClose}>
      <div
        className="flex flex-col gap-5 p-5 w-80 rounded-lg border shadow-xl border-surface-border bg-surface-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center">
          <span className="text-[11px] font-semibold text-gray-200 uppercase tracking-wider">Settings</span>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-600 transition-colors hover:text-gray-400"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>

        {/* Font size */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Font size</span>
          <div className="flex gap-1.5">
            {ZOOM_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => update({ zoom: opt.value })}
                className={`flex-1 py-1.5 text-[11px] rounded border transition-colors ${
                  draft.zoom === opt.value
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-surface-border bg-surface-hover text-gray-400 hover:text-gray-200 hover:border-gray-500'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Accent colour */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Highlight colour</span>
          <div className="flex flex-wrap gap-2">
            {ACCENT_PRESETS.map((p) => (
              <button
                key={p.rgb}
                type="button"
                onClick={() => update({ accentRgb: p.rgb })}
                title={p.name}
                className="relative w-6 h-6 rounded-full transition-transform hover:scale-110"
                style={{ backgroundColor: p.hex }}
              >
                {draft.accentRgb === p.rgb && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <svg className="w-3 h-3 text-white drop-shadow" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1.5 5l2.5 2.5L8.5 2" />
                    </svg>
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-gray-600">Custom</span>
            <input
              type="color"
              value={`#${draft.accentRgb.split(' ').map((n) => parseInt(n).toString(16).padStart(2, '0')).join('')}`}
              onChange={(e) => {
                const hex = e.target.value
                const r = parseInt(hex.slice(1, 3), 16)
                const g = parseInt(hex.slice(3, 5), 16)
                const b = parseInt(hex.slice(5, 7), 16)
                update({ accentRgb: `${r} ${g} ${b}` })
              }}
              className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
