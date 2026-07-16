import { useEffect, useCallback, useRef, useState } from 'react'
import libraryLogo from './assets/libraryLogo.png'
import { useLibraryStore } from './store/libraryStore'
import { FolderPanel } from './components/FolderPanel'
import { FileList } from './components/FileList'
import { PropertiesPanel } from './components/PropertiesPanel'
import { IndexingLog } from './components/IndexingLog'
import { SyncLog } from './components/SyncLog'
import { AccountButton } from './components/AccountButton'
import { MissingTrackPanel } from './components/MissingTrackPanel'
import { PlaylistPanel } from './components/PlaylistPanel'
import { PlaylistTrackSearch } from './components/PlaylistTrackSearch'
import { MixPanel } from './components/MixPanel'
import { GuidedTour } from './components/GuidedTour'
import { PlayerBar } from './components/PlayerBar'
import { MixMiniPlayer } from './components/MixMiniPlayer'
import { SettingsPanel } from './components/SettingsPanel'
import { ReindexDialog } from './components/ReindexDialog'
import { WhatsNewModal } from './components/WhatsNewModal'
import { loadSettings, saveSettings, applySettings } from './lib/settings'
import type { AppSettings } from './lib/settings'
import { syncLibraryToMfb } from './lib/syncLibrary'
import { runMfbRefresh, cancelMfbRefresh } from './lib/mfbSync'
import { runCueScan } from './lib/cueScan'
import { runFeatureScan, cancelFeatureScan } from './lib/featureScan'
import { useUpdaterStore } from './store/updaterStore'
import { useUIStore } from '../uiStore'
import { WorkspaceSwitcher } from '../WorkspaceSwitcher'


// The umbrella mounts/unmounts this app when switching surfaces. Guard once-per-run
// effects with module-level flags so they don't re-fire every time you re-enter Library.
let whatsNewChecked = false

export default function App(): JSX.Element {
  const { setDownloading, setReady } = useUpdaterStore()
  const goHome = useUIStore((s) => s.setSurface)

  useEffect(() => {
    return window.electronAPI.onUpdateDownloading((percent) => setDownloading(percent))
  }, [setDownloading])

  useEffect(() => {
    return window.electronAPI.onUpdateDownloaded((version) => setReady(version))
  }, [setReady])

  const watchedFolders = useLibraryStore((s) => s.watchedFolders)
  const selectedFileId = useLibraryStore((s) => s.selectedFileId)
  const selectedMissingTrackId = useLibraryStore((s) => s.selectedMissingTrackId)
  const selectedPlaylistId = useLibraryStore((s) => s.selectedPlaylistId)
  const playlistTrackQuery = useLibraryStore((s) => s.playlistTrackQuery)
  const mixMode = useLibraryStore((s) => s.mixMode)
  const loadCatalogue = useLibraryStore((s) => s.loadCatalogue)
  const addWatchedFolder = useLibraryStore((s) => s.addWatchedFolder)
  const addFiles = useLibraryStore((s) => s.addFiles)
  const setScanning = useLibraryStore((s) => s.setScanning)
  const selectFolder = useLibraryStore((s) => s.selectFolder)

  const pendingMatches = useLibraryStore((s) => s.pendingMatches)
  const pendingCount = Object.keys(pendingMatches).length
  const applyAllPendingMatches = useLibraryStore((s) => s.applyAllPendingMatches)
  const resetUnmatchedIndexing = useLibraryStore((s) => s.resetUnmatchedIndexing)
  const resetAllIndexing = useLibraryStore((s) => s.resetAllIndexing)
  const [showReindexDialog, setShowReindexDialog] = useState(false)
  const userAccount = useLibraryStore((s) => s.userAccount)

  const featureScan = useLibraryStore((s) => s.featureScan)
  const mfbRefresh = useLibraryStore((s) => s.mfbRefresh)
  // The two halves of a full audio-features rescan (MFB resync + Reccobeats scan).
  const rescanBusy = featureScan.running || mfbRefresh.running
  const [indexing, setIndexing] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [showSyncLog, setShowSyncLog] = useState(false)
  const selectFile = useLibraryStore((s) => s.selectFile)
  const indexTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = useRef(false)
  const catalogueLoadedRef = useRef(false)
  const hadUserRef = useRef(false)

  const BATCH_SIZE = 50
  const BATCH_DELAY_MS = 1500

  const scheduleNextRef = useRef<(delay?: number) => void>()

  scheduleNextRef.current = (delay = BATCH_DELAY_MS) => {
    if (cancelledRef.current) return
    if (indexTimerRef.current) clearTimeout(indexTimerRef.current)
    indexTimerRef.current = setTimeout(async () => {
      if (cancelledRef.current) return
      if (!useLibraryStore.getState().userAccount) { setIndexing(false); return }
      const state = useLibraryStore.getState()
      const batch = state.files.filter((f) => !f.mfbIndexed && !f.mfbMatchRejected && !state.pendingMatches[f.id]).slice(0, BATCH_SIZE)
      if (batch.length === 0) { setIndexing(false); window.electronAPI.mfbClearCatalogue(); return }

      setIndexing(true)
      const entries = batch.map((f) => ({
        id: f.id,
        filename: f.fileName,
        artist: f.artist,
        folder_artist: f.artistPathGuess,
        folder_album: f.albumPathGuess,
      }))

      try {
        console.log('[mfb:match] sending batch', entries.map((e) => e.filename))
        const results = await window.electronAPI.mfbMatchTracks(entries)
        console.log('[mfb:match] results', results)
        if (!cancelledRef.current) {
          const store = useLibraryStore.getState()
          for (const r of results) {
            if (r.track) {
              console.log('[mfb:match] matched', r.id, '→', r.track.title, `(confidence: ${r.confidence})`)
              store.setPendingMatch(r.id, r.track)
            } else {
              const entry = entries.find((e) => e.id === r.id)
              console.log('[mfb:match] no match', entry?.filename ?? r.id, `(confidence: ${r.confidence})`)
            }
            store.updateFile(r.id, { mfbIndexed: true })
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg === 'NOT_AUTHENTICATED') {
          console.warn('[mfb:match] not authenticated — indexing stopped')
          cancelledRef.current = true
          return
        }
        console.error('[mfb:match] error', err)
        if (!cancelledRef.current) {
          for (const f of batch) useLibraryStore.getState().updateFile(f.id, { mfbIndexed: true })
        }
      }

      if (!cancelledRef.current) scheduleNextRef.current?.(BATCH_DELAY_MS)
    }, delay)
  }

  const cancelIndexing = useCallback(() => {
    cancelledRef.current = true
    if (indexTimerRef.current) clearTimeout(indexTimerRef.current)
    setIndexing(false)
  }, [])

  const startIndexing = useCallback(() => {
    if (!useLibraryStore.getState().userAccount) return
    cancelledRef.current = false
    const hasUnindexed = useLibraryStore.getState().files.some((f) => !f.mfbIndexed)
    if (hasUnindexed) { setIndexing(true); scheduleNextRef.current?.(1000) }
  }, [])

  useEffect(() => {
    const state = useLibraryStore.getState()
    const unindexed = state.files.some((f) => !f.mfbIndexed)
    if (unindexed && state.userAccount) { setIndexing(true); scheduleNextRef.current?.(3000) }
    return () => { if (indexTimerRef.current) clearTimeout(indexTimerRef.current) }
  }, [])

  // Restart indexer when new files are added
  useEffect(() => {
    return useLibraryStore.subscribe((state, prev) => {
      if (state.files.length > prev.files.length) {
        const hasNew = state.files.some((f) => !f.mfbIndexed)
        if (hasNew && !cancelledRef.current && state.userAccount) { setIndexing(true); scheduleNextRef.current?.(5000) }
        // Auto-Mix cue analysis runs regardless of auth (local ffmpeg only).
        if (state.files.some((f) => !f.cuesAnalyzed)) runCueScan()
        // Estimate audio features for any file still lacking them (Reccobeats).
        if (state.files.some((f) => !f.audioFeatures && !f.featuresAnalyzed)) runFeatureScan()
      }
    })
  }, [])

  // Start/cancel matching when account state changes
  useEffect(() => {
    if (userAccount) {
      hadUserRef.current = true
      // Reset unmatched files so they get a fresh attempt now that we're logged in
      resetUnmatchedIndexing()
      startIndexing()
    } else if (hadUserRef.current) {
      cancelIndexing()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userAccount])

  const [restoredFromBackup, setRestoredFromBackup] = useState(false)
  const loginFlash = useLibraryStore((s) => s.loginFlash)
  const setLoginFlash = useLibraryStore((s) => s.setLoginFlash)
  const [catalogueLoaded, setCatalogueLoaded] = useState(false)

  // Sync library to MFB once per session — fires when both auth and catalogue are ready.
  // Covers app open (session restore) and fresh login.
  const syncReadyRef = useRef(false)
  useEffect(() => {
    if (userAccount && catalogueLoaded && !syncReadyRef.current) {
      syncReadyRef.current = true
      syncLibraryToMfb()
      // Silently resync audio features + system tags for matched tracks against
      // the live MFB catalogue. Deferred so it doesn't compete with the initial
      // match/index pass for the API. Self-guards on auth; runs once per session.
      setTimeout(() => { runMfbRefresh() }, 8000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userAccount, catalogueLoaded])

  // (Album art for legacy matched files is filled in per-track on demand via the
  // "Re-fetch from MFB" action — no bulk startup backfill, to avoid draining the
  // MFB API's per-user rate limit.)

  // Reset on logout so the next login triggers a fresh sync
  useEffect(() => {
    if (!userAccount) syncReadyRef.current = false
  }, [userAccount])

  // Load catalogue on mount — mark loaded before subscribing to saves
  useEffect(() => {
    window.electronAPI.loadCatalogue().then(({ data, restoredFromBackup: restored }) => {
      if (data) loadCatalogue(data)
      if (restored) setRestoredFromBackup(true)
      catalogueLoadedRef.current = true
      setCatalogueLoaded(true)
    })
  }, [loadCatalogue])

  // Kick off the Auto-Mix cue scan once the library is loaded (low priority).
  useEffect(() => {
    if (!catalogueLoaded) return
    const t = setTimeout(() => { runCueScan() }, 4000)
    return () => clearTimeout(t)
  }, [catalogueLoaded])

  // Background feature scan for non-catalogue tracks (Reccobeats). Runs after the
  // cue scan so MFB matching gets first crack at populating real audio features.
  useEffect(() => {
    if (!catalogueLoaded) return
    const t = setTimeout(() => { runFeatureScan() }, 15000)
    return () => clearTimeout(t)
  }, [catalogueLoaded])

  // Persist catalogue whenever state changes — debounced so rapid updates don't race
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    return useLibraryStore.subscribe(() => {
      if (!catalogueLoadedRef.current) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        window.electronAPI.saveCatalogue(useLibraryStore.getState().toCatalogue())
      }, 800)
    })
  }, [])

  const handleAddFolder = useCallback(async (droppedPath?: string) => {
    // Guard: some onClick handlers pass the click event as the arg — ignore
    // anything that isn't a real dropped path string.
    const dropped = typeof droppedPath === 'string' ? droppedPath : undefined
    const folderPath = dropped ?? await window.electronAPI.libraryPickFolder()
    if (!folderPath) return

    setScanning(true)
    try {
      const [folder, result] = await Promise.all([
        window.electronAPI.buildWatchedFolder(folderPath),
        window.electronAPI.scanFolder(folderPath),
      ])
      addWatchedFolder(folder)
      addFiles(result.files)
      selectFolder(null)
      if (result.errors.length > 0) {
        console.warn('[scan] errors', result.errors)
      }
    } catch (err) {
      console.error('[scan] failed to add folder', folderPath, err)
    } finally {
      setScanning(false)
    }
  }, [addWatchedFolder, addFiles, setScanning, selectFolder])

  const scanning = useLibraryStore((s) => s.scanning)

  const handleRescan = useCallback(async () => {
    const folders = useLibraryStore.getState().watchedFolders
    if (folders.length === 0) return
    setScanning(true)
    try {
      const results = await Promise.all(
        folders.map((folder) =>
          Promise.all([
            window.electronAPI.buildWatchedFolder(folder.path),
            window.electronAPI.scanFolder(folder.path),
          ])
        )
      )
      for (const [folder, result] of results) {
        addWatchedFolder(folder)
        addFiles(result.files)
        if (result.errors.length > 0) console.warn('[rescan] errors', result.errors)
      }
    } catch (err) {
      console.error('[rescan] failed', err)
    } finally {
      setScanning(false)
    }
  }, [addWatchedFolder, addFiles, setScanning])

  const hasContent = watchedFolders.length > 0

  const [showWelcome, setShowWelcome] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(loadSettings)

  // Apply settings on mount and whenever they change
  useEffect(() => { applySettings(settings) }, [settings])

  // Show What's New modal when the app version has changed since last launch.
  // In dev mode always show it so the modal is easy to iterate on.
  // On a brand-new install (tour not yet completed) silently record the version
  // instead of showing the modal — it's not an update, it's a first launch.
  useEffect(() => {
    if (whatsNewChecked) return
    whatsNewChecked = true
    if (import.meta.env.DEV) { setWhatsNewOpen(true); return }
    try {
      const key = 'limina-library-last-seen-version'
      if (!localStorage.getItem('tour-completed')) {
        localStorage.setItem(key, __APP_VERSION__)
      } else if (localStorage.getItem(key) !== __APP_VERSION__) {
        setWhatsNewOpen(true)
      }
    } catch { /* noop */ }
  }, [])

  // Stop and clear any track preview when leaving Library, so re-entering doesn't
  // auto-replay it (PlayerBar auto-plays whatever previewFileId is set on mount).
  useEffect(() => {
    return () => { useLibraryStore.getState().setPreview(null, []) }
  }, [])

  function handleSettingsChange(s: AppSettings): void {
    setSettings(s)
    saveSettings(s)
  }

  const [showBackups, setShowBackups] = useState(false)
  const [backups, setBackups] = useState<{ slot: number; mtime: string; size: number }[]>([])
  const [restoringSlot, setRestoringSlot] = useState<number | null>(null)
  const [showUtilMenu, setShowUtilMenu] = useState(false)
  const utilMenuRef = useRef<HTMLDivElement>(null)
  const [tourOpen, setTourOpen] = useState(() => {
    try { return !localStorage.getItem('tour-completed') } catch { return false }
  })
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)

  useEffect(() => {
    if (!showUtilMenu) return
    function onDown(e: MouseEvent): void {
      if (utilMenuRef.current && !utilMenuRef.current.contains(e.target as Node)) setShowUtilMenu(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [showUtilMenu])

  async function openBackups(): Promise<void> {
    const list = await window.electronAPI.listCatalogueBackups()
    setBackups(list)
    setShowBackups(true)
  }

  async function handleRestore(slot: number): Promise<void> {
    setRestoringSlot(slot)
    try {
      const catalogue = await window.electronAPI.restoreCatalogueBackup(slot)
      if (catalogue) {
        loadCatalogue(catalogue)
        catalogueLoadedRef.current = true
        setShowBackups(false)
      }
    } finally {
      setRestoringSlot(null)
    }
  }

  // Folder-action menu items, shared by the profile dropdown (signed in) and a
  // standalone dropdown (signed out). Buttons don't self-close — the containing
  // menu closes on click (onClick bubbles up to its wrapper).
  const folderActionItems = (
    <>
      <button
        data-tour="add-folder"
        type="button"
        onClick={() => handleAddFolder()}
        disabled={scanning}
        className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-gray-300 hover:bg-surface-hover hover:text-gray-100 disabled:opacity-40 transition-colors"
      >
        <svg className="w-3 h-3 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M6 2v8M2 6h8" />
        </svg>
        Add Folder
      </button>
      {hasContent && (
        <button
          type="button"
          onClick={() => handleRescan()}
          disabled={scanning}
          className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-gray-300 hover:bg-surface-hover hover:text-gray-100 disabled:opacity-40 transition-colors"
        >
          <svg className="w-3 h-3 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.5 6A4.5 4.5 0 1 1 6 1.5" />
            <path d="M6 1.5l2.5-1M6 1.5l1 2.5" />
          </svg>
          Rescan Folders
        </button>
      )}
      {hasContent && (
        <button
          data-tour="re-index"
          type="button"
          onClick={() => setShowReindexDialog(true)}
          className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-gray-300 hover:bg-surface-hover hover:text-gray-100 transition-colors"
        >
          <svg className="w-3 h-3 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="6" r="2" />
            <path d="M6 1v1.5M6 9.5V11M1 6h1.5M9.5 6H11" />
            <path d="M2.6 2.6l1.1 1.1M8.3 8.3l1.1 1.1M9.4 2.6L8.3 3.7M3.7 8.3L2.6 9.4" />
          </svg>
          Re-index
        </button>
      )}
      {hasContent && (
        <button
          type="button"
          onClick={() => {
            // Treat the two halves as one operation: if either is already
            // running, this is a Stop (cancel both) — never stack a second pass.
            if (rescanBusy) { cancelFeatureScan(); cancelMfbRefresh(); return }
            // Rescan the whole library: pull fresh features (+ tags) from MFB for
            // every matched track (force, not just the changed ones), and estimate
            // features via Reccobeats for the rest.
            runMfbRefresh({ force: true })
            runFeatureScan({ force: true })
          }}
          className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-gray-300 hover:bg-surface-hover hover:text-gray-100 transition-colors"
          title={rescanBusy ? 'Stop the audio-features rescan' : 'Refresh audio features for the whole library — from MFB for matched tracks, and a Reccobeats estimate (30s clip) for non-catalogue tracks'}
        >
          {rescanBusy ? (
            <svg className="w-3 h-3 shrink-0" viewBox="0 0 12 12" fill="currentColor"><rect x="3" y="3" width="6" height="6" rx="1" /></svg>
          ) : (
            <svg className="w-3 h-3 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <path d="M1 6h1.5M9.5 6H11M3.5 3.5v5M6 1.5v9M8.5 3.5v5" />
            </svg>
          )}
          {rescanBusy ? `Stop rescan… ${featureScan.done + mfbRefresh.done}/${featureScan.total + mfbRefresh.total}` : 'Rescan Audio Features'}
        </button>
      )}
      <div className="my-1 border-t border-surface-border" />
      <button
        type="button"
        onClick={() => openBackups()}
        className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-gray-300 hover:bg-surface-hover hover:text-gray-100 transition-colors"
      >
        <svg className="w-3 h-3 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1.5 6a4.5 4.5 0 1 0 1.3-3" />
          <path d="M1.5 3V6H4.5" />
        </svg>
        Restore Backup
      </button>
    </>
  )

  return (
    <div className="flex flex-col h-full text-gray-200 bg-surface-base">
      {/* macOS traffic-light drag region */}
      <div
        className="h-7 shrink-0 bg-surface-panel"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* Login success flash */}
      {loginFlash && userAccount && (
        <LoginFlash name={userAccount.name} onDismiss={() => setLoginFlash(false)} />
      )}

      {/* Backup restore banner */}
      {restoredFromBackup && (
        <div className="flex items-center justify-between px-4 py-2 bg-accent/15 border-b border-accent/30 text-[11px] text-accent shrink-0">
          <span>Your library was restored from a backup — everything should be back to normal.</span>
          <button
            type="button"
            onClick={() => setRestoredFromBackup(false)}
            className="ml-4 transition-opacity opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2l6 6M8 2l-6 6" />
            </svg>
          </button>
        </div>
      )}

      {/* Top bar */}
      <div className="flex items-center justify-between h-10 px-4 border-b shrink-0 bg-surface-panel border-surface-border">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => goHome('home')}
            title="Back to Home"
            className="flex items-center justify-center w-6 h-6 text-gray-400 transition-colors border rounded bg-surface-hover hover:bg-surface-border border-surface-border"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
            </svg>
          </button>
          <span className="text-gray-600 select-none">›</span>
          <WorkspaceSwitcher />
        </div>
        <div className="flex items-center gap-2">
          <MixMiniPlayer />
          {indexing && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowLog(true)}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                title="View indexing log"
              >
                <svg className="w-2.5 h-2.5 animate-spin text-gray-600" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M6 1v2M6 9v2M1 6h2M9 6h2" strokeLinecap="round" />
                  <path d="M2.5 2.5l1.4 1.4M8.1 8.1l1.4 1.4M9.5 2.5L8.1 3.9M3.9 8.1L2.5 9.5" strokeLinecap="round" opacity="0.4" />
                </svg>
                <span className="text-[10px] text-gray-600">Indexing</span>
              </button>
              <span className="text-[10px] text-gray-700">·</span>
              <button
                type="button"
                onClick={cancelIndexing}
                className="text-[10px] text-gray-600 hover:text-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
          {!indexing && mfbRefresh.running && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowSyncLog(true)}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                title="View which tracks are being synced from Music for Breathwork"
              >
                <svg className="w-2.5 h-2.5 animate-spin text-gray-600" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M6 1v2M6 9v2M1 6h2M9 6h2" strokeLinecap="round" />
                  <path d="M2.5 2.5l1.4 1.4M8.1 8.1l1.4 1.4M9.5 2.5L8.1 3.9M3.9 8.1L2.5 9.5" strokeLinecap="round" opacity="0.4" />
                </svg>
                <span className="text-[10px] text-gray-600">Syncing{mfbRefresh.total > 0 ? ` ${mfbRefresh.done}/${mfbRefresh.total}` : ''}</span>
              </button>
              <span className="text-[10px] text-gray-700">·</span>
              <button
                type="button"
                onClick={() => cancelMfbRefresh()}
                className="text-[10px] text-gray-600 hover:text-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
          {/* Folder-actions dropdown — only when signed out; when signed in these
              items live in the profile dropdown (AccountButton). */}
          {!userAccount && (
            <div className="relative" ref={utilMenuRef}>
              <button
                type="button"
                onClick={() => setShowUtilMenu((v) => !v)}
                title="Actions"
                className="flex justify-center items-center px-4 h-6 text-gray-300 rounded border transition-colors bg-surface-hover hover:bg-surface-border border-surface-border text-[10px]"
              >
                Folder Actions
                <svg className="w-2.5 h-2.5 ml-1" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2 3.5l3 3 3-3" />
                </svg>
              </button>
              {showUtilMenu && (
                <div onClick={() => setShowUtilMenu(false)} className="absolute right-0 top-8 z-50 min-w-[160px] rounded border border-surface-border bg-surface-panel shadow-lg py-1 text-[11px]">
                  {folderActionItems}
                </div>
              )}
            </div>
          )}
          <AccountButton
            menuItems={folderActionItems}
            pendingCount={pendingCount}
            onApplyPending={() => { applyAllPendingMatches(); syncLibraryToMfb() }}
          />
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            title="Settings"
            className="flex items-center justify-center w-6 h-6 text-gray-400 transition-colors border rounded bg-surface-hover hover:bg-surface-border border-surface-border"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="7" r="1.75" />
              <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.93 2.93l1.06 1.06M10.01 10.01l1.06 1.06M10.01 3.99l1.06-1.06M3.99 10.01l-1.06 1.06" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setTourOpen(true)}
            title="Start guided tour"
            className="flex items-center justify-center w-6 h-6 text-xs text-gray-300 transition-colors border rounded bg-surface-hover hover:bg-surface-border border-surface-border"
          >
            ?
          </button>
        </div>
      </div>

      {showBackups && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowBackups(false)}>
          <div className="flex flex-col gap-3 p-4 border rounded-lg shadow-xl w-80 border-surface-border bg-surface-panel" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-gray-200 uppercase tracking-wider">Restore from Backup</span>
              <button type="button" onClick={() => setShowBackups(false)} className="text-gray-600 transition-colors hover:text-gray-400">
                <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </button>
            </div>
            {backups.length === 0 ? (
              <p className="text-[11px] text-gray-500 py-2 text-center">No backups found</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {backups.map((b) => {
                  const d = new Date(b.mtime)
                  const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                  const kb = (b.size / 1024).toFixed(0)
                  return (
                    <div key={b.slot} className="flex items-center justify-between gap-2 px-2.5 py-2 rounded border border-surface-border bg-surface-hover">
                      <div className="flex flex-col min-w-0">
                        <span className="text-[11px] text-gray-300">{label}</span>
                        <span className="text-[10px] text-gray-600">{kb} KB · backup {b.slot}</span>
                      </div>
                      <button
                        type="button"
                        disabled={restoringSlot === b.slot}
                        onClick={() => handleRestore(b.slot)}
                        className="shrink-0 px-2.5 py-1 text-[10px] rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-40"
                      >
                        {restoringSlot === b.slot ? 'Restoring…' : 'Restore'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            <p className="text-[10px] text-gray-600 leading-relaxed">
              Backups are created automatically each time the app starts with saved data.
            </p>
          </div>
        </div>
      )}

      {showLog && (
        <IndexingLog
          onClose={() => setShowLog(false)}
          onSelectFile={(id) => { selectFile(id); setShowLog(false) }}
        />
      )}

      {showSyncLog && (
        <SyncLog
          onClose={() => setShowSyncLog(false)}
          onSelectFile={(id) => { selectFile(id); setShowSyncLog(false) }}
        />
      )}

      {showReindexDialog && (
        <ReindexDialog
          onClose={() => setShowReindexDialog(false)}
          onConfirm={(mode) => {
            setShowReindexDialog(false)
            if (mode === 'all') resetAllIndexing()
            else resetUnmatchedIndexing()
            startIndexing()
          }}
        />
      )}

      {!catalogueLoaded ? null : hasContent && !showWelcome ? (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex flex-1 min-h-0">
            {!mixMode && <FolderPanel onAddFolder={handleAddFolder} onRescan={handleRescan} />}
            <div className="flex flex-1 min-w-0 min-h-0">
              {mixMode ? <MixPanel /> : playlistTrackQuery ? <PlaylistTrackSearch /> : selectedPlaylistId !== null ? <PlaylistPanel /> : <FileList />}
              {!mixMode && (selectedFileId || selectedMissingTrackId) && (
                <div className="border-l w-96 shrink-0 border-surface-border">
                  {selectedFileId ? <PropertiesPanel /> : <MissingTrackPanel key={selectedMissingTrackId} />}
                </div>
              )}
            </div>
          </div>
          <PlayerBar />
        </div>
      ) : (
        <WelcomeScreen
          onAddFolder={handleAddFolder}
          hasContent={hasContent}
          onClose={hasContent ? () => setShowWelcome(false) : undefined}
        />
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onClose={() => setShowSettings(false)}
          onChange={handleSettingsChange}
        />
      )}

      {tourOpen && (
        <GuidedTour
          onClose={() => {
            setTourOpen(false)
            try { localStorage.setItem('tour-completed', '1') } catch { /* noop */ }
          }}
        />
      )}

      <WhatsNewModal
        open={whatsNewOpen}
        onClose={() => {
          try { localStorage.setItem('limina-library-last-seen-version', __APP_VERSION__) } catch { /* noop */ }
          setWhatsNewOpen(false)
        }}
      />
    </div>
  )
}

function LoginFlash({ name, onDismiss }: { name: string; onDismiss: () => void }): JSX.Element {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-accent/15 border-b border-accent/30 text-[11px] text-accent shrink-0">
      <span>Signed in as {name}</span>
      <button type="button" onClick={onDismiss} className="ml-4 transition-opacity opacity-60 hover:opacity-100" aria-label="Dismiss">
        <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 2l6 6M8 2l-6 6" />
        </svg>
      </button>
    </div>
  )
}

function WelcomeScreen({ onAddFolder, hasContent, onClose }: {
  onAddFolder: () => void
  hasContent: boolean
  onClose?: () => void
}): JSX.Element {
  const features = [
    {
      icon: <path d="M3 7a2 2 0 012-2h3l2 2h9a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />,
      label: 'Local Library',
      desc: 'Scan folders on disk and catalogue every audio file automatically.',
    },
    {
      icon: <><circle cx="12" cy="12" r="3" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M17.66 6.34l-1.41 1.41M6.34 17.66l-1.41 1.41" /></>,
      label: 'Catalogue Matching',
      desc: 'Automatically matches files to the Music for Breathwork catalogue and enriches them with artist info, audio features, and breathwork tags.',
    },
    {
      icon: <><path d="M9 19V6l12-3v13" /><circle cx="6" cy="19" r="3" /><circle cx="18" cy="16" r="3" /></>,
      label: 'Playlists',
      desc: 'Sign in to sync your Music for Breathwork playlists and see which tracks you own.',
    },
    {
      icon: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>,
      label: 'Drag to Studio',
      desc: 'Drag any track directly into Limina Studio to add it to a mix.',
    },
  ]

  return (
    <div className="flex flex-col flex-1 overflow-y-auto">
      <div className="flex flex-col items-center w-full max-w-xl gap-8 px-8 py-12 mx-auto">

        {/* Close button when shown as overlay */}
        {onClose && (
          <div className="self-end">
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              ← Back to library
            </button>
          </div>
        )}

        {/* Identity */}
        <div className="flex flex-col items-center gap-3 text-center">
          <img src={libraryLogo} alt="Limina Library" className="object-contain w-40 h-40 rounded-2xl" />
          <div>
            <h1 className="text-base font-semibold tracking-wide text-gray-100">Limina Library</h1>
            <p className="text-[11px] text-gray-500 mt-0.5">v{__APP_VERSION__} · Companion app for Music for Breathwork</p>
          </div>
          <p className="max-w-sm text-xs leading-relaxed text-gray-400">
            Organise your local audio files, match them to the Music for Breathwork catalogue,
            and prepare sessions for Limina Studio. <br />All in one place.
          </p>
        </div>

        {/* Features */}
        <div className="flex flex-col w-full gap-3">
          {features.map((f) => (
            <div key={f.label} className="flex flex-col gap-1.5 p-3 rounded-lg border border-surface-border bg-surface-panel">
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-accent shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  {f.icon}
                </svg>
                <span className="text-[11px] font-medium text-gray-200">{f.label}</span>
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* CTA */}
        {!hasContent && (
          <button
            onClick={onAddFolder}
            className="flex items-center gap-2 px-5 py-2 text-xs font-medium text-white transition-colors rounded bg-accent hover:bg-accent/80"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M6 2v8M2 6h8" />
            </svg>
            Add your first folder
          </button>
        )}

        {/* Footer */}
        <div className="flex flex-col items-center w-full gap-2 pt-6 text-center border-t border-surface-border">
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => window.open('https://musicforbreathwork.com', '_blank')}
              className="text-[10px] text-gray-500 hover:text-accent transition-colors"
            >
              musicforbreathwork.com
            </button>
            <button
              type="button"
              onClick={() => window.open('https://getliminastudio.com', '_blank')}
              className="text-[10px] text-gray-500 hover:text-accent transition-colors"
            >
              getliminastudio.com
            </button>
          </div>
          <p className="text-[10px] text-gray-600">© {new Date().getFullYear()} Limina · All rights reserved</p>
        </div>
      </div>
    </div>
  )
}
