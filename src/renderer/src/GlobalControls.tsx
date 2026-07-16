import { useEffect, useState } from 'react'
import { AccountButton } from './library/components/AccountButton'
import { SettingsPanel } from './library/components/SettingsPanel'
import { loadSettings, saveSettings, applySettings, type AppSettings } from './library/lib/settings'
import { useUIStore } from './uiStore'

/**
 * Persistent top-right controls shown in every workspace's toolbar: the MFB
 * profile dropdown, the appearance settings gear, and the guided-tour help.
 * Account state + settings are app-wide; the "?" dispatches `app:start-tour`,
 * which the active app (Library or Mix) catches to open its own tour.
 */
export function GlobalControls(): JSX.Element {
  const surface = useUIStore((s) => s.surface)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(loadSettings)

  useEffect(() => { applySettings(settings) }, [settings])

  const onChange = (s: AppSettings): void => { setSettings(s); saveSettings(s) }

  return (
    <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <AccountButton />
      <button
        type="button"
        onClick={() => setShowSettings(true)}
        title="Settings"
        className="flex items-center justify-center w-6 h-6 text-gray-400 transition-colors border rounded bg-surface-hover hover:bg-surface-border border-surface-border"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7" cy="7" r="1.75" />
          <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.93 2.93l1.06 1.06M10.01 10.01l1.06 1.06M10.01 3.99l1.06-1.06M3.99 10.01l-1.06 1.06" />
        </svg>
      </button>
      {surface !== 'home' && (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('app:start-tour'))}
          title="Start guided tour"
          className="flex items-center justify-center w-6 h-6 text-xs text-gray-300 transition-colors border rounded bg-surface-hover hover:bg-surface-border border-surface-border"
        >
          ?
        </button>
      )}
      {showSettings && (
        <SettingsPanel settings={settings} onClose={() => setShowSettings(false)} onChange={onChange} />
      )}
    </div>
  )
}
