export interface AudioFileMeta {
  path: string
  name: string
  duration: number
  sampleRate: number
  channels: number
}

export interface ExportConfig {
  clips: {
    id: string
    trackId: string
    filePath: string
    startTime: number
    duration: number
    trimStart: number
    trimEnd: number
    fadeIn: number
    fadeOut: number
    crossfadeIn: number
    crossfadeOut: number
    volume: number
  }[]
  tracks: {
    id: string
    volume: number
    muted: boolean
    solo: boolean
  }[]
  outputPath: string
  format: 'wav' | 'mp3'
  sampleRate: 44100 | 48000
  bitrate?: 128 | 192 | 320
}

export interface ElectronAPI {
  // File
  openAudioFiles: () => Promise<AudioFileMeta[]>
  readAudioFile: (filePath: string) => Promise<Uint8Array>
  getAudioMetadata: (filePath: string) => Promise<AudioFileMeta | null>

  // Waveform
  getWaveformPeaks: (filePath: string, numPeaks?: number) => Promise<number[]>

  // Session
  saveSession: (sessionJson: string) => Promise<string | null>
  saveSessionAs: (sessionJson: string, filePath: string) => Promise<void>
  loadSession: () => Promise<{ json: string; filePath: string } | null>
  getRecentSessions: () => Promise<string[]>
  openRecentSession: (filePath: string) => Promise<{ json: string; filePath: string } | null>
  collectProject: (sessionJson: string, filePath: string) => Promise<string>
  exportProjectZip: (sessionJson: string, filePath: string) => Promise<{ zipPath: string; updatedJson: string } | null>
  autosaveSession: (sessionJson: string, sessionFilePath?: string) => Promise<void>
  checkAutosave: () => Promise<{ json: string; savedAt: string } | null>
  clearAutosave: (sessionFilePath?: string) => Promise<void>

  // Export
  showSaveAudio: (format: 'wav' | 'mp3') => Promise<string | null>
  exportMix: (config: ExportConfig) => Promise<string>
  onExportProgress: (callback: (pct: number) => void) => () => void
  exportTracklistPDF: (html: string) => Promise<string | null>

  // Audio server
  getAudioServerPort: () => Promise<number>

  showInFolder: (filePath: string) => Promise<void>

  // Window
  setWindowTitle: (title: string) => void

  // Menu events (main → renderer)
  onMenu: (channel: string, callback: () => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
