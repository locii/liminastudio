import { create } from 'zustand'

interface UpdaterStore {
  downloading: boolean
  readyVersion: string | null
  setDownloading: () => void
  setReady: (version: string) => void
}

export const useUpdaterStore = create<UpdaterStore>((set) => ({
  downloading: false,
  readyVersion: null,
  setDownloading: () => set({ downloading: true, readyVersion: null }),
  setReady: (version) => set({ downloading: false, readyVersion: version }),
}))
