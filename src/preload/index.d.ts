import type {
  WatchedFolder, LibraryFile, ScanResult, Catalogue, MfbMatch, MfbPlaylist,
  MfbPlaylistDetail, PlaylistTrackSearchResult, MfbAudioFeatures,
  SpotifySearchCandidate, SessionPresetDTO, SessionPresetPayload,
} from '../shared/types'

export interface MfbMatchEntry {
  id: string
  filename: string
  artist: string
  folder_artist: string
  folder_album: string
}

export interface MfbMatchResult {
  id: string
  track: MfbMatch | null
  confidence: number
}

export interface MfbRankResult {
  id: number
  title: string
  artist: string
  album: string
  score: number
}

export interface SpotifyImportEntry {
  spotify_id?: string
  title?: string
  artist?: string
  album?: string
  duration?: number
}

export interface SpotifyImportResult {
  id: number | null
  spotify_id?: string
  enriching?: boolean
  reason?: 'no_spotify_match' | 'exists_private'
}

export interface LibraryMfbData {
  mfbTrackId: number
  trackTitle: string
  artist: string
  albumImageUrl: string | null
  tags: string[]
  breathworkPhase: string | null
}

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
    fadeInCurve: number
    fadeOutCurve: number
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

  // Waveform — peaks are flat interleaved [min, max] pairs in normalized [-1, 1].
  // Returned length is numPeaks * 2.
  getWaveformPeaks: (filePath: string, numPeaks?: number) => Promise<number[]>
  getPeakLevel: (filePath: string) => Promise<number>
  exportWaveformData: (json: string, defaultName?: string) => Promise<string | null>

  // Session
  saveSession: (sessionJson: string, defaultName?: string) => Promise<string | null>
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
  openExternal: (url: string) => Promise<void>
  readClipboardPath: () => Promise<string | null>
  lookupLibraryFile: (filePath: string) => Promise<LibraryMfbData | null>
  importFile: () => Promise<{ content: string; filePath: string; ext: string } | null>
  pickFolder: () => Promise<string | null>
  copyFiles: (srcPaths: string[], destFolder: string) => Promise<Record<string, string>>

  // Window
  setWindowTitle: (title: string) => void

  // Menu events (main → renderer)
  onMenu: (channel: string, callback: () => void) => () => void
  onMenuOpenRecent: (callback: (filePath: string) => void) => () => void

  // Auto-updater
  quitAndInstall: () => void
  checkForUpdates: () => Promise<{ hasUpdate: boolean; version: string | null }>
  simulateUpdate: () => void
  onUpdateDownloading: (callback: (percent: number) => void) => () => void
  onUpdateDownloaded: (callback: (version: string) => void) => () => void

  // File opened from OS (double-click or shell.openPath from Limina Library)
  onFileOpened: (callback: (filePath: string) => void) => () => void

  // MFB account
  mfbLogin: (email: string, password: string) => Promise<{ id: number; name: string; email: string }>
  mfbLogout: () => Promise<void>
  mfbMe: () => Promise<{ id: number; name: string; email: string } | null>
  mfbSearchTracks: (query: string) => Promise<{ id: number; title: string; artists: { name: string }[]; album: { title: string } }[]>
  mfbFetchTrack: (id: number) => Promise<Record<string, unknown>>

  // ── Library: folder scanning ───────────────────────────────────────────────
  libraryPickFolder: () => Promise<string | null>
  buildWatchedFolder: (folderPath: string) => Promise<WatchedFolder>
  scanFolder: (folderPath: string) => Promise<ScanResult>
  findOnDisk: (title: string, artist: string) => Promise<string[]>
  scanFile: (filePath: string) => Promise<LibraryFile | null>
  pickAudioFile: () => Promise<string | null>

  // ── Library: catalogue persistence ─────────────────────────────────────────
  loadCatalogue: () => Promise<{ data: Catalogue | null; restoredFromBackup: boolean }>
  saveCatalogue: (catalogue: Catalogue) => Promise<void>
  listCatalogueBackups: () => Promise<{ slot: number; mtime: string; size: number }[]>
  restoreCatalogueBackup: (slot: number) => Promise<Catalogue | null>
  devResetLibrary: () => Promise<void>
  devRestoreLibrary: () => Promise<void>

  // ── Library: audio analysis ────────────────────────────────────────────────
  getLibraryPeaks: (filePath: string, numPeaks?: number) => Promise<number[]>
  getFileDuration: (filePath: string) => Promise<number>
  analyzeCues: (filePath: string) => Promise<{ introEndMs: number | null; outroStartMs: number | null }>
  analyzeFeatures: (filePath: string, durationSec: number) => Promise<{ features: MfbAudioFeatures | null; retriable: boolean }>

  // ── Library: shell / drag / zoom ───────────────────────────────────────────
  copyFile: (filePath: string) => Promise<void>
  startDrag: (filePath: string) => void
  setZoom: (factor: number) => void

  // ── MFB catalogue match engine ─────────────────────────────────────────────
  mfbCatalogueSearch: (query: string) => Promise<{ id: number; title: string; artist: string; album: string; slug?: string }[]>
  mfbGetTrack: (id: number) => Promise<unknown>
  mfbMatchTracks: (entries: MfbMatchEntry[]) => Promise<MfbMatchResult[]>
  mfbRankMatches: (entry: MfbMatchEntry) => Promise<MfbRankResult[]>
  mfbClearCatalogue: () => Promise<void>
  mfbGetUpdatedMap: () => Promise<Record<number, string>>
  spotifySearch: (q: string) => Promise<{ candidates: SpotifySearchCandidate[]; error?: string }>
  spotifyImport: (entry: SpotifyImportEntry) => Promise<SpotifyImportResult>
  listSystemPresets: () => Promise<SessionPresetDTO[]>
  saveSystemPreset: (preset: { name: string; payload: SessionPresetPayload; sort_order?: number }) => Promise<SessionPresetDTO>
  deleteSystemPreset: (id: number) => Promise<{ deleted: boolean }>

  // ── MFB account (Library-style auth; same auth.bin token) ──────────────────
  authLogin: (email: string, password: string) => Promise<{ id: number; name: string; email: string }>
  authLogout: () => Promise<void>
  authMe: () => Promise<{ id: number; name: string; email: string } | null>
  getUserPlaylists: () => Promise<MfbPlaylist[]>
  getPlaylist: (id: number) => Promise<MfbPlaylistDetail | null>
  searchPlaylistTracks: (query: string) => Promise<PlaylistTrackSearchResult[]>
  syncLibrary: (trackIds: number[]) => Promise<{ synced: boolean; count: number }>

  // ── Studio session hand-off ────────────────────────────────────────────────
  studioSaveSession: (json: string, defaultName: string) => Promise<string | null>
  studioOpenFile: (filePath: string) => Promise<void>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
