import { create } from 'zustand'
import { nanoid } from '../utils/nanoid'

export type ToastType = 'info' | 'success' | 'error'

export interface Toast {
  id: string
  message: string
  type: ToastType
  url?: string
}

interface ToastStore {
  toasts: Toast[]
  add: (message: string, type?: ToastType, duration?: number, url?: string) => void
  remove: (id: string) => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  add: (message, type = 'info', duration = 3500, url?) => {
    const id = nanoid()
    set((s) => ({ toasts: [...s.toasts, { id, message, type, url }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, duration)
  },

  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
