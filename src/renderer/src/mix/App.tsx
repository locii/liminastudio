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
import { LibraryDock } from './components/LibraryDock'
import { GlobalControls } from '../GlobalControls'
import { WorkspaceSwitcher } from '../WorkspaceSwitcher'
import { useUIStore } from '../uiStore'
import { requestNavigate } from '../navigate'
import { AutosaveRestoreModal } from './components/AutosaveRestoreModal'
import { GuidedTour } from './components/GuidedTour'
import { useSessionStore } from './store/sessionStore'
import { useTransportStore } from './store/transportStore'
import { useToastStore } from './store/toastStore'
import { useUpdaterStore } from './store/updaterStore'
import { audioEngine } from './audio/audioEngine'
import { useAutoSave } from './hooks/useAutoSave'
import type { Track, Clip } from './types'
import { parseSesxSession } from './utils/importers/sesxImporter'
import { parseAudacitySession } from './utils/importers/audacityImporter'
import { markTriedMix } from '../OnboardingWizard'

const TARGET_PEAK_LINEAR = Math.pow(10, -0.5 / 20) // -0.5 dBFS

// Extract peaks at the timeline's MAXIMUM zoom (not the current zoom) so zooming
// in stays crisp without re-fetching per clip. 1 peak ≈ 1px at max zoom; capped so
// very long clips stay bounded (a 4-min clip already gets ~48k peaks). The second
// arg is kept for call-site compatibility but intentionally ignored.
const PEAK_REF_PX_PER_SEC = 200 // matches TransportBar's max zoom
function peaksForClip(duration: number, _zoom?: number): number {
  return Math.min(Math.ceil(duration * PEAK_REF_PX_PER_SEC), 50_000)
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function App(): JSX.Element {
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav')
  const [pdfOpen, setPdfOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)
  const mixOpenLibraryOnMount = useUIStore((s) => s.mixOpenLibraryOnMount)
  const setMixOpenLibraryOnMount = useUIStore((s) => s.setMixOpenLibraryOnMount)
  const [libraryDockOpen, setLibraryDockOpen] = useState(false)

  // Entering Mix Mode (any path) retires the "try these next" card.
  useEffect(() => { markTriedMix() }, [])

  useEffect(() => {
    if (mixOpenLibraryOnMount) {
      setLibraryDockOpen(true)
      setMixOpenLibraryOnMount(false)
    }
  }, [mixOpenLibraryOnMount, setMixOpenLibraryOnMount])
  const [autosave, setAutosave] = useState<{ json: string; savedAt: string } | null>(null)
  const [warmup, setWarmup] = useState<{ done: number; total: number } | null>(null)
  const [saveGuard, setSaveGuard] = useState<{ message: string } | null>(null)
  const applySessionRef = useRef<((r: { json: string; filePath: string }) => Promise<void>) | null>(null)
  const fitToWindowRef = useRef<(() => void) | null>(null)
  const scrollToPlayheadRef = useRef<(() => void) | null>(null)
  const focusPlayheadRef = useRef<(() => void) | null>(null)
  const zoomByRef = useRef<((factor: number) => void) | null>(null)

  useAutoSave()

  const selectedClipId = useSessionStore((s) => s.selectedClipId)
  const selectedClipIds = useSessionStore((s) => s.selectedClipIds)
  const selectClip = useSessionStore((s) => s.selectClip)
  const removeClip = useSessionStore((s) => s.removeClip)
  const removeClips = useSessionStore((s) => s.removeClips)
  const splitClip = useSessionStore((s) => s.splitClip)
  const copyClip = useSessionStore((s) => s.copyClip)
  const pasteClip = useSessionStore((s) => s.pasteClip)
  const addClipToTrack = useSessionStore((s) => s.addClipToTrack)
  const undo = useSessionStore((s) => s.undo)
  const redo = useSessionStore((s) => s.redo)
  const isDirty = useSessionStore((s) => s.isDirty)
  const currentFilePath = useSessionStore((s) => s.currentFilePath)
  const loadSnapshot = useSessionStore((s) => s.loadSnapshot)
  const setWaveform = useSessionStore((s) => s.setWaveform)
  const updateClip = useSessionStore((s) => s.updateClip)
  const addTrackWithClip = useSessionStore((s) => s.addTrackWithClip)
  const addEmptyTrack = useSessionStore((s) => s.addEmptyTrack)
  const newSession = useSessionStore((s) => s.newSession)
  const setCurrentFile = useSessionStore((s) => s.setCurrentFile)
  const setSessionLabel = useSessionStore((s) => s.setSessionLabel)
  const markClean = useSessionStore((s) => s.markClean)
  const toast = useToastStore((s) => s.add)
  const { setDownloading, setReady } = useUpdaterStore()
  const setSurface = useUIStore((s) => s.setSurface)

  // Prevent buttons from stealing keyboard focus on mouse click so Space/shortcuts
  // always reach the document-level handler rather than activating the last clicked button.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (e.target instanceof HTMLButtonElement) e.preventDefault()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // The persistent global "?" dispatches this — open Mix's guided tour.
  useEffect(() => {
    const handler = (): void => setTourOpen(true)
    window.addEventListener('app:start-tour', handler)
    return () => window.removeEventListener('app:start-tour', handler)
  }, [])

  // Crash-recovery autosave restore prompt is disabled: the Mix app remounts on
  // every workspace switch and the autosave reflects the user's live session, so
  // the prompt was noise. Autosave still WRITES (useAutoSave) so nothing is lost;
  // to re-enable the restore prompt, call window.electronAPI.checkAutosave() here
  // and setAutosave(result).

  // Mix opens straight into an empty session (no welcome splash) when nothing is
  // loaded, so you can start dragging tracks in immediately.
  useEffect(() => {
    if (useSessionStore.getState().tracks.length === 0) newSession()
  }, [newSession])


  // Sync window title
  useEffect(() => {
    const base = 'Limina Mix'
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

  // The actual write (atomic + backup happen in the main process).
  const writeSessionToDisk = useCallback(async () => {
    const { tracks, clips, segments, segmentLaneHeight, segmentLaneCollapsed, sessionLabel, trackHeights, laneHeights } = useSessionStore.getState()
    const json = JSON.stringify({ tracks, clips, segments, segmentLaneHeight, segmentLaneCollapsed, sessionLabel, trackHeights, laneHeights }, null, 2)
    let filePath = currentFilePath
    if (!filePath) {
      // New session → save as a project folder by default (Foo/Foo.limina).
      filePath = await window.electronAPI.saveProject(json, sessionLabel || undefined)
      if (!filePath) return
      setCurrentFile(filePath)
    } else {
      await window.electronAPI.saveSessionAs(json, filePath)
    }
    markClean()
    window.electronAPI.clearAutosave(filePath ?? undefined)
    toast('Session saved', 'success')
  }, [currentFilePath, setCurrentFile, markClean, toast])

  // Save the current session as a NEW project folder (migrates a loose .limina).
  const saveAsProject = useCallback(async () => {
    const { tracks, clips, segments, segmentLaneHeight, segmentLaneCollapsed, sessionLabel, trackHeights, laneHeights } = useSessionStore.getState()
    const json = JSON.stringify({ tracks, clips, segments, segmentLaneHeight, segmentLaneCollapsed, sessionLabel, trackHeights, laneHeights }, null, 2)
    const filePath = await window.electronAPI.saveProject(json, sessionLabel || undefined)
    if (!filePath) return
    setCurrentFile(filePath)
    markClean()
    window.electronAPI.clearAutosave(filePath)
    toast('Project saved', 'success')
  }, [setCurrentFile, markClean, toast])

  // Save-guard: never let a degraded read (zero-length clips / missing audio)
  // silently overwrite a good mix. Warn first; the actual save is atomic + keeps
  // a rolling backup, so an accepted overwrite is still recoverable.
  const saveSession = useCallback(async () => {
    const { clips } = useSessionStore.getState()
    const badDuration = clips.filter((c) => !(c.duration > 0)).length
    const uniquePaths = [...new Set(clips.map((c) => c.filePath))]
    const missing = (await window.electronAPI.checkFilesExist(uniquePaths).catch(() => [] as string[])).length
    if (badDuration > 0 || missing > 0) {
      const parts: string[] = []
      if (badDuration > 0) parts.push(`${badDuration} clip${badDuration > 1 ? 's' : ''} with unknown length`)
      if (missing > 0) parts.push(`${missing} missing file${missing > 1 ? 's' : ''}`)
      setSaveGuard({ message: parts.join(' and ') })
      return
    }
    await writeSessionToDisk()
  }, [writeSessionToDisk])

  const revertToBackup = useCallback(async () => {
    if (!currentFilePath) { toast('Save the session once before reverting to a backup', 'info'); return }
    const result = await window.electronAPI.revertToBackup(currentFilePath)
    if (!result) return
    try {
      await applySessionRef.current?.(result)
    } catch (e) {
      toast(`Failed to load backup: ${e}`, 'error')
    }
  }, [currentFilePath, toast])

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

  // Fetch waveforms + MFB metadata for a freshly loaded set of clips, first
  // checking which source files are actually present. Missing files are flagged
  // (rendered as placeholders, skipped by the audio engine) so one absent track
  // never stalls buffering or throws off the rest of the timeline.
  const loadClipWaveforms = useCallback(async (clips: Clip[]) => {
    const uniquePaths = [...new Set(clips.map((c) => c.filePath))]
    const liminaPath = useSessionStore.getState().currentFilePath
    let missing: string[] = []
    // Project-folder fallback: for a file gone from its original location, look
    // for a collected copy in the project's files/ folder and relink to it.
    let resolvedMap: Record<string, string> = {}
    try {
      if (liminaPath) {
        const res = await window.electronAPI.resolveMissing(liminaPath, uniquePaths)
        resolvedMap = res.resolved
        missing = res.missing
        for (const [orig, found] of Object.entries(resolvedMap)) {
          clips.filter((c) => c.filePath === orig).forEach((c) => updateClip(c.id, { filePath: found }))
        }
      } else {
        missing = await window.electronAPI.checkFilesExist(uniquePaths)
      }
    } catch {
      missing = []
    }
    const missingSet = new Set(missing)
    audioEngine.setMissingPaths(missing)

    const zoom = useTransportStore.getState().zoom
    for (const clip of clips) {
      // Use the relinked path if this clip's original was recovered from files/.
      const fp = resolvedMap[clip.filePath] ?? clip.filePath
      if (missingSet.has(clip.filePath)) {
        setWaveform(clip.filePath, { trackId: clip.trackId, peaks: [], loading: false, missing: true })
        continue
      }
      // Clips saved with a bad duration (0/NaN) — metadata failed at import time
      // (float WAV, or a dataless Dropbox file). These are a zero-width sliver on
      // the timeline; the global heal effect restores their true length + ripples
      // the following clips. Just mark it loading here and let that effect run.
      if (!(clip.duration > 0)) {
        setWaveform(fp, { trackId: clip.trackId, peaks: [], loading: true, missing: false })
        continue
      }
      window.electronAPI
        .getWaveformPeaks(fp, peaksForClip(clip.duration, zoom))
        .then((peaks) => setWaveform(fp, { peaks, loading: false, missing: false }))
        .catch((e) => {
          console.error('[loadClipWaveforms] getWaveformPeaks failed for', fp, e)
          setWaveform(fp, { peaks: [], loading: false })
        })
      if (clip.mfbTrackId == null) {
        window.electronAPI
          .lookupLibraryFile(fp)
          .then((libData) => {
            if (libData) updateClip(clip.id, {
              mfbTrackId: libData.mfbTrackId,
              mfbTrackTitle: libData.trackTitle || undefined,
              mfbArtist: libData.artist || undefined,
              mfbAlbumImageUrl: libData.albumImageUrl ?? undefined,
              mfbTags: libData.tags,
              mfbBreathworkPhase: libData.breathworkPhase,
            })
          })
          .catch(() => {})
      }
    }

    if (missing.length > 0) {
      toast(
        `${missing.length} file${missing.length === 1 ? '' : 's'} missing — shown as placeholders and skipped during playback`,
        'error',
        8000
      )
    }
  }, [setWaveform, updateClip, toast])

  // Self-healing: any clip whose duration was saved as 0 (file missing/dataless
  // at build time) collapses to a zero-width sliver and throws off the layout.
  // Whenever such a clip appears — from ANY load path (open, autosave, Open-in-Mix,
  // import, drag) — restore its true length via ffmpeg and ripple the later clips
  // back so nothing overlaps. Runs once per clip id (guarded) and is reviewable:
  // it flags each healed clip and only persists when the user saves.
  const healedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const runHeal = (): void => {
      const { clips } = useSessionStore.getState()
      const zoom = useTransportStore.getState().zoom
      for (const c of clips) {
        if (c.duration > 0 || healedRef.current.has(c.id)) continue
        healedRef.current.add(c.id)
        const clipId = c.id, filePath = c.filePath, fileName = c.fileName, trackId = c.trackId
        void (async (): Promise<void> => {
          try {
            const missing = await window.electronAPI.checkFilesExist([filePath])
            if (missing.length > 0) {
              // Can't recover length without the file — flag it and allow a
              // re-heal later once the user relinks it via "Locate file…".
              setWaveform(filePath, { trackId, peaks: [], loading: false, missing: true })
              healedRef.current.delete(clipId)
              return
            }
            const dur = await window.electronAPI.getFileDuration(filePath)
            if (!(dur > 0)) { healedRef.current.delete(clipId); return }
            useSessionStore.getState().healClipDuration(clipId, dur)
            toast(`Restored “${fileName}” to full length (${formatClock(dur)}) — check its trim`, 'info', 6000)
            const peaks = await window.electronAPI.getWaveformPeaks(filePath, peaksForClip(dur, zoom))
            setWaveform(filePath, { peaks, loading: false, missing: false })
            // Clear the guard: the clip is now duration>0 so it won't re-trigger
            // this session, but reloading the same file from disk (unhealed) will.
            healedRef.current.delete(clipId)
          } catch {
            healedRef.current.delete(clipId)
          }
        })()
      }
    }
    runHeal()
    return useSessionStore.subscribe(runHeal)
  }, [setWaveform, toast])

  const applySession = useCallback(async (result: { json: string; filePath: string }) => {
    audioEngine.cancelWarmup()
    setWarmup(null)
    const data = JSON.parse(result.json) as { tracks: Track[]; clips: Clip[]; segments?: import('./types').Segment[]; segmentLaneHeight?: number; segmentLaneCollapsed?: boolean; sessionLabel?: string; trackHeights?: Record<string, number>; laneHeights?: Record<string, number> }
    loadSnapshot(data)
    setCurrentFile(result.filePath)
    await loadClipWaveforms(data.clips)
    window.electronAPI.clearAutosave(result.filePath)
    toast('Session loaded', 'success')
    triggerWarmup()
  }, [loadSnapshot, setCurrentFile, loadClipWaveforms, toast, triggerWarmup])

  // Expose applySession to callbacks defined earlier (e.g. revertToBackup).
  applySessionRef.current = applySession

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
      const data = JSON.parse(autosave.json) as { tracks: Track[]; clips: Clip[] }
      loadSnapshot(data)
      await loadClipWaveforms(data.clips)
      await window.electronAPI.clearAutosave()
      setAutosave(null)
      toast('Session restored from autosave', 'success')
    } catch (e) {
      toast(`Restore failed: ${e}`, 'error')
      setAutosave(null)
    }
  }, [autosave, loadSnapshot, loadClipWaveforms, toast])

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
    const { tracks, clips, trackHeights, laneHeights } = useSessionStore.getState()
    const oldPathById = new Map(clips.map((c) => [c.id, c.filePath]))
    try {
      const updatedJson = await window.electronAPI.collectProject(
        JSON.stringify({ tracks, clips }, null, 2), filePath
      )
      const updated = JSON.parse(updatedJson) as { tracks: Track[]; clips: Clip[] }
      loadSnapshot({ ...updated, trackHeights, laneHeights })
      markClean()

      // Re-fetch peaks for any clips whose filePath changed after collection
      const movedPaths = new Set<string>()
      for (const newClip of updated.clips) {
        const oldPath = oldPathById.get(newClip.id)
        if (oldPath && oldPath !== newClip.filePath) {
          movedPaths.add(newClip.filePath)
          setWaveform(newClip.filePath, { trackId: newClip.trackId, peaks: [], loading: true })
          window.electronAPI
            .getWaveformPeaks(newClip.filePath, peaksForClip(newClip.duration, useTransportStore.getState().zoom))
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
    const { tracks, clips, trackHeights, laneHeights } = useSessionStore.getState()
    try {
      const result = await window.electronAPI.exportProjectZip(
        JSON.stringify({ tracks, clips }, null, 2), filePath
      )
      if (!result) return
      loadSnapshot({ ...JSON.parse(result.updatedJson), trackHeights, laneHeights })
      markClean()
      toast(`Exported to ${result.zipPath.split('/').pop()}`, 'success')
    } catch (e) { toast(`Export failed: ${e}`, 'error') }
  }, [loadSnapshot, markClean, toast])

  const handleRebuildWaveforms = useCallback(async () => {
    const { clips } = useSessionStore.getState()
    const uniquePaths = [...new Set(clips.map((c) => c.filePath))]
    if (uniquePaths.length === 0) { toast('No clips to rebuild', 'info'); return }

    for (const filePath of uniquePaths) {
      setWaveform(filePath, { peaks: [], loading: true })
    }
    toast(`Rebuilding ${uniquePaths.length} waveform${uniquePaths.length !== 1 ? 's' : ''}…`, 'info')

    const zoom = useTransportStore.getState().zoom
    let ok = 0
    let empty = 0
    let failed = 0
    await Promise.all(
      uniquePaths.map(async (filePath) => {
        const dur = useSessionStore.getState().clips.find((c) => c.filePath === filePath)?.duration ?? 300
        try {
          const peaks = await window.electronAPI.getWaveformPeaks(filePath, peaksForClip(dur, zoom))
          if (peaks.some((v) => v !== 0)) {
            // Real audio decoded — clear any stale missing flag (setWaveform merges,
            // so an old missing:true would otherwise keep the clip hidden).
            setWaveform(filePath, { peaks, loading: false, missing: false })
            ok++
          } else {
            // File opened but produced silence/no data (zero-byte or cloud placeholder).
            // Flag as missing so it shows the red placeholder + Locate affordance
            // rather than a blank-but-normal clip the user can't diagnose or recover.
            console.warn('[rebuildWaveforms] empty peaks for', filePath)
            setWaveform(filePath, { peaks: [], loading: false, missing: true })
            empty++
          }
        } catch (e) {
          console.error('[rebuildWaveforms] failed for', filePath, e)
          setWaveform(filePath, { peaks: [], loading: false, missing: true })
          failed++
        }
      })
    )
    if (ok === uniquePaths.length) {
      toast(`Rebuilt ${ok} waveform${ok !== 1 ? 's' : ''}`, 'success')
    } else {
      const parts = [`${ok} rebuilt`]
      if (empty > 0) parts.push(`${empty} empty (no audio data)`)
      if (failed > 0) parts.push(`${failed} failed`)
      toast(parts.join(', '), empty + failed > 0 ? 'error' : 'success', 7000)
    }
  }, [setWaveform, toast])

  const handleSyncAllMfb = useCallback(async () => {
    const { clips } = useSessionStore.getState()
    const matched = clips.filter((c) => c.mfbTrackId != null)
    if (matched.length === 0) { toast('No MFB-linked clips to sync', 'info'); return }
    toast(`Syncing MFB data for ${matched.length} clip${matched.length !== 1 ? 's' : ''}…`, 'info')
    let done = 0
    for (const clip of matched) {
      try {
        const data = await window.electronAPI.mfbFetchTrack(clip.mfbTrackId!) as Record<string, unknown>
        const allTags = ([] as { name: string }[]).concat(
          ...Object.values((data['tags'] as Record<string, { name: string }[]>) ?? {})
        )
        const tags = allTags.map((t) => t.name)
        const hourTag = (data['tags'] as Record<string, { name: string; slug?: { en?: string } }[]>)?.['Hour']?.[0]
        updateClip(clip.id, {
          mfbTrackTitle: (data['title'] as string) ?? undefined,
          mfbArtist: (data['artist'] as string) ?? undefined,
          mfbAlbumImageUrl: (data['album'] as Record<string, unknown>)?.['image_url'] as string ?? undefined,
          mfbTags: tags,
          mfbBreathworkPhase: hourTag?.slug?.en ?? null,
        })
        done++
      } catch { /* skip per-clip failures */ }
    }
    toast(`Synced MFB data for ${done} clip${done !== 1 ? 's' : ''}`, 'success')
  }, [toast, updateClip])

  const handleExportWaveformData = useCallback(async () => {
    const { clips, waveforms, sessionLabel } = useSessionStore.getState()
    const byPath = new Map<string, { filePath: string; fileName: string; duration: number; clipIds: string[] }>()
    for (const c of clips) {
      const existing = byPath.get(c.filePath)
      if (existing) existing.clipIds.push(c.id)
      else byPath.set(c.filePath, { filePath: c.filePath, fileName: c.fileName, duration: c.duration, clipIds: [c.id] })
    }
    const entries = [...byPath.values()].map((info) => {
      const wf = waveforms[info.filePath]
      const peaks = wf?.peaks ?? []
      return {
        filePath: info.filePath,
        fileName: info.fileName,
        duration: info.duration,
        clipIds: info.clipIds,
        format: 'interleaved-min-max',
        numPairs: peaks.length >> 1,
        loaded: !wf?.loading && peaks.length > 0,
        peaks,
      }
    })
    const payload = {
      exportedAt: new Date().toISOString(),
      sessionLabel,
      app: 'Limina Studio',
      sampleRate: 48000,
      entries,
    }
    const defaultName = `${(sessionLabel || 'session').replace(/[^\w.-]+/g, '_')}-waveforms.json`
    try {
      const saved = await window.electronAPI.exportWaveformData(JSON.stringify(payload, null, 2), defaultName)
      if (saved) toast(`Exported waveform data to ${saved.split('/').pop()}`, 'success')
    } catch (e) {
      toast(`Export failed: ${e}`, 'error')
    }
  }, [toast])

  const handleAddTrack = useCallback(async () => {
    const files = await window.electronAPI.openAudioFiles()
    for (const file of files) {
      const { clip } = addTrackWithClip({
        name: file.name.replace(/\.[^.]+$/, ''),
        filePath: file.path,
        duration: file.duration,
      })
      window.electronAPI
        .getWaveformPeaks(file.path, peaksForClip(file.duration, useTransportStore.getState().zoom))
        .then((peaks) => setWaveform(file.path, { peaks, loading: false }))
        .catch((err) => {
          console.error('[waveform] extraction failed for', file.path, err)
          setWaveform(file.path, { peaks: [], loading: false })
        })
      window.electronAPI
        .getPeakLevel(file.path)
        .then((peak) => { if (peak > 0) updateClip(clip.id, { volume: Math.min(2, TARGET_PEAK_LINEAR / peak) }) })
        .catch(() => {})
      window.electronAPI
        .lookupLibraryFile(file.path)
        .then((data) => {
          if (data) updateClip(clip.id, {
            mfbTrackId: data.mfbTrackId,
            mfbTrackTitle: data.trackTitle || undefined,
            mfbArtist: data.artist || undefined,
            mfbAlbumImageUrl: data.albumImageUrl ?? undefined,
            mfbTags: data.tags,
            mfbBreathworkPhase: data.breathworkPhase,
          })
        })
        .catch(() => {})
    }
  }, [addTrackWithClip, setWaveform, updateClip])

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

      loadSnapshot({ tracks, clips })
      onProgress(50)

      // Load waveforms + auto gain in parallel per unique file
      const uniquePaths = [...new Set(clips.map((c) => c.filePath))]
      let done = 0
      await Promise.all(
        uniquePaths.map(async (filePath) => {
          const [peaks, peak] = await Promise.all([
            window.electronAPI.getWaveformPeaks(filePath, peaksForClip(clips.find(c => c.filePath === filePath)?.duration ?? 300, useTransportStore.getState().zoom)).catch(() => [] as number[]),
            window.electronAPI.getPeakLevel(filePath).catch(() => 0),
          ])
          setWaveform(filePath, { peaks, loading: false })
          if (peak > 0) {
            const vol = Math.min(2, TARGET_PEAK_LINEAR / peak)
            clips.filter((c) => c.filePath === filePath).forEach((c) => updateClip(c.id, { volume: vol }))
          }
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
    [loadSnapshot, setWaveform, updateClip, toast, triggerWarmup]
  )

  // ── Keyboard shortcuts ───────────────────────────────────────────────────

  useEffect(() => {
    const handler = async (e: KeyboardEvent): Promise<void> => {
      const mod = e.metaKey || e.ctrlKey
      const activeEl = document.activeElement as HTMLElement | null
      const tag = activeEl?.tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (activeEl?.isContentEditable ?? false)

      if (mod && !e.shiftKey && e.key === 's') { e.preventDefault(); await saveSession(); return }
      if (mod && e.shiftKey && e.key === 's') { e.preventDefault(); await saveAsProject(); return }
      if (mod && e.key === 'e') { e.preventDefault(); setExportOpen(true); return }
      if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); return }
      if (mod && e.shiftKey && e.key === 'z') { e.preventDefault(); redo(); return }
      if (mod && e.key === 'o') { e.preventDefault(); await openSession(); return }
      if (mod && e.key === 't') { e.preventDefault(); await handleAddTrack(); return }
      if (mod && e.key === 'c' && (selectedClipId ?? selectedClipIds[0])) { e.preventDefault(); copyClip(selectedClipId ?? selectedClipIds[0]); return }
      if (mod && e.key === 'x' && selectedClipIds.length > 0) { e.preventDefault(); copyClip(selectedClipId ?? selectedClipIds[0]); removeClips(selectedClipIds); return }
      if (mod && e.key === 'v') {
        e.preventDefault()
        if (useSessionStore.getState().copiedClip) {
          pasteClip(useTransportStore.getState().playhead, useSessionStore.getState().selectedTrackId ?? undefined)
        } else {
          const filePath = await window.electronAPI.readClipboardPath()
          if (filePath) {
            const tracks = useSessionStore.getState().tracks
            const targetTrackId = useSessionStore.getState().selectedTrackId ?? tracks[0]?.id
            if (targetTrackId) {
              const meta = await window.electronAPI.getAudioMetadata(filePath)
              if (meta) {
                const clip = addClipToTrack({
                  trackId: targetTrackId,
                  name: filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'clip',
                  filePath,
                  duration: meta.duration,
                  startTime: useTransportStore.getState().playhead,
                })
                window.electronAPI.getWaveformPeaks(filePath, peaksForClip(meta.duration, useTransportStore.getState().zoom))
                  .then((peaks) => setWaveform(filePath, { peaks, loading: false }))
                  .catch(console.error)
                window.electronAPI.getPeakLevel(filePath)
                  .then((peak) => { if (peak > 0) updateClip(clip.id, { volume: Math.min(2, 1 / peak) }) })
                  .catch(() => {})
              }
            }
          }
        }
        return
      }

      if (mod && e.key === 'a' && !inInput) {
        e.preventDefault()
        const allIds = useSessionStore.getState().clips.map((c) => c.id)
        useSessionStore.setState({ selectedClipIds: allIds })
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
  }, [saveSession, saveAsProject, openSession, handleAddTrack, undo, redo, selectClip, removeClip, removeClips, splitClip, copyClip, pasteClip, addClipToTrack, updateClip, setWaveform, selectedClipId, selectedClipIds])

  // ── File opened from OS (Limina Library or .limina double-click) ────────
  // Root stashes the path and switches to Mix; consume it here — on mount if a
  // path was queued before Mix existed, and live while Mix stays mounted.
  const pendingMixOpenPath = useUIStore((s) => s.pendingMixOpenPath)
  useEffect(() => {
    if (!pendingMixOpenPath) return
    useUIStore.getState().setPendingMixOpenPath(null)
    openRecentSession(pendingMixOpenPath)
  }, [pendingMixOpenPath, openRecentSession])

  useEffect(() => {
    return window.electronAPI.onMenuOpenRecent((filePath) => {
      openRecentSession(filePath)
    })
  }, [openRecentSession])

  // Re-fetch waveform peaks when zoom changes so density stays 1 peak/pixel for all clips
  useEffect(() => {
    let prevZoom = useTransportStore.getState().zoom
    let timer: ReturnType<typeof setTimeout>
    return useTransportStore.subscribe((state) => {
      if (state.zoom === prevZoom) return
      prevZoom = state.zoom
      const zoom = state.zoom
      clearTimeout(timer)
      timer = setTimeout(() => {
        const { clips } = useSessionStore.getState()
        const seen = new Set<string>()
        for (const clip of clips) {
          if (seen.has(clip.filePath)) continue
          seen.add(clip.filePath)
          window.electronAPI
            .getWaveformPeaks(clip.filePath, peaksForClip(clip.duration, zoom))
            .then((peaks) => setWaveform(clip.filePath, { peaks, loading: false }))
            .catch(() => {})
        }
      }, 300)
    })
  }, [setWaveform])

  useEffect(() => {
    return window.electronAPI.onUpdateDownloading((percent) => {
      setDownloading(percent)
    })
  }, [setDownloading])

  useEffect(() => {
    return window.electronAPI.onUpdateDownloaded((version) => {
      setReady(version)
      toast(`Update v${version} downloaded — will install on next launch`, 'info', 8000)
    })
  }, [toast, setReady])

  // ── App menu → renderer relay ────────────────────────────────────────────

  useEffect(() => {
    const unsubs = [
      window.electronAPI.onMenu('menu:save', () => saveSession()),
      window.electronAPI.onMenu('menu:open', () => openSession()),
      window.electronAPI.onMenu('menu:saveProject', () => saveAsProject()),
      window.electronAPI.onMenu('menu:revertBackup', () => revertToBackup()),
      window.electronAPI.onMenu('menu:import', () => setImportOpen(true)),
      window.electronAPI.onMenu('menu:export', () => { setExportFormat('wav'); setExportOpen(true) }),
      window.electronAPI.onMenu('menu:exportPDF', () => setPdfOpen(true)),
      window.electronAPI.onMenu('menu:collect', () => handleCollect()),
      window.electronAPI.onMenu('menu:exportZip', () => handleExportZip()),
      window.electronAPI.onMenu('menu:undo', () => undo()),
      window.electronAPI.onMenu('menu:redo', () => redo()),
      window.electronAPI.onMenu('menu:addTrack', () => handleAddTrack()),
      window.electronAPI.onMenu('menu:deleteClip', () => { if (selectedClipId) removeClip(selectedClipId) }),
      window.electronAPI.onMenu('menu:rebuildWaveforms', () => handleRebuildWaveforms()),
      window.electronAPI.onMenu('menu:exportWaveformData', () => handleExportWaveformData()),
      window.electronAPI.onMenu('menu:syncMfbData', () => handleSyncAllMfb()),
    ]
    return () => unsubs.forEach((u) => u())
  }, [saveSession, saveAsProject, openSession, revertToBackup, openRecentSession, handleCollect, handleExportZip, undo, redo, handleAddTrack, selectedClipId, removeClip, handleRebuildWaveforms, handleExportWaveformData, handleSyncAllMfb])

  return (
    <div className="flex flex-col h-full text-gray-200 bg-surface-base">
      {/* macOS traffic-light drag region */}
      <div
        className="h-7 shrink-0 bg-surface-panel"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* App toolbar — consistent across all workspaces */}
      <div
        className="flex items-center justify-between px-3 h-10 border-b shrink-0 bg-surface-panel border-surface-border"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            type="button"
            onClick={() => requestNavigate(() => setSurface('home'), 'home')}
            title="Back to Home"
            className="flex items-center justify-center w-6 h-6 text-gray-400 rounded border transition-colors bg-surface-hover hover:bg-surface-border border-surface-border"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
            </svg>
          </button>
          <WorkspaceSwitcher />
        </div>
        <GlobalControls />
      </div>

      <TransportBar
        onAddTrack={handleAddTrack}
        onAddEmptyTrack={addEmptyTrack}
        onExportMix={() => { setExportFormat('wav'); setExportOpen(true) }}
        onExportPDF={() => setPdfOpen(true)}
        onNewSession={handleNewSession}
        onOpen={openSession}
        onImport={() => setImportOpen(true)}
        onSave={saveSession}
        onSaveAs={saveAsProject}
        onRevertBackup={revertToBackup}
        onCollect={handleCollect}
        onExportZip={handleExportZip}
        onRebuildWaveforms={handleRebuildWaveforms}
        onExportWaveformData={handleExportWaveformData}
        onOpenRecent={openRecentSession}
        onFitToWindow={() => fitToWindowRef.current?.()}
        onFocusPlayhead={() => focusPlayheadRef.current?.()}
        onZoomIn={() => zoomByRef.current?.(1.25)}
        onZoomOut={() => zoomByRef.current?.(1 / 1.25)}
        libraryOpen={libraryDockOpen}
        onToggleLibrary={() => setLibraryDockOpen((v) => !v)}
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

      {/* Timeline + master channel side-by-side. Mix opens straight into an empty
          session (no welcome splash) — see the auto-init effect above. */}
      <div className="relative flex overflow-hidden flex-1 min-h-0">
        <Timeline fitToWindowRef={fitToWindowRef} scrollToPlayheadRef={scrollToPlayheadRef} focusPlayheadRef={focusPlayheadRef} zoomByRef={zoomByRef} />
        {!libraryDockOpen && <MasterChannel />}
        <LibraryDock open={libraryDockOpen} onOpenChange={setLibraryDockOpen} />
        <PropertiesPanel />
      </div>

      <BottomTransport />

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

      {saveGuard && (
        <div
          className="flex fixed inset-0 z-[70] justify-center items-center bg-black/60"
          onClick={() => setSaveGuard(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col gap-3 p-5 w-96 rounded-lg border shadow-xl border-surface-border bg-surface-panel"
          >
            <span className="text-sm font-medium text-gray-200">Save over the existing mix?</span>
            <p className="text-[12px] leading-relaxed text-gray-400">
              This session has <span className="text-red-300">{saveGuard.message}</span>. Saving now
              will overwrite the file with that degraded state. A timestamped backup is kept either
              way, but you may prefer to fix the clips first (missing files heal automatically once
              relinked).
            </p>
            <div className="flex gap-2 justify-end mt-1">
              <button
                type="button"
                onClick={() => setSaveGuard(null)}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { setSaveGuard(null); void writeSessionToDisk() }}
                className="px-3 py-1.5 text-xs rounded border border-red-400/60 text-red-300 hover:bg-red-400/10 transition-colors"
              >
                Save anyway
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer />

    </div>
  )
}
