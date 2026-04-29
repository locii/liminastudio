import { useEffect, useState, useCallback, useRef } from 'react'
import { TransportBar } from './components/TransportBar'
import { Timeline } from './components/Timeline'
import { MasterChannel } from './components/MasterChannel'
import { BottomTransport } from './components/BottomTransport'
import { PropertiesPanel } from './components/PropertiesPanel'
import { ExportDialog } from './components/ExportDialog'
import { TracklistPDFDialog } from './components/TracklistPDFDialog'
import { ToastContainer } from './components/Toast'
import { WelcomeScreen } from './components/WelcomeScreen'
import { AutosaveRestoreModal } from './components/AutosaveRestoreModal'
import { GuidedTour } from './components/GuidedTour'
import { useSessionStore } from './store/sessionStore'
import { useTransportStore } from './store/transportStore'
import { useToastStore } from './store/toastStore'
import { audioEngine } from './audio/audioEngine'
import { useAutoSave } from './hooks/useAutoSave'
import type { Track, Clip } from './types'

export default function App(): JSX.Element {
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav')
  const [pdfOpen, setPdfOpen] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)
  const [autosave, setAutosave] = useState<{ json: string; savedAt: string } | null>(null)
  const tracks = useSessionStore((s) => s.tracks)
  const fitToWindowRef = useRef<(() => void) | null>(null)

  useAutoSave()

  const selectedClipId = useSessionStore((s) => s.selectedClipId)
  const selectClip = useSessionStore((s) => s.selectClip)
  const removeClip = useSessionStore((s) => s.removeClip)
  const splitClip = useSessionStore((s) => s.splitClip)
  const copyClip = useSessionStore((s) => s.copyClip)
  const pasteClip = useSessionStore((s) => s.pasteClip)
  const undo = useSessionStore((s) => s.undo)
  const redo = useSessionStore((s) => s.redo)
  const isDirty = useSessionStore((s) => s.isDirty)
  const currentFilePath = useSessionStore((s) => s.currentFilePath)
  const loadSnapshot = useSessionStore((s) => s.loadSnapshot)
  const setWaveform = useSessionStore((s) => s.setWaveform)
  const addTrackWithClip = useSessionStore((s) => s.addTrackWithClip)
  const addEmptyTrack = useSessionStore((s) => s.addEmptyTrack)
  const newSession = useSessionStore((s) => s.newSession)
  const setCurrentFile = useSessionStore((s) => s.setCurrentFile)
  const markClean = useSessionStore((s) => s.markClean)
  const toast = useToastStore((s) => s.add)

  // Check for a crash-recovery autosave on first mount
  useEffect(() => {
    window.electronAPI.checkAutosave().then((result) => {
      if (result) setAutosave(result)
    })
  }, [])

  // Sync window title
  useEffect(() => {
    const base = 'Limina Studio'
    const name = currentFilePath
      ? currentFilePath.split('/').pop()?.replace(/\.limina$/, '') ?? base
      : base
    window.electronAPI.setWindowTitle(isDirty ? `• ${name} — ${base}` : `${name} — ${base}`)
  }, [isDirty, currentFilePath])

  // Keep audio engine in sync with session state during playback
  useEffect(() => {
    let prevClips = useSessionStore.getState().clips
    let prevTracks = useSessionStore.getState().tracks
    return useSessionStore.subscribe((state) => {
      const clipsChanged = state.clips !== prevClips
      const tracksChanged = state.tracks !== prevTracks
      prevClips = state.clips
      prevTracks = state.tracks
      if (clipsChanged || tracksChanged) {
        // Immediate gain update for smooth volume slider response
        audioEngine.updateVolume(state.clips, state.tracks)
        // Full reschedule handles mute, fades, and automation correctly
        audioEngine.softReload(state.clips, state.tracks)
      }
    })
  }, [])

  // ── Session helpers ──────────────────────────────────────────────────────

  const saveSession = useCallback(async () => {
    const { tracks, clips, markers } = useSessionStore.getState()
    const json = JSON.stringify({ tracks, clips, markers }, null, 2)
    let filePath = currentFilePath
    if (!filePath) {
      filePath = await window.electronAPI.saveSession(json)
      if (!filePath) return
      setCurrentFile(filePath)
    } else {
      await window.electronAPI.saveSessionAs(json, filePath)
    }
    markClean()
    window.electronAPI.clearAutosave(filePath ?? undefined)
    toast('Session saved', 'success')
  }, [currentFilePath, setCurrentFile, markClean, toast])

  const saveSessionAs = useCallback(async () => {
    const { tracks, clips, markers } = useSessionStore.getState()
    const json = JSON.stringify({ tracks, clips, markers }, null, 2)
    const filePath = await window.electronAPI.saveSession(json)
    if (!filePath) return
    setCurrentFile(filePath)
    markClean()
    window.electronAPI.clearAutosave(filePath)
    toast('Session saved', 'success')
  }, [setCurrentFile, markClean, toast])

  const applySession = useCallback(async (result: { json: string; filePath: string }) => {
    const data = JSON.parse(result.json) as { tracks: Track[]; clips: Clip[]; markers?: import('./types').Marker[] }
    loadSnapshot(data)
    setCurrentFile(result.filePath)
    for (const track of data.tracks) {
      const clipsForTrack = data.clips.filter((c) => c.trackId === track.id)
      for (const clip of clipsForTrack) {
        window.electronAPI
          .getWaveformPeaks(clip.filePath, 1200)
          .then((peaks) => setWaveform(clip.filePath, { peaks, loading: false }))
          .catch(() => setWaveform(clip.filePath, { peaks: [], loading: false }))
      }
    }
    window.electronAPI.clearAutosave(result.filePath)
    toast('Session loaded', 'success')
  }, [loadSnapshot, setCurrentFile, setWaveform, toast])

  const openSession = useCallback(async () => {
    const result = await window.electronAPI.loadSession()
    if (!result) return
    try {
      await applySession(result)
    } catch (e) {
      toast(`Failed to load session: ${e}`, 'error')
    }
  }, [applySession, toast])

  const openRecentSession = useCallback(async (filePath: string) => {
    const result = await window.electronAPI.openRecentSession(filePath)
    if (!result) { toast('File not found', 'error'); return }
    try {
      await applySession(result)
    } catch (e) {
      toast(`Failed to load session: ${e}`, 'error')
    }
  }, [applySession, toast])

  const handleRestoreAutosave = useCallback(async () => {
    if (!autosave) return
    try {
      const data = JSON.parse(autosave.json) as { tracks: Track[]; clips: Clip[]; markers?: import('./types').Marker[] }
      loadSnapshot(data)
      for (const track of data.tracks) {
        const clipsForTrack = data.clips.filter((c) => c.trackId === track.id)
        for (const clip of clipsForTrack) {
          window.electronAPI
            .getWaveformPeaks(clip.filePath, 1200)
            .then((peaks) => setWaveform(clip.filePath, { peaks, loading: false }))
            .catch(() => setWaveform(clip.filePath, { peaks: [], loading: false }))
        }
      }
      await window.electronAPI.clearAutosave()
      setAutosave(null)
      toast('Session restored from autosave', 'success')
    } catch (e) {
      toast(`Restore failed: ${e}`, 'error')
      setAutosave(null)
    }
  }, [autosave, loadSnapshot, setWaveform, toast])

  const handleDiscardAutosave = useCallback(async () => {
    await window.electronAPI.clearAutosave()
    setAutosave(null)
  }, [])

  const handleNewSession = useCallback(() => {
    newSession()
  }, [newSession])

  const handleCollect = useCallback(async () => {
    const filePath = useSessionStore.getState().currentFilePath
    if (!filePath) { toast('Save the session first before collecting files', 'error'); return }
    const { tracks, clips } = useSessionStore.getState()
    try {
      const updatedJson = await window.electronAPI.collectProject(
        JSON.stringify({ tracks, clips }, null, 2), filePath
      )
      loadSnapshot(JSON.parse(updatedJson))
      markClean()
      toast('Audio files collected into files/ folder', 'success')
    } catch (e) { toast(`Collect failed: ${e}`, 'error') }
  }, [loadSnapshot, markClean, toast])

  const handleExportZip = useCallback(async () => {
    const filePath = useSessionStore.getState().currentFilePath
    if (!filePath) { toast('Save the session first before exporting', 'error'); return }
    const { tracks, clips } = useSessionStore.getState()
    try {
      const result = await window.electronAPI.exportProjectZip(
        JSON.stringify({ tracks, clips }, null, 2), filePath
      )
      if (!result) return
      loadSnapshot(JSON.parse(result.updatedJson))
      markClean()
      toast(`Exported to ${result.zipPath.split('/').pop()}`, 'success')
    } catch (e) { toast(`Export failed: ${e}`, 'error') }
  }, [loadSnapshot, markClean, toast])

  const handleAddTrack = useCallback(async () => {
    const files = await window.electronAPI.openAudioFiles()
    for (const file of files) {
      const { track } = addTrackWithClip({
        name: file.name.replace(/\.[^.]+$/, ''),
        filePath: file.path,
        duration: file.duration,
      })
      window.electronAPI
        .getWaveformPeaks(file.path, 1200)
        .then((peaks) => setWaveform(file.path, { peaks, loading: false }))
        .catch((err) => {
          console.error('[waveform] extraction failed for', file.path, err)
          setWaveform(file.path, { peaks: [], loading: false })
        })
    }
  }, [addTrackWithClip, setWaveform])

  // ── Keyboard shortcuts ───────────────────────────────────────────────────

  useEffect(() => {
    const handler = async (e: KeyboardEvent): Promise<void> => {
      const mod = e.metaKey || e.ctrlKey
      const tag = (document.activeElement as HTMLElement)?.tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA'

      if (mod && !e.shiftKey && e.key === 's') { e.preventDefault(); await saveSession(); return }
      if (mod && e.shiftKey && e.key === 's') { e.preventDefault(); await saveSessionAs(); return }
      if (mod && e.key === 'e') { e.preventDefault(); setExportOpen(true); return }
      if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); return }
      if (mod && e.shiftKey && e.key === 'z') { e.preventDefault(); redo(); return }
      if (mod && e.key === 'o') { e.preventDefault(); await openSession(); return }
      if (mod && e.key === 't') { e.preventDefault(); await handleAddTrack(); return }
      if (mod && e.key === 'c' && selectedClipId) { e.preventDefault(); copyClip(selectedClipId); return }
      if (mod && e.key === 'x' && selectedClipId) { e.preventDefault(); copyClip(selectedClipId); removeClip(selectedClipId); return }
      if (mod && e.key === 'v') {
        e.preventDefault()
        pasteClip(useTransportStore.getState().playhead, useSessionStore.getState().selectedTrackId ?? undefined)
        return
      }

      if (inInput) return

      if (e.key === 'Escape') { selectClip(null); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
        e.preventDefault()
        removeClip(selectedClipId)
      }
      if (e.key === 's' && selectedClipId) {
        e.preventDefault()
        splitClip(selectedClipId, useTransportStore.getState().playhead)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveSession, openSession, handleAddTrack, undo, redo, selectClip, removeClip, splitClip, copyClip, pasteClip, selectedClipId])

  // ── App menu → renderer relay ────────────────────────────────────────────

  useEffect(() => {
    const unsubs = [
      window.electronAPI.onMenu('menu:save', () => saveSession()),
      window.electronAPI.onMenu('menu:open', () => openSession()),
      window.electronAPI.onMenu('menu:export', () => { setExportFormat('wav'); setExportOpen(true) }),
      window.electronAPI.onMenu('menu:collect', () => handleCollect()),
      window.electronAPI.onMenu('menu:exportZip', () => handleExportZip()),
      window.electronAPI.onMenu('menu:undo', () => undo()),
      window.electronAPI.onMenu('menu:redo', () => redo()),
      window.electronAPI.onMenu('menu:addTrack', () => handleAddTrack()),
      window.electronAPI.onMenu('menu:deleteClip', () => { if (selectedClipId) removeClip(selectedClipId) }),
    ]
    return () => unsubs.forEach((u) => u())
  }, [saveSession, openSession, openRecentSession, handleCollect, handleExportZip, undo, redo, handleAddTrack, selectedClipId, removeClip])

  return (
    <div className="flex flex-col h-full bg-surface-base text-gray-200">
      {/* macOS traffic-light drag region */}
      <div
        className="h-7 shrink-0 bg-surface-panel"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      <TransportBar
        onAddTrack={handleAddTrack}
        onAddEmptyTrack={addEmptyTrack}
        onOpenExportWav={() => { setExportFormat('wav'); setExportOpen(true) }}
        onOpenExportMp3={() => { setExportFormat('mp3'); setExportOpen(true) }}
        onExportPDF={() => setPdfOpen(true)}
        onNewSession={handleNewSession}
        onOpen={openSession}
        onSave={saveSession}
        onSaveAs={saveSessionAs}
        onCollect={handleCollect}
        onExportZip={handleExportZip}
        onFitToWindow={() => fitToWindowRef.current?.()}
        onStartTour={() => setTourOpen(true)}
      />

      {/* Timeline + master channel side-by-side, or welcome screen */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {tracks.length === 0 ? (
          <WelcomeScreen
            onOpen={openSession}
            onOpenRecent={openRecentSession}
            onNewSession={handleNewSession}
          />
        ) : (
          <>
            <Timeline fitToWindowRef={fitToWindowRef} />
            <MasterChannel />
          </>
        )}
      </div>

      <BottomTransport />
      <PropertiesPanel />

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} defaultFormat={exportFormat} />
      <TracklistPDFDialog open={pdfOpen} onClose={() => setPdfOpen(false)} />

      {autosave && (
        <AutosaveRestoreModal
          savedAt={autosave.savedAt}
          onRestore={handleRestoreAutosave}
          onDiscard={handleDiscardAutosave}
        />
      )}

      {tourOpen && <GuidedTour onClose={() => setTourOpen(false)} />}

      <ToastContainer />
    </div>
  )
}
