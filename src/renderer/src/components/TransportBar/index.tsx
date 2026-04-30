import { useEffect, useRef, useState, useCallback } from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { useTransportStore } from '../../store/transportStore'
import { audioEngine } from '../../audio/audioEngine'
import { KeyboardShortcuts } from '../KeyboardShortcuts'
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`
}

interface Props {
  onAddTrack: () => void
  onAddEmptyTrack: () => void
  onOpenExportWav: () => void
  onOpenExportMp3: () => void
  onExportPDF: () => void
  onNewSession: () => void
  onOpen: () => void
  onImport: () => void
  onSave: () => void
  onSaveAs: () => void
  onCollect: () => void
  onExportZip: () => void
  onFitToWindow: () => void
  onStartTour: () => void
}

export function TransportBar({
  onAddTrack, onAddEmptyTrack, onOpenExportWav, onOpenExportMp3, onExportPDF,
  onNewSession, onOpen, onImport, onSave, onSaveAs, onCollect, onExportZip,
  onFitToWindow, onStartTour,
}: Props): JSX.Element {
  const playing = useTransportStore((s) => s.playing)
  const looping = useTransportStore((s) => s.looping)
  const zoom = useTransportStore((s) => s.zoom)
  const setZoom = useTransportStore((s) => s.setZoom)
  const toggleLoop = useTransportStore((s) => s.toggleLoop)

  const tracks = useSessionStore((s) => s.tracks)
  const clips = useSessionStore((s) => s.clips)
  const isDirty = useSessionStore((s) => s.isDirty)
  const currentFilePath = useSessionStore((s) => s.currentFilePath)
  const sessionLabel = useSessionStore((s) => s.sessionLabel)
  const setSessionLabel = useSessionStore((s) => s.setSessionLabel)

  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const fileMenuRef = useRef<HTMLDivElement>(null)

  const totalDuration = clips.length
    ? Math.max(...clips.map((c) => c.startTime + c.duration - c.trimStart - c.trimEnd))
    : 0

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!fileMenuOpen) return
    const handler = (e: MouseEvent): void => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setFileMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [fileMenuOpen])

  const menuAction = (fn: () => void) => () => { setFileMenuOpen(false); fn() }

  const handlePlayStop = async (): Promise<void> => {
    if (playing) { audioEngine.stop() } else { await audioEngine.play(clips, tracks) }
  }
  const handleStop = (): void => { audioEngine.seek(0) }

  useEffect(() => {
    const handler = async (e: KeyboardEvent): Promise<void> => {
      const activeEl = document.activeElement as HTMLElement | null
      const tag = activeEl?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || activeEl?.isContentEditable) return
      const mod = e.metaKey || e.ctrlKey
      if (mod) return
      if (e.code === 'Space') { e.preventDefault(); await handlePlayStop() }
      if (e.code === 'KeyR') { e.preventDefault(); handleStop() }
      if (e.code === 'KeyL') { e.preventDefault(); toggleLoop() }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoom * 1.5) }
      if (e.key === '-') { e.preventDefault(); setZoom(zoom / 1.5) }
      if (e.key === '?') { e.preventDefault(); setShortcutsOpen((v) => !v) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [playing, clips, tracks, toggleLoop, zoom, setZoom])

  const derivedName = sessionLabel ||
    (currentFilePath ? currentFilePath.split(/[\\/]/).pop()?.replace(/\.limina$/, '') : null) ||
    'Unsaved session'
  const sessionName = (isDirty ? '• ' : '') + derivedName

  const [renamingSession, setRenamingSession] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  const startRename = useCallback(() => {
    setRenameValue(derivedName === 'Unsaved session' ? '' : derivedName)
    setRenamingSession(true)
    setTimeout(() => renameInputRef.current?.select(), 0)
  }, [derivedName])

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim()
    if (trimmed) setSessionLabel(trimmed)
    setRenamingSession(false)
  }, [renameValue, setSessionLabel])

  return (
    <div className="flex gap-3 items-center px-3 h-11 border-b bg-surface-panel border-surface-border shrink-0">

      {/* App name — click to go to welcome screen */}
      <button
        onClick={onNewSession}
        className="text-[11px] font-semibold text-gray-300 tracking-widest uppercase shrink-0 select-none transition-colors hover:text-white"
        title="Go to welcome screen"
      >
        Limina Studio
      </button>

      <div className="w-px h-4 bg-surface-border shrink-0" />

      {/* File dropdown */}
      <div className="relative" ref={fileMenuRef} data-tour="file-menu">
        <button
          onClick={() => setFileMenuOpen((v) => !v)}
          className={`flex items-center gap-1 px-2.5 h-6 text-xs rounded transition-colors ${
            fileMenuOpen
              ? 'bg-surface-hover text-gray-200'
              : 'text-gray-400 hover:bg-surface-hover hover:text-gray-200'
          }`}
        >
          File
          <svg className="w-2.5 h-2.5 opacity-50" viewBox="0 0 10 6" fill="currentColor">
            <path d="M0 0l5 6 5-6H0z" />
          </svg>
        </button>

        {fileMenuOpen && (
          <div className="absolute left-0 top-full z-50 py-1 mt-1 w-52 text-xs rounded border shadow-xl bg-surface-panel border-surface-border">
            <MenuItem label="New Session" onClick={menuAction(onNewSession)} />
            <Divider />
            <MenuItem label="Open Session…" shortcut="⌘O" onClick={menuAction(onOpen)} />
            <MenuItem label="Import session" onClick={menuAction(onImport)} />
            <Divider />
            <MenuItem
              label="Save"
              shortcut="⌘S"
              onClick={menuAction(onSave)}
              highlight={isDirty}
            />
            <MenuItem label="Save As…" shortcut="⌘⇧S" onClick={menuAction(onSaveAs)} />
            <Divider />

            <MenuItem label="Export as WAV…" shortcut="⌘E" onClick={menuAction(onOpenExportWav)} />
            <MenuItem label="Export as MP3…" onClick={menuAction(onOpenExportMp3)} />
            <Divider />
            <MenuItem label="Export Track Listing PDF…" onClick={menuAction(onExportPDF)} />
            <Divider />
            <MenuItem label="Collect Project Files" onClick={menuAction(onCollect)} />
            <MenuItem label="Export Project as ZIP…" onClick={menuAction(onExportZip)} />
          </div>
        )}
      </div>

      {tracks.length > 0 && (<>
        {/* Session name — double-click to rename */}
        {renamingSession ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') setRenamingSession(false)
            }}
            className="text-sm text-gray-200 bg-surface-base border border-accent rounded px-1 h-6 max-w-56 outline-none"
            placeholder="Session name"
          />
        ) : (
          <span
            className="text-sm text-gray-300 max-w-56 truncate shrink-0 cursor-default select-none"
            onDoubleClick={startRename}
            title="Double-click to rename"
          >
            {sessionName}
          </span>
        )}

        <div className="w-px h-4 bg-surface-border shrink-0" />

        {/* Zoom */}
        <div className="flex gap-2 items-center shrink-0" data-tour="zoom">
          <svg className="w-3 h-3 text-gray-500" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="5" cy="5" r="3.5" /><path d="M8 8l2.5 2.5" strokeLinecap="round" />
            <path d="M3.5 5h3M5 3.5v3" strokeLinecap="round" />
          </svg>
          <input
            type="range"
            min={0} max={100} step={0.5}
            value={Math.log(zoom / 0.1) / Math.log(2000) * 100}
            onChange={(e) => setZoom(0.1 * Math.pow(2000, Number(e.target.value) / 100))}
            className="w-24 h-1 rounded-full appearance-none bg-surface-hover cursor-ew-resize accent-accent"
            title={`Zoom: ${zoom.toFixed(0)} px/s`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          />
          <span className="text-[10px] text-gray-400 tabular-nums w-12">{zoom.toFixed(0)} px/s</span>
          <button
            onClick={onFitToWindow}
            className="text-[10px] text-gray-400 hover:text-gray-200 transition-colors px-1 leading-none"
            title="Fit project to window"
          >fit</button>
        </div>

        <div className="flex-1" />

        {/* Add Empty Track */}
        <button
          onClick={onAddEmptyTrack}
          data-tour="empty-track"
          className="flex items-center gap-1 px-2.5 h-6 bg-surface-hover hover:bg-surface-border text-gray-400 hover:text-gray-200 text-xs rounded transition-colors"
          title="Add empty track"
        >
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="1" width="10" height="10" rx="1.5" />
            <path d="M6 4v4M4 6h4" strokeLinecap="round" />
          </svg>
          Empty Track
        </button>

        {/* Add Track */}
        <button
          onClick={onAddTrack}
          data-tour="add-track"
          className="flex gap-1 items-center px-3 h-6 text-xs font-medium text-white rounded transition-colors bg-accent hover:bg-accent-hover"
        >
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
            <path d="M6 1a1 1 0 011 1v3h3a1 1 0 010 2H7v3a1 1 0 01-2 0V7H2a1 1 0 010-2h3V2a1 1 0 011-1z" />
          </svg>
          Add Track
        </button>

        <div className="w-px h-4 bg-surface-border shrink-0" />

        {/* Total duration */}
        {totalDuration > 0 && (
          <span className="text-[10px] text-gray-400 tabular-nums shrink-0" title="Total session duration">
            {formatTime(totalDuration)}
          </span>
        )}

        {/* Keyboard shortcuts */}
        <button
          onClick={() => setShortcutsOpen(true)}
          className="w-5 h-5 rounded text-[10px] font-bold text-gray-400 hover:text-gray-200 hover:bg-surface-hover transition-colors shrink-0"
          title="Keyboard shortcuts (?)"
        >
          ?
        </button>

        {/* Guided tour */}
        <button
          onClick={onStartTour}
          className="h-5 px-1.5 rounded text-[10px] text-gray-400 hover:text-gray-200 hover:bg-surface-hover transition-colors shrink-0"
          title="Start guided tour"
        >
          Tour
        </button>
      </>)}

      <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  )
}

function MenuItem({ label, shortcut, onClick, highlight }: {
  label: string; shortcut?: string; onClick: () => void; highlight?: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-1.5 hover:bg-surface-hover transition-colors text-left ${
        highlight ? 'text-accent' : 'text-gray-300'
      }`}
    >
      <span>{label}</span>
      {shortcut && <span className="text-gray-600 text-[10px]">{shortcut}</span>}
    </button>
  )
}

function Divider(): JSX.Element {
  return <div className="my-1 h-px bg-surface-border" />
}
