import { useEffect, useState, useCallback, useRef } from 'react'
import { TransportBar } from './components/TransportBar'
import { Timeline } from './components/Timeline'
import { MasterChannel } from './components/MasterChannel'
import { BottomTransport } from './components/BottomTransport'
import { PropertiesPanel } from './components/PropertiesPanel'
import { ExportDialog } from './components/ExportDialog'
import { ImportDialog } from './components/ImportDialog'
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
import { parseSesxSession } from './utils/importers/sesxImporter'
import { parseAudacitySession } from './utils/importers/audacityImporter'

export default function App(): JSX.Element {
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav')
  const [pdfOpen, setPdfOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)
  const [autosave, setAutosave] = useState<{ json: string; savedAt: string } | null>(null)
  const [warmup, setWarmup] = useState<{ done: number; total: number } | null>(null)
  const tracks = useSessionStore((s) => s.tracks)
  const fitToWindowRef = useRef<(() => void) | null>(null)
  const scrollToPlayheadRef = useRef<(() => void) | null>(null)

  useAutoSave()

  const selectedClipId = useSessionStore((s) => s.selectedClipId)
  const selectedClipIds = useSessionStore((s) => s.selectedClipIds)
  const selectClip = useSessionStore((s) => s.selectClip)
  const removeClip = useSessionStore((s) => s.removeClip)
  const removeClips = useSessionStore((s) => s.removeClips)
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
  const setSessionLabel = useSessionStore((s) => s.setSessionLabel)
  const markClean = useSessionStore((s) => s.markClean)
  const toast = useToastStore((s) => s.add)

  // Check for a crash-recovery autosave on first mount
  useEffect(() => {
    window.electronAPI.checkAutosave().then((result) => {
      if (result) setAutosave(result)
    })
  }, [])

  // Check for updates
  const checkForUpdates = useCallback(async (silent = true) => {
    try {
      const res = await fetch('https://api.github.com/repos/locii/liminastudio/releases', {
        headers: { Accept: 'application/vnd.github.v3+json' },
      })
      if (!res.ok) { if (!silent) toast('Could not reach update server', 'error'); return }
      const releases = (await res.json()) as Array<{ tag_name: string; published_at: string }>
      if (!releases.length) return
      const latestVersion = releases[0].tag_name.replace(/^v/, '')
      if (latestVersion !== __APP_VERSION__) {
        toast(`Update available: v${latestVersion}`, 'info', 10000, 'https://www.getliminastudio.com')
      } else if (!silent) {
        toast('You\'re on the latest version', 'success')
      }
    } catch {
      if (!silent) toast('Update check failed — check your connection', 'error')
    }
  }, [toast])

  useEffect(() => {
    const t = setTimeout(() => checkForUpdates(true), 4000)
    return () => clearTimeout(t)
  }, [checkForUpdates])

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
    const { tracks, clips, markers, sessionLabel, trackHeights, laneHeights } = useSessionStore.getState()
    const json = JSON.stringify({ tracks, clips, markers, sessionLabel, trackHeights, laneHeights }, null, 2)
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
    const { tracks, clips, markers, sessionLabel, trackHeights, laneHeights } = useSessionStore.getState()
    const json = JSON.stringify({ tracks, clips, markers, sessionLabel, trackHeights, laneHeights }, null, 2)
    const filePath = await window.electronAPI.saveSession(json)
    if (!filePath) return
    setCurrentFile(filePath)
    markClean()
    window.electronAPI.clearAutosave(filePath)
    toast('Session saved', 'success')
  }, [setCurrentFile, markClean, toast])

  // Auto-dismiss the warmup bar 2 seconds after it completes
  useEffect(() => {
    if (warmup && warmup.done >= warmup.total && warmup.total > 0) {
      const t = setTimeout(() => setWarmup(null), 2000)
      return () => clearTimeout(t)
    }
    return undefined
  }, [warmup])

  const triggerWarmup = useCallback(() => {
    const paths = [...new Set(useSessionStore.getState().clips.map((c) => c.filePath))]
    if (paths.length === 0) return
    setWarmup({ done: 0, total: paths.length })
    audioEngine.warmup(paths, (done, total) => {
      setWarmup({ done, total })
    })
  }, [])

  const applySession = useCallback(async (result: { json: string; filePath: string }) => {
    audioEngine.cancelWarmup()
    setWarmup(null)
    const data = JSON.parse(result.json) as { tracks: Track[]; clips: Clip[]; markers?: import('./types').Marker[]; sessionLabel?: string; trackHeights?: Record<string, number>; laneHeights?: Record<string, number> }
    loadSnapshot(data)
    setCurrentFile(result.filePath)
    for (const track of data.tracks) {
      const clipsForTrack = data.clips.filter((c) => c.trackId === track.id)
      for (const clip of clipsForTrack) {
        window.electronAPI
          .getWaveformPeaks(clip.filePath, 4000)
          .then((peaks) => setWaveform(clip.filePath, { peaks, loading: false }))
          .catch(() => setWaveform(clip.filePath, { peaks: [], loading: false }))
      }
    }
    window.electronAPI.clearAutosave(result.filePath)
    toast('Session loaded', 'success')
    triggerWarmup()
  }, [loadSnapshot, setCurrentFile, setWaveform, toast, triggerWarmup])

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
            .getWaveformPeaks(clip.filePath, 4000)
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
    audioEngine.cancelWarmup()
    setWarmup(null)
    newSession()
  }, [newSession])

  const handleCollect = useCallback(async () => {
    const filePath = useSessionStore.getState().currentFilePath
    if (!filePath) { toast('Save the session first before collecting files', 'error'); return }
    const { tracks, clips } = useSessionStore.getState()
    const oldPathById = new Map(clips.map((c) => [c.id, c.filePath]))
    try {
      const updatedJson = await window.electronAPI.collectProject(
        JSON.stringify({ tracks, clips }, null, 2), filePath
      )
      const updated = JSON.parse(updatedJson) as { tracks: Track[]; clips: Clip[] }
      loadSnapshot(updated)
      markClean()

      // Re-fetch peaks for any clips whose filePath changed after collection
      const movedPaths = new Set<string>()
      for (const newClip of updated.clips) {
        const oldPath = oldPathById.get(newClip.id)
        if (oldPath && oldPath !== newClip.filePath) {
          movedPaths.add(newClip.filePath)
          setWaveform(newClip.filePath, { trackId: newClip.trackId, peaks: [], loading: true })
          window.electronAPI
            .getWaveformPeaks(newClip.filePath, 4000)
            .then((peaks) => setWaveform(newClip.filePath, { peaks, loading: false }))
            .catch(() => setWaveform(newClip.filePath, { peaks: [], loading: false }))
        }
      }

      const n = movedPaths.size
      toast(n > 0 ? `${n} file${n === 1 ? '' : 's'} moved to files/ folder` : 'All files already collected', 'success')
    } catch (e) { toast(`Collect failed: ${e}`, 'error') }
  }, [loadSnapshot, markClean, toast, setWaveform])

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
        .getWaveformPeaks(file.path, 4000)
        .then((peaks) => setWaveform(file.path, { peaks, loading: false }))
        .catch((err) => {
          console.error('[waveform] extraction failed for', file.path, err)
          setWaveform(file.path, { peaks: [], loading: false })
        })
    }
  }, [addTrackWithClip, setWaveform])

  const handleImport = useCallback(
    async (
      file: { content: string; filePath: string; ext: string },
      collectFolder: string | null,
      onProgress: (pct: number) => void
    ): Promise<void> => {
      onProgress(5)

      let parsed: ReturnType<typeof parseSesxSession>
      if (file.ext === 'sesx') {
        parsed = parseSesxSession(file.content)
      } else if (file.ext === 'aup') {
        parsed = parseAudacitySession(file.content)
      } else {
        throw new Error(`Unsupported file type: .${file.ext}`)
      }

      let { tracks, clips } = parsed
      const { warnings } = parsed

      if (tracks.length === 0) throw new Error('No tracks found in session file')
      onProgress(15)

      // Optionally copy audio files and remap paths
      if (collectFolder) {
        const srcPaths = [...new Set(clips.map((c) => c.filePath))]
        const mapping = await window.electronAPI.copyFiles(srcPaths, collectFolder)
        clips = clips.map((c) => ({
          ...c,
          filePath: mapping[c.filePath] ?? c.filePath,
        }))
      }
      onProgress(45)

      loadSnapshot({ tracks, clips, markers: [] })
      onProgress(50)

      // Load waveforms in parallel, tracking per-completion for progress
      const uniquePaths = [...new Set(clips.map((c) => c.filePath))]
      let done = 0
      await Promise.all(
        uniquePaths.map(async (filePath) => {
          const peaks = await window.electronAPI
            .getWaveformPeaks(filePath, 4000)
            .catch(() => [] as number[])
          setWaveform(filePath, { peaks, loading: false })
          done++
          onProgress(50 + Math.round((done / uniquePaths.length) * 48))
        })
      )
      onProgress(100)

      warnings.forEach((w) => toast(w, 'error'))
      toast(
        `Imported ${tracks.length} track${tracks.length !== 1 ? 's' : ''}, ${clips.length} clip${clips.length !== 1 ? 's' : ''}`,
        'success'
      )
      triggerWarmup()
    },
    [loadSnapshot, setWaveform, toast, triggerWarmup]
  )

  // ── Keyboard shortcuts ───────────────────────────────────────────────────

  useEffect(() => {
    const handler = async (e: KeyboardEvent): Promise<void> => {
      const mod = e.metaKey || e.ctrlKey
      const activeEl = document.activeElement as HTMLElement | null
      const tag = activeEl?.tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (activeEl?.isContentEditable ?? false)

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

      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); scrollToPlayheadRef.current?.(); return }
      if (e.key === 'Escape') { selectClip(null); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipIds.length > 0) {
        e.preventDefault()
        removeClips(selectedClipIds)
      }
      if (e.key === 's' && selectedClipId) {
        e.preventDefault()
        splitClip(selectedClipId, useTransportStore.getState().playhead)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveSession, openSession, handleAddTrack, undo, redo, selectClip, removeClip, removeClips, splitClip, copyClip, pasteClip, selectedClipId, selectedClipIds])

  // ── App menu → renderer relay ────────────────────────────────────────────

  useEffect(() => {
    const unsubs = [
      window.electronAPI.onMenu('menu:save', () => saveSession()),
      window.electronAPI.onMenu('menu:open', () => openSession()),
      window.electronAPI.onMenu('menu:import', () => setImportOpen(true)),
      window.electronAPI.onMenu('menu:export', () => { setExportFormat('wav'); setExportOpen(true) }),
      window.electronAPI.onMenu('menu:collect', () => handleCollect()),
      window.electronAPI.onMenu('menu:exportZip', () => handleExportZip()),
      window.electronAPI.onMenu('menu:undo', () => undo()),
      window.electronAPI.onMenu('menu:redo', () => redo()),
      window.electronAPI.onMenu('menu:addTrack', () => handleAddTrack()),
      window.electronAPI.onMenu('menu:deleteClip', () => { if (selectedClipId) removeClip(selectedClipId) }),
      window.electronAPI.onMenu('menu:checkForUpdates', () => checkForUpdates(false)),
    ]
    return () => unsubs.forEach((u) => u())
  }, [saveSession, openSession, openRecentSession, handleCollect, handleExportZip, undo, redo, handleAddTrack, selectedClipId, removeClip, checkForUpdates])

  return (
    <div className="flex flex-col h-full text-gray-200 bg-surface-base">
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
        onImport={() => setImportOpen(true)}
        onSave={saveSession}
        onSaveAs={saveSessionAs}
        onCollect={handleCollect}
        onExportZip={handleExportZip}
        onFitToWindow={() => fitToWindowRef.current?.()}
        onStartTour={() => setTourOpen(true)}
      />

      {/* Warmup progress bar — full width strip below transport bar */}
      {warmup && warmup.total > 0 && (
        <div className="flex overflow-hidden relative gap-3 items-center h-5 border-b shrink-0 bg-surface-panel border-surface-border">
          <div
            className="absolute inset-y-0 left-0 transition-all duration-300 bg-accent/30"
            style={{ width: `${Math.round((warmup.done / warmup.total) * 100)}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 w-px transition-all duration-300 bg-accent"
            style={{ left: `${Math.round((warmup.done / warmup.total) * 100)}%` }}
          />
          <span className="text-[10px] text-gray-500 tabular-nums shrink-0 relative pl-[10px]">
            {warmup.done < warmup.total
              ? `Buffering ${warmup.done} / ${warmup.total} files`
              : 'Ready'}
          </span>
        </div>
      )}

      {/* Timeline + master channel side-by-side, or welcome screen */}
      <div className="flex overflow-hidden flex-1 min-h-0">
        {tracks.length === 0 ? (
          <WelcomeScreen
            onOpen={openSession}
            onOpenRecent={openRecentSession}
            onNewSession={handleNewSession}
            onImport={() => setImportOpen(true)}
          />
        ) : (
          <>
            <Timeline fitToWindowRef={fitToWindowRef} scrollToPlayheadRef={scrollToPlayheadRef} />
            <MasterChannel />
          </>
        )}
      </div>

      {tracks.length > 0 && <BottomTransport />}
      {tracks.length > 0 && <PropertiesPanel />}

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} defaultFormat={exportFormat} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImport={handleImport} />
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
