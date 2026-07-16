import { useEffect, useRef, useState, useCallback } from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { useTransportStore } from '../../store/transportStore'
import { useUpdaterStore } from '../../store/updaterStore'
import { audioEngine } from '../../audio/audioEngine'
import { KeyboardShortcuts } from '../KeyboardShortcuts'
import { useUIStore } from '../../../uiStore'
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`
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
  onRebuildWaveforms: () => void
  onExportWaveformData: () => void
  onOpenRecent: (filePath: string) => void
  onFitToWindow: () => void
  onFocusPlayhead: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onStartTour: () => void
}

export function TransportBar({
  onAddTrack, onAddEmptyTrack, onOpenExportWav, onOpenExportMp3, onExportPDF,
  onNewSession, onOpen, onImport, onSave, onSaveAs, onCollect, onExportZip,
  onRebuildWaveforms, onExportWaveformData, onOpenRecent,
  onFitToWindow, onFocusPlayhead, onZoomIn, onZoomOut, onStartTour,
}: Props): JSX.Element {
  const goHome = useUIStore((s) => s.setSurface)
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

  const { downloading, downloadPercent, readyVersion } = useUpdaterStore()
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'upToDate'>('idle')
  const handleCheckForUpdates = useCallback(async (): Promise<void> => {
    if (checkState !== 'idle') return
    setCheckState('checking')
    try {
      const [result] = await Promise.all([
        window.electronAPI.checkForUpdates(),
        new Promise<void>((r) => setTimeout(r, 800)),
      ])
      if (!result.hasUpdate) {
        setCheckState('upToDate')
        setTimeout(() => setCheckState('idle'), 3000)
      } else {
        setCheckState('idle')
      }
    } catch {
      setCheckState('upToDate')
      setTimeout(() => setCheckState('idle'), 3000)
    }
  }, [checkState])

  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const [recentSessions, setRecentSessions] = useState<string[]>([])
  const fileMenuRef = useRef<HTMLDivElement>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!fileMenuOpen) { setRecentOpen(false); return }
    window.electronAPI.getRecentSessions().then(setRecentSessions).catch(() => {})
  }, [fileMenuOpen])

  const totalDuration = clips.length
    ? Math.max(...clips.map((c) => c.startTime + c.duration - c.trimStart - c.trimEnd))
    : 0

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!fileMenuOpen) return
    const handler = (e: MouseEvent): void => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) setFileMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [fileMenuOpen])

  useEffect(() => {
    if (!addMenuOpen) return
    const handler = (e: MouseEvent): void => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setAddMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [addMenuOpen])

  const menuAction = (fn: () => void) => () => { setFileMenuOpen(false); fn() }
  const addMenuAction = (fn: () => void) => () => { setAddMenuOpen(false); fn() }

  const handlePlayStop = async (): Promise<void> => {
    if (playing) { audioEngine.pause() } else { await audioEngine.play(clips, tracks) }
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
  const sessionName = derivedName

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

      {/* Home — back to the umbrella switcher */}
      <button
        type="button"
        onClick={() => goHome('home')}
        title="Back to Home"
        className="flex items-center justify-center w-6 h-6 text-gray-400 rounded border transition-colors bg-surface-hover hover:bg-surface-border border-surface-border shrink-0"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
        </svg>
      </button>
      <span className="text-gray-600 text-[11px] select-none shrink-0">›</span>
      <span className="text-[11px] font-semibold text-gray-300 tracking-widest uppercase shrink-0 select-none">Mix</span>

      <div className="w-px h-4 bg-surface-border shrink-0" />

      {/* File + Add/?/Tour — tight left cluster, always closed outside the conditional */}
      <div className="flex gap-1 items-center shrink-0">

        {/* File dropdown */}
        <div className="relative" ref={fileMenuRef} data-tour="file-menu">
          <button
            onClick={() => setFileMenuOpen((v) => !v)}
            className={`h-5 flex items-center gap-1 px-2 text-[12px] transition-colors leading-none ${
              fileMenuOpen ? 'text-gray-200' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            File
            {readyVersion && !fileMenuOpen && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" title={`Update v${readyVersion} ready`} />
            )}
            <svg className="w-2.5 h-2.5 opacity-40" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 1l4 4 4-4" />
            </svg>
          </button>

          {fileMenuOpen && (
            <div className="absolute left-0 top-full z-[200] py-1 mt-1 w-56 text-xs rounded border shadow-xl bg-surface-panel border-surface-border">
              <MenuItem label="New Session" onClick={menuAction(onNewSession)} />
              <Divider />
              <MenuItem label="Open Session…" shortcut="⌘O" onClick={menuAction(onOpen)} />

              {/* Open Recent flyout */}
              <div
                className="relative"
                onMouseEnter={() => setRecentOpen(true)}
                onMouseLeave={() => setRecentOpen(false)}
              >
                <button className="w-full flex items-center justify-between px-3 py-1.5 text-gray-300 hover:bg-surface-hover transition-colors text-left">
                  <span>Open Recent</span>
                  <svg className="w-3 h-3 text-gray-500" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 2l4 3-4 3" />
                  </svg>
                </button>
                {recentOpen && (
                  <div className="absolute left-full top-0 z-[210] py-1 w-64 rounded border shadow-xl bg-surface-panel border-surface-border">
                    {recentSessions.length > 0 ? recentSessions.map((filePath) => {
                      const name = filePath.split(/[\\/]/).pop()?.replace(/\.limina$/, '') ?? filePath
                      return (
                        <button
                          key={filePath}
                          title={filePath}
                          onClick={menuAction(() => onOpenRecent(filePath))}
                          className="w-full flex flex-col px-3 py-1.5 text-left hover:bg-surface-hover transition-colors"
                        >
                          <span className="text-gray-300 truncate">{name}</span>
                          <span className="text-gray-600 text-[10px] truncate">{filePath}</span>
                        </button>
                      )
                    }) : (
                      <div className="px-3 py-1.5 text-gray-600">No recent sessions</div>
                    )}
                  </div>
                )}
              </div>

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
              <Divider />
              <MenuItem label="Rebuild Waveforms" onClick={menuAction(onRebuildWaveforms)} />
              <MenuItem label="Export Waveform Data…" onClick={menuAction(onExportWaveformData)} />
              <Divider />
              {readyVersion ? (
                <button
                  onClick={() => { setFileMenuOpen(false); window.electronAPI.quitAndInstall() }}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-accent hover:bg-surface-hover transition-colors text-left"
                >
                  <span>Restart to Install v{readyVersion}</span>
                </button>
              ) : downloading ? (
                <div className="px-3 py-1.5 text-gray-500 flex items-center gap-2">
                  <svg className="w-3 h-3 animate-spin text-accent shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  <span>Downloading update{downloadPercent > 0 ? ` ${downloadPercent}%` : '…'}</span>
                </div>
              ) : checkState === 'checking' ? (
                <div className="px-3 py-1.5 text-gray-500">Checking…</div>
              ) : checkState === 'upToDate' ? (
                <div className="px-3 py-1.5 text-gray-500">Up to date</div>
              ) : (
                <MenuItem label="Check for Updates" onClick={menuAction(handleCheckForUpdates)} />
              )}
              <div className="px-3 py-1 text-[10px] text-gray-700">v{__APP_VERSION__}</div>
            </div>
          )}
        </div>

        {/* Add / ? / Tour — only visible when tracks exist */}
        {tracks.length > 0 && (<>
          <div className="relative" ref={addMenuRef} data-tour="add-track">
            <button
              onClick={() => setAddMenuOpen((v) => !v)}
              className="h-5 flex items-center gap-1 px-2 text-[12px] text-gray-400 hover:text-gray-200 transition-colors leading-none"
              title="Add track"
            >
              Add
              <svg className="w-2.5 h-2.5 opacity-40" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 1l4 4 4-4" />
              </svg>
            </button>
            {addMenuOpen && (
              <div className="absolute left-0 top-full z-[200] py-1 mt-1 w-44 text-xs rounded border shadow-xl bg-surface-panel border-surface-border">
                <MenuItem label="Import Track…" onClick={addMenuAction(onAddTrack)} />
                <MenuItem label="Add Empty Row" onClick={addMenuAction(onAddEmptyTrack)} />
              </div>
            )}
          </div>

        </>)}

      </div>{/* end left cluster */}

      {tracks.length > 0 && (<>
        <div className="w-px h-4 bg-surface-border shrink-0" />

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
            className="px-1 w-40 h-6 text-sm text-gray-200 rounded border outline-none bg-surface-base border-accent shrink-0"
            placeholder="Session name"
          />
        ) : (
          <span className="flex gap-1 items-center shrink-0">
            <span
              className="text-xs text-gray-400 truncate cursor-default select-none"
              onDoubleClick={startRename}
              title="Double-click to rename"
            >
              <span className="text-gray-600">Session:</span> {sessionName}
            </span>
            <button
              onClick={startRename}
              className="text-gray-600 transition-colors hover:text-gray-300"
              title="Rename session"
            >
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8.5 1.5l2 2L3 11H1V9L8.5 1.5z" />
              </svg>
            </button>
          </span>
        )}

        {/* Left spacer */}
        <div className="flex-1" />

        {/* Zoom — centred */}
        <div className="flex gap-2 items-center shrink-0" data-tour="zoom">
          <button
            onClick={onZoomOut}
            className="w-5 h-5 flex items-center justify-center text-[12px] text-gray-400 hover:text-gray-200 bg-surface-hover hover:bg-surface-border border border-surface-border rounded transition-colors leading-none"
            title="Zoom out"
          >−</button>
          <input
            type="range"
            min={0} max={100} step={0.5}
            value={Math.log(zoom / 0.1) / Math.log(2000) * 100}
            onChange={(e) => setZoom(0.1 * Math.pow(2000, Number(e.target.value) / 100))}
            onMouseUp={(e) => (e.target as HTMLInputElement).blur()}
            className="w-60 h-1 rounded-full appearance-none bg-surface-hover cursor-ew-resize accent-accent"
            title={`Zoom: ${zoom.toFixed(0)}`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          />
          <button
            onClick={onZoomIn}
            className="w-5 h-5 flex items-center justify-center text-[12px] text-gray-400 hover:text-gray-200 bg-surface-hover hover:bg-surface-border border border-surface-border rounded transition-colors leading-none"
            title="Zoom in"
          >+</button>
          <button
            onClick={onFitToWindow}
            className="h-5 flex items-center justify-center text-[12px] text-gray-400 hover:text-gray-200 px-2 bg-surface-hover hover:bg-surface-border border border-surface-border rounded transition-colors leading-none"
            title="Fit project to window"
          >fit</button>
          <button
            onClick={onFocusPlayhead}
            className="h-5 flex items-center justify-center text-[12px] text-gray-400 hover:text-gray-200 px-2 bg-surface-hover hover:bg-surface-border border border-surface-border rounded transition-colors leading-none"
            title="Focus on playhead"
          >focus</button>
          <div className="w-px h-4 bg-surface-border" />
          <button
            onClick={() => setShortcutsOpen(true)}
            className="h-5 flex items-center justify-center text-[12px] text-gray-400 hover:text-gray-200 px-2 bg-surface-hover hover:bg-surface-border border border-surface-border rounded transition-colors leading-none"
            title="Keyboard shortcuts (?)"
          >?</button>
          <button
            onClick={onStartTour}
            className="h-5 flex items-center justify-center text-[12px] text-gray-400 hover:text-gray-200 px-2 bg-surface-hover hover:bg-surface-border border border-surface-border rounded transition-colors leading-none"
            title="Start guided tour"
          >Tour</button>
        </div>

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
