import { create } from 'zustand'

interface UpdaterStore {
  downloading: boolean
  downloadPercent: number
  readyVersion: string | null
  setDownloading: (percent?: number) => void
  setReady: (version: string) => void
}

export const useUpdaterStore = create<UpdaterStore>((set) => ({
  downloading: false,
  downloadPercent: 0,
  readyVersion: null,
  setDownloading: (percent = 0) => set({ downloading: true, downloadPercent: percent, readyVersion: null }),
  setReady: (version) => set({ downloading: false, downloadPercent: 100, readyVersion: version }),
}))
