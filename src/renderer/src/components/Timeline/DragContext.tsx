import { createContext, useContext, useRef, useCallback } from 'react'

interface DragState {
  clipId: string | null
  targetTrackId: string | null
  width: number
  left: number
}

interface DragContextValue {
  getDragState: () => DragState
  setDragState: (s: DragState) => void
  subscribe: (fn: () => void) => () => void
}

const DragContext = createContext<DragContextValue | null>(null)

export function DragProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const stateRef = useRef<DragState>({ clipId: null, targetTrackId: null, width: 0, left: 0 })
  const listenersRef = useRef<Set<() => void>>(new Set())

  const getDragState = useCallback(() => stateRef.current, [])

  const setDragState = useCallback((s: DragState) => {
    stateRef.current = s
    listenersRef.current.forEach((fn) => fn())
  }, [])

  const subscribe = useCallback((fn: () => void) => {
    listenersRef.current.add(fn)
    return () => listenersRef.current.delete(fn)
  }, [])

  return (
    <DragContext.Provider value={{ getDragState, setDragState, subscribe }}>
      {children}
    </DragContext.Provider>
  )
}

export function useDragContext(): DragContextValue {
  const ctx = useContext(DragContext)
  if (!ctx) throw new Error('useDragContext must be used within DragProvider')
  return ctx
}
