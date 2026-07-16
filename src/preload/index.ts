import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI, ExportConfig } from './index.d'

const api: ElectronAPI = {
  // File
  openAudioFiles: () => ipcRenderer.invoke('file:openAudioFiles'),
  readAudioFile: (filePath) => ipcRenderer.invoke('file:readAudioFile', filePath),
  getAudioMetadata: (filePath) => ipcRenderer.invoke('file:getAudioMetadata', filePath),

  // Waveform
  getWaveformPeaks: (filePath, numPeaks) =>
    ipcRenderer.invoke('audio:getWaveformPeaks', filePath, numPeaks),
  getPeakLevel: (filePath) => ipcRenderer.invoke('audio:getPeakLevel', filePath),
  exportWaveformData: (json, defaultName) =>
    ipcRenderer.invoke('audio:exportWaveformData', json, defaultName),

  // Session
  saveSession: (sessionJson, defaultName) => ipcRenderer.invoke('session:save', sessionJson, defaultName),
  saveSessionAs: (sessionJson, filePath) => ipcRenderer.invoke('session:saveAs', sessionJson, filePath),
  loadSession: () => ipcRenderer.invoke('session:load'),
  getRecentSessions: () => ipcRenderer.invoke('session:getRecent'),
  openRecentSession: (filePath) => ipcRenderer.invoke('session:openRecent', filePath),
  collectProject: (sessionJson, filePath) => ipcRenderer.invoke('session:collect', sessionJson, filePath),
  exportProjectZip: (sessionJson, filePath) => ipcRenderer.invoke('session:exportZip', sessionJson, filePath),
  autosaveSession: (sessionJson, sessionFilePath) => ipcRenderer.invoke('session:autosave', sessionJson, sessionFilePath),
  checkAutosave: () => ipcRenderer.invoke('session:checkAutosave'),
  clearAutosave: (sessionFilePath) => ipcRenderer.invoke('session:clearAutosave', sessionFilePath),

  // Export
  showSaveAudio: (format) => ipcRenderer.invoke('dialog:showSaveAudio', format),
  exportMix: (config: ExportConfig) => ipcRenderer.invoke('export:mix', config),
  exportTracklistPDF: (html: string) => ipcRenderer.invoke('export:tracklistPDF', html),
  onExportProgress: (callback) => {
    const handler = (_: unknown, pct: number): void => callback(pct)
    ipcRenderer.on('export:progress', handler)
    return () => ipcRenderer.removeListener('export:progress', handler)
  },

  // Audio server
  getAudioServerPort: () => ipcRenderer.invoke('audio:getServerPort'),

  showInFolder: (filePath) => ipcRenderer.invoke('shell:showInFolder', filePath),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  readClipboardPath: () => ipcRenderer.invoke('shell:readClipboardPath'),

  lookupLibraryFile: (filePath) => ipcRenderer.invoke('library:lookupFile', filePath),
  importFile: () => ipcRenderer.invoke('file:importFile'),
  pickFolder: () => ipcRenderer.invoke('file:pickFolder'),
  copyFiles: (srcPaths, destFolder) => ipcRenderer.invoke('file:copyFiles', srcPaths, destFolder),

  // Window
  setWindowTitle: (title) => ipcRenderer.send('window:setTitle', title),

  // Menu → renderer relay
  onMenu: (channel, callback) => {
    const handler = (): void => callback()
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  onMenuOpenRecent: (callback) => {
    const handler = (_: unknown, filePath: string): void => callback(filePath)
    ipcRenderer.on('menu:openRecent', handler)
    return () => ipcRenderer.removeListener('menu:openRecent', handler)
  },

  // Auto-updater
  quitAndInstall: () => ipcRenderer.send('updater:quitAndInstall'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  simulateUpdate: () => ipcRenderer.send('updater:simulate'),
  onUpdateDownloading: (callback) => {
    const handler = (_: unknown, percent: number): void => callback(percent)
    ipcRenderer.on('updater:downloading', handler)
    return () => ipcRenderer.removeListener('updater:downloading', handler)
  },
  onUpdateDownloaded: (callback) => {
    const handler = (_: unknown, version: string): void => callback(version)
    ipcRenderer.on('updater:downloaded', handler)
    return () => ipcRenderer.removeListener('updater:downloaded', handler)
  },

  // File opened from OS (double-click / shell.openPath)
  onFileOpened: (callback) => {
    const handler = (_: unknown, filePath: string): void => callback(filePath)
    ipcRenderer.on('session:fileOpened', handler)
    return () => ipcRenderer.removeListener('session:fileOpened', handler)
  },

  // MFB account (Mix's public search + login used by the clip PropertiesPanel)
  mfbLogin: (email, password) => ipcRenderer.invoke('mfb:login', email, password),
  mfbLogout: () => ipcRenderer.invoke('mfb:logout'),
  mfbMe: () => ipcRenderer.invoke('mfb:me'),
  mfbSearchTracks: (query) => ipcRenderer.invoke('mfb:searchTracks', query),
  mfbFetchTrack: (id) => ipcRenderer.invoke('mfb:fetchTrack', id),

  // ── Library: folder scanning ───────────────────────────────────────────────
  libraryPickFolder: () => ipcRenderer.invoke('library:pickFolder'),
  buildWatchedFolder: (folderPath) => ipcRenderer.invoke('library:buildWatchedFolder', folderPath),
  scanFolder: (folderPath) => ipcRenderer.invoke('library:scanFolder', folderPath),
  findOnDisk: (title, artist) => ipcRenderer.invoke('library:findOnDisk', title, artist),
  scanFile: (filePath) => ipcRenderer.invoke('library:scanFile', filePath),
  pickAudioFile: () => ipcRenderer.invoke('library:pickAudioFile'),

  // ── Library: catalogue persistence ─────────────────────────────────────────
  loadCatalogue: () => ipcRenderer.invoke('catalogue:load'),
  saveCatalogue: (catalogue) => ipcRenderer.invoke('catalogue:save', catalogue),
  listCatalogueBackups: () => ipcRenderer.invoke('catalogue:listBackups'),
  restoreCatalogueBackup: (slot) => ipcRenderer.invoke('catalogue:restoreBackup', slot),

  // ── Library: audio analysis (peaks on a distinct channel from Mix's) ───────
  getLibraryPeaks: (filePath, numPeaks) => ipcRenderer.invoke('library:getWaveformPeaks', filePath, numPeaks),
  getFileDuration: (filePath) => ipcRenderer.invoke('audio:getFileDuration', filePath),
  analyzeCues: (filePath) => ipcRenderer.invoke('audio:analyzeCues', filePath),
  analyzeFeatures: (filePath, durationSec) => ipcRenderer.invoke('audio:analyzeFeatures', filePath, durationSec),

  // ── Library: shell / drag / zoom ───────────────────────────────────────────
  copyFile: (filePath) => ipcRenderer.invoke('library:copyFile', filePath),
  startDrag: (filePath) => ipcRenderer.sendSync('library:startDrag', filePath),
  setZoom: (factor) => ipcRenderer.send('window:setZoom', factor),

  // ── MFB catalogue match engine ─────────────────────────────────────────────
  mfbCatalogueSearch: (query) => ipcRenderer.invoke('mfb:catalogueSearch', query),
  mfbGetTrack: (id) => ipcRenderer.invoke('mfb:getTrack', id),
  mfbMatchTracks: (entries) => ipcRenderer.invoke('mfb:matchTracks', entries),
  mfbRankMatches: (entry) => ipcRenderer.invoke('mfb:rankMatches', entry),
  mfbClearCatalogue: () => ipcRenderer.invoke('mfb:clearCatalogue'),
  mfbGetUpdatedMap: () => ipcRenderer.invoke('mfb:getUpdatedMap'),
  spotifySearch: (q) => ipcRenderer.invoke('spotify:search', q),
  spotifyImport: (entry) => ipcRenderer.invoke('spotify:import', entry),
  listSystemPresets: () => ipcRenderer.invoke('presets:list'),
  saveSystemPreset: (preset) => ipcRenderer.invoke('presets:save', preset),
  deleteSystemPreset: (id) => ipcRenderer.invoke('presets:delete', id),

  // ── MFB account (Library-style auth; shares the same auth.bin token) ────────
  authLogin: (email, password) => ipcRenderer.invoke('auth:login', email, password),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authMe: () => ipcRenderer.invoke('auth:me'),
  getUserPlaylists: () => ipcRenderer.invoke('auth:getUserPlaylists'),
  getPlaylist: (id) => ipcRenderer.invoke('auth:getPlaylist', id),
  searchPlaylistTracks: (query) => ipcRenderer.invoke('auth:searchPlaylistTracks', query),
  syncLibrary: (trackIds) => ipcRenderer.invoke('auth:syncLibrary', trackIds),

  // ── Studio session hand-off (Library's existing IPC) ───────────────────────
  studioSaveSession: (json, defaultName) => ipcRenderer.invoke('studio:saveSession', json, defaultName),
  studioOpenFile: (filePath) => ipcRenderer.invoke('studio:openFile', filePath),
}

contextBridge.exposeInMainWorld('electronAPI', api)
