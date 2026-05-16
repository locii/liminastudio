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
}

contextBridge.exposeInMainWorld('electronAPI', api)
