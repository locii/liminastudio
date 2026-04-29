/// <reference types="vite/client" />
import type { AudioFileMeta, ExportConfig, ElectronAPI } from '../../../src/preload/index.d'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export type { AudioFileMeta, ExportConfig }
