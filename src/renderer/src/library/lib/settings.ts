export interface AppSettings {
  zoom: number
  accentRgb: string
}

export const ACCENT_PRESETS = [
  { name: 'Indigo',   rgb: '99 102 241',  hex: '#6366f1' },
  { name: 'Violet',   rgb: '139 92 246',  hex: '#8b5cf6' },
  { name: 'Purple',   rgb: '168 85 247',  hex: '#a855f7' },
  { name: 'Blue',     rgb: '59 130 246',  hex: '#3b82f6' },
  { name: 'Cyan',     rgb: '6 182 212',   hex: '#06b6d4' },
  { name: 'Emerald',  rgb: '16 185 129',  hex: '#10b981' },
  { name: 'Teal',     rgb: '20 184 166',  hex: '#14b8a6' },
  { name: 'Rose',     rgb: '244 63 94',   hex: '#f43f5e' },
  { name: 'Orange',   rgb: '249 115 22',  hex: '#f97316' },
  { name: 'Amber',    rgb: '245 158 11',  hex: '#f59e0b' },
]

export const ZOOM_OPTIONS = [
  { label: 'Compact',     value: 0.85 },
  { label: 'Default',     value: 1.0  },
  { label: 'Comfortable', value: 1.15 },
]

const STORAGE_KEY = 'limina-settings-v1'
const DEFAULTS: AppSettings = { zoom: 1.0, accentRgb: '99 102 241' }

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
  } catch { return { ...DEFAULTS } }
}

export function saveSettings(s: AppSettings): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch {}
}

export function applySettings(s: AppSettings): void {
  // Derive hover/muted from accent by adjusting lightness — simplest: use the same rgb for now
  // and let the opacity variants handle the visual difference
  document.documentElement.style.setProperty('--accent', s.accentRgb)
  document.documentElement.style.setProperty('--accent-hover', s.accentRgb)
  document.documentElement.style.setProperty('--accent-muted', s.accentRgb)
  window.electronAPI.setZoom(s.zoom)
}
