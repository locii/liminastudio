import { useEffect, useMemo, useRef, useState, useCallback, memo } from 'react'
import { useLibraryStore } from '../store/libraryStore'
import { MixVisualizer, MixVizCanvas } from './MixVisualizer'
import { MixCueEditorModal } from './MixCueEditorModal'
import { SessionsModal } from './SessionsModal'
import { SaveSessionModal } from './SaveSessionModal'
import { PropertiesPanel } from './PropertiesPanel'
import { GuidedTour } from './GuidedTour'
import { SESSION_STEPS, PRO_TOUR_STEP_IDS } from './sessionTourSteps'
import { startRecording, stopRecording, cancelRecording } from '../lib/sessionRecorder'
import { getMixEngine } from '../lib/mixEngineSingleton'
import { feelScore, materializeGroup, getGenStart } from '../lib/mixSelection'
import type { MixEngine } from '../lib/mixEngine'
import type { LibraryFile } from '../types'
import type { MixQueueItem } from '../store/libraryStore'

// Where the Pro upsell (locked Session Mode features) sends free users.
const PRO_UPSELL_URL = 'https://musicforbreathwork.com/pricing'

// MFB user ids allowed to author/manage system presets. Mirrors
// SessionPresetController::ADMIN_IDS on the MFB API (writes are enforced there).
const PRESET_ADMIN_IDS = [1, 117]

export const MIX_TAG_DND_TYPE = 'application/x-limina-tag'
export const MIX_TRACK_DND_TYPE = 'application/x-limina-mix-track'
export const MIX_QUEUE_DND_TYPE = 'application/x-limina-mix-queue'
// Marks a drag that originated from a tag-generator's upcoming list, carrying the
// generator's item id so a play (drop on Now Playing) can consume it from there.
export const MIX_UPCOMING_ITEM_DND = 'application/x-limina-mix-upcoming-item'

// Curated MFB audio features exposed as the 4-band "feel" EQ (all 0–1 scaled).
// Colours match the Music for Breathwork phase-analysis chart.
const MIX_FEATURES: { key: string; label: string; short: string; color: string }[] = [
  { key: 'affective_intensity', label: 'Affective Intensity', short: 'AFF', color: '#E2615C' },
  { key: 'activation_intensity', label: 'Activating Intensity', short: 'ACT', color: '#F2A65A' },
  { key: 'tension', label: 'Tension', short: 'TEN', color: '#C46BE3' },
  { key: 'spaciousness', label: 'Spaciousness', short: 'SPA', color: '#4FB0C6' },
]

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function MixPanel(): JSX.Element {
  const files = useLibraryStore((s) => s.files)
  const mixTags = useLibraryStore((s) => s.mixTags)
  const mixMatchMode = useLibraryStore((s) => s.mixMatchMode)
  const addMixTag = useLibraryStore((s) => s.addMixTag)
  const removeMixTag = useLibraryStore((s) => s.removeMixTag)
  const clearMixTags = useLibraryStore((s) => s.clearMixTags)
  const setMixMatchMode = useLibraryStore((s) => s.setMixMatchMode)
  const exitMixMode = useLibraryStore((s) => s.exitMixMode)
  const selectFile = useLibraryStore((s) => s.selectFile)
  const selectedFileId = useLibraryStore((s) => s.selectedFileId)
  const updateFile = useLibraryStore((s) => s.updateFile)
  const mixFadeIns = useLibraryStore((s) => s.mixFadeIns)
  const mixFadeMs = useLibraryStore((s) => s.mixFadeMs)
  const setMixFadeMs = useLibraryStore((s) => s.setMixFadeMs)
  const mixFeatureTargets = useLibraryStore((s) => s.mixFeatureTargets)
  const setMixFeatureTarget = useLibraryStore((s) => s.setMixFeatureTarget)
  const clearMixFeatureTargets = useLibraryStore((s) => s.clearMixFeatureTargets)
  const mixQueue = useLibraryStore((s) => s.mixQueue)
  const addQueueTrack = useLibraryStore((s) => s.addQueueTrack)
  const addQueueTags = useLibraryStore((s) => s.addQueueTags)
  const previewFileId = useLibraryStore((s) => s.previewFileId)
  const setPreview = useLibraryStore((s) => s.setPreview)
  const setQueueItemMatch = useLibraryStore((s) => s.setQueueItemMatch)
  const setQueueItemDuration = useLibraryStore((s) => s.setQueueItemDuration)
  const setQueueItemUpcoming = useLibraryStore((s) => s.setQueueItemUpcoming)
  const removeQueueItem = useLibraryStore((s) => s.removeQueueItem)
  const moveQueueItem = useLibraryStore((s) => s.moveQueueItem)
  const clearQueue = useLibraryStore((s) => s.clearQueue)
  const mixTailTags = useLibraryStore((s) => s.mixTailTags)
  const savedMixes = useLibraryStore((s) => s.savedMixes)
  const saveMix = useLibraryStore((s) => s.saveMix)
  const loadMix = useLibraryStore((s) => s.loadMix)
  const deleteMix = useLibraryStore((s) => s.deleteMix)
  const systemPresets = useLibraryStore((s) => s.systemPresets)
  const loadSystemPresets = useLibraryStore((s) => s.loadSystemPresets)
  const recording = useLibraryStore((s) => s.recording)
  const mixSessions = useLibraryStore((s) => s.mixSessions)
  const loadSession = useLibraryStore((s) => s.loadSession)
  const deleteMixSession = useLibraryStore((s) => s.deleteMixSession)
  const playlists = useLibraryStore((s) => s.playlists)
  const setPlaylists = useLibraryStore((s) => s.setPlaylists)
  const userAccount = useLibraryStore((s) => s.userAccount)

  // Pro gate for Session Mode. Playing/building a mix is free; recording,
  // templates, and loading saved sessions are Pro-only. Currently maps to being
  // signed in — swap this for the course/subscription entitlement when it lands.
  const isPro = userAccount !== null
  // Preset admins can author/manage system presets served to all users.
  // Keep in sync with SessionPresetController::ADMIN_IDS on the MFB side.
  const isAdmin = userAccount ? PRESET_ADMIN_IDS.includes(userAccount.id) : false

  const featureTargetEntries = useMemo(() => Object.entries(mixFeatureTargets), [mixFeatureTargets])

  // --- pool = "what's available" (tag filter only; feel EQ is soft) ---------
  const pool = useMemo(() => files.filter((f) => {
    if (!f.filePath) return false
    if (mixTags.length === 0) return true
    return mixMatchMode === 'all'
      ? mixTags.every((t) => f.tags.includes(t))
      : mixTags.some((t) => f.tags.includes(t))
  }), [files, mixTags, mixMatchMode])

  // --- engine (persistent singleton; live state lives in the store) --------
  const engineRef = useRef<MixEngine | null>(null)
  if (!engineRef.current) engineRef.current = getMixEngine()
  const state = useLibraryStore((s) => s.mixPlayback)

  // Keep the engine's crossfade length in sync with the slider.
  useEffect(() => {
    const e = getMixEngine()
    e.xfadeMs = mixFadeMs
    e.retimeActiveFade(mixFadeMs) // if a crossfade is in progress, re-time it live
  }, [mixFadeMs])

  // Fetch playlists here too (sidebar/FolderPanel is hidden in mix mode).
  useEffect(() => {
    if (!userAccount || playlists.length > 0) return
    window.electronAPI.getUserPlaylists().then(setPlaylists).catch(() => {})
  }, [userAccount, playlists.length, setPlaylists])

  // Curated system presets are served from MFB; fetch once signed in.
  useEffect(() => {
    if (userAccount) void loadSystemPresets()
  }, [userAccount, loadSystemPresets])

  // Live current file (engine holds a load-time snapshot; peaks load async).
  const cur = useMemo(() => {
    const id = state.current?.id
    if (!id) return null
    return files.find((f) => f.id === id) ?? state.current
  }, [files, state.current])
  const curRef = useRef<LibraryFile | null>(cur)
  curRef.current = cur

  const eng = () => engineRef.current
  const hasPool = pool.length > 0
  const canPlay = hasPool || mixQueue.length > 0

  // --- preview (fade-in point) --------------------------------------------
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = useMemo(() => (selectedId ? files.find((f) => f.id === selectedId) ?? null : null), [files, selectedId])

  // --- available pool list (searchable, lazy) ------------------------------
  const [poolQuery, setPoolQuery] = useState('')
  const filteredPool = useMemo(() => {
    const q = poolQuery.trim().toLowerCase()
    if (!q) return pool
    return pool.filter((f) => (f.trackTitle || f.fileName).toLowerCase().includes(q) || f.artist.toLowerCase().includes(q))
  }, [pool, poolQuery])
  const [visibleCount, setVisibleCount] = useState(80)
  useEffect(() => { setVisibleCount(80) }, [poolQuery, mixTags])
  // Score each track by the Feel-EQ boost/cut weights, normalise to a 0–1 bar,
  // and sort best-fit first so the EQ's effect on the pool is visible live.
  const poolScored = useMemo(() => {
    const weights = featureTargetEntries
    if (weights.length === 0) return filteredPool.map((f) => ({ file: f, feel: null as number | null }))
    const raw = filteredPool.map((f) => ({ file: f, s: feelScore(f, weights), has: !!f.audioFeatures }))
    let min = Infinity, max = -Infinity
    for (const r of raw) { if (r.s < min) min = r.s; if (r.s > max) max = r.s }
    const range = max - min || 1
    raw.sort((a, b) => b.s - a.s)
    return raw.map((r) => ({ file: r.file, feel: r.has ? (r.s - min) / range : null }))
  }, [filteredPool, featureTargetEntries])
  const visiblePool = useMemo(() => poolScored.slice(0, visibleCount), [poolScored, visibleCount])
  // Preview queue = the full filtered pool, so preview next/random stays in the pool.
  const poolIds = useMemo(() => poolScored.map((p) => p.file.id), [poolScored])
  const onPoolScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) setVisibleCount((c) => (c < filteredPool.length ? c + 80 : c))
  }, [filteredPool.length])

  // --- queue (resolve track items to files for display) --------------------
  const fileById = useMemo(() => new Map(files.map((f) => [f.id, f])), [files])

  // Pre-materialise each tag-group's upcoming list so its ghost preview shows the
  // real next tracks (same order playback will use), before it's even reached.
  useEffect(() => {
    for (const item of mixQueue) {
      if (item.kind === 'tags' && item.upcoming.length === 0) {
        const ids = materializeGroup(item.tags, item.matchMode, item.feel, 10, new Set(useLibraryStore.getState().playedIds))
        if (ids.length > 0) setQueueItemUpcoming(item.id, ids)
      }
    }
  }, [mixQueue, files, setQueueItemUpcoming])

  // Ghost preview = the full materialised upcoming list (in the order playback uses).
  const tagPreviews = useMemo(() => {
    const m = new Map<string, { count: number; tracks: LibraryFile[] }>()
    for (const item of mixQueue) {
      if (item.kind !== 'tags') continue
      const count = files.filter((f) => f.filePath && (item.tags.length === 0
        ? true
        : item.matchMode === 'all' ? item.tags.every((t) => f.tags.includes(t)) : item.tags.some((t) => f.tags.includes(t)))).length
      const tracks = item.upcoming.map((id) => files.find((f) => f.id === id)).filter((f): f is LibraryFile => !!f)
      m.set(item.id, { count, tracks })
    }
    return m
  }, [mixQueue, files])

  // Materialise the next batch of upcoming tracks for a tag-generator (Show more).
  const showMoreUpcoming = useCallback((itemId: string) => {
    const st = useLibraryStore.getState()
    const item = st.mixQueue.find((q) => q.id === itemId)
    if (!item || item.kind !== 'tags') return
    const more = materializeGroup(item.tags, item.matchMode, item.feel, 10, new Set([...item.upcoming, ...st.playedIds]))
    if (more.length > 0) st.setQueueItemUpcoming(itemId, [...item.upcoming, ...more])
  }, [])

  // Shuffle a tag-generator's upcoming list — playback follows this order.
  const shuffleUpcoming = useCallback((itemId: string) => {
    const st = useLibraryStore.getState()
    const item = st.mixQueue.find((q) => q.id === itemId)
    if (!item || item.kind !== 'tags') return
    const ids = [...item.upcoming]
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]] }
    st.setQueueItemUpcoming(itemId, ids)
  }, [])

  // Drag-reorder one track within a tag-generator's upcoming list.
  const reorderUpcoming = useCallback((itemId: string, fromId: string, toId: string) => {
    const st = useLibraryStore.getState()
    const item = st.mixQueue.find((q) => q.id === itemId)
    if (!item || item.kind !== 'tags') return
    const ids = [...item.upcoming]
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(toId)
    if (from < 0 || to < 0 || from === to) return
    const [m] = ids.splice(from, 1)
    ids.splice(to, 0, m)
    st.setQueueItemUpcoming(itemId, ids)
  }, [])

  const playQueueItem = useCallback((item: MixQueueItem) => {
    const st = useLibraryStore.getState()
    if (item.kind === 'track') {
      const f = st.files.find((x) => x.id === item.fileId)
      if (f) {
        engineRef.current?.fadeTo(f)
        st.dropQueueBefore(item.id) // skip ahead — discard everything queued before it
        st.removeQueueItem(item.id) // then consume it (now playing)
      }
    } else {
      // Start this generator off: make it the queue front + the tail, and play
      // the head of its materialised list (so it matches the ghost preview).
      st.setMixTailTags(item.tags)
      st.dropQueueBefore(item.id)
      const curId = engineRef.current?.currentFile?.id ?? null
      const up = item.upcoming.filter((id) => id !== curId)
      const nextId = up[0]
      const f = nextId ? st.files.find((x) => x.id === nextId) : null
      if (f) {
        engineRef.current?.fadeTo(f)
        st.setQueueItemUpcoming(item.id, up.slice(1))
      }
    }
  }, [])
  // Play a track picked from a tag-generator's upcoming list and consume it from
  // that generator (it's been played, so it shouldn't come round again).
  const consumeFromUpcoming = useCallback((itemId: string, fileId: string) => {
    const st = useLibraryStore.getState()
    const item = st.mixQueue.find((q) => q.id === itemId)
    if (item && item.kind === 'tags') st.setQueueItemUpcoming(itemId, item.upcoming.filter((x) => x !== fileId))
  }, [])
  const playUpcomingTrack = useCallback((itemId: string, f: LibraryFile) => {
    consumeFromUpcoming(itemId, f.id)
    engineRef.current?.fadeTo(f)
  }, [consumeFromUpcoming])
  // Inline name entry for saving (Electron blocks window.prompt).
  const [savingName, setSavingName] = useState<string | null>(null)
  const confirmSave = useCallback(() => {
    const name = (savingName ?? '').trim()
    if (name) saveMix(name)
    setSavingName(null)
  }, [savingName, saveMix])
  // Admin (user 1): publish the current queue as a system preset straight to MFB,
  // so it's live for every user with no app release. Only portable tag-generator
  // items are kept — local `track` items reference a machine-local file id.
  const [savingPresetName, setSavingPresetName] = useState<string | null>(null)
  const [presetSaving, setPresetSaving] = useState(false)
  const confirmSavePreset = useCallback(async () => {
    const name = (savingPresetName ?? '').trim()
    if (!name) { setSavingPresetName(null); return }
    const st = useLibraryStore.getState()
    const queue = st.mixQueue
      .filter((q) => q.kind === 'tags')
      .map((q, i) => ({ ...q, id: `sys_item_${i}`, upcoming: [] as string[] }))
    const payload = {
      queue, mixTags: st.mixTags, mixMatchMode: st.mixMatchMode,
      mixFeatureTargets: st.mixFeatureTargets, mixFadeMs: st.mixFadeMs, mixTailTags: st.mixTailTags,
    }
    setSavingPresetName(null)
    setPresetSaving(true)
    try {
      await window.electronAPI.saveSystemPreset({ name, payload })
      await loadSystemPresets()
    } catch (e) {
      console.error('[saveSystemPreset] failed', e)
    } finally {
      setPresetSaving(false)
    }
  }, [savingPresetName, loadSystemPresets])
  // Guided tour for Session Mode — auto-shown on first entry, replayable via the ? button.
  // Free users skip the Pro-only steps (record, load, templates, export).
  const tourSteps = useMemo(
    () => isPro ? SESSION_STEPS : SESSION_STEPS.filter((s) => !PRO_TOUR_STEP_IDS.has(s.id)),
    [isPro]
  )
  const [tourOpen, setTourOpen] = useState(false)
  // Pro upsell prompt (shown when a free user taps a locked feature).
  const [upsellOpen, setUpsellOpen] = useState(false)
  useEffect(() => {
    try {
      if (!localStorage.getItem('session-tour-completed')) setTourOpen(true)
    } catch { /* noop */ }
  }, [])
  const closeTour = useCallback(() => {
    setTourOpen(false)
    try { localStorage.setItem('session-tour-completed', '1') } catch { /* noop */ }
  }, [])

  // Session recording: save-prompt modal, sessions viewer, and a 1s elapsed tick.
  const [savePromptOpen, setSavePromptOpen] = useState(false)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [sessionsInitialId, setSessionsInitialId] = useState<string | null>(null)
  const [, setRecTick] = useState(0)

  // Ellipsis menu (export tracklist / open recorded sessions).
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exportCopied, setExportCopied] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!exportMenuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setExportMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [exportMenuOpen])
  // Export the current session plan (now playing + up next) as plain text.
  const copyCurrentTracklist = useCallback(async () => {
    const st = useLibraryStore.getState()
    const byId = new Map(st.files.map((f) => [f.id, f]))
    const label = (f: LibraryFile | undefined): string =>
      f ? `${f.trackTitle || f.fileName}${f.artist ? ` — ${f.artist}` : ''}` : '(missing track)'
    const lines: string[] = ['Session tracklist', '']
    const curId = st.mixPlayback.current?.id
    if (curId) lines.push(`▶ ${label(byId.get(curId))}`)
    for (const item of st.mixQueue) {
      if (item.kind === 'track') lines.push(label(byId.get(item.fileId)))
      else {
        lines.push(`[${item.tags.join(', ') || 'any'}]${item.durationMin ? ` · ${item.durationMin}m` : ''}`)
        for (const id of item.upcoming) lines.push(`  ${label(byId.get(id))}`)
      }
    }
    lines.push('', `then: ${st.mixTailTags ? `random from ${st.mixTailTags.join(', ')}` : 'random from pool'}`)
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setExportCopied(true)
      setTimeout(() => setExportCopied(false), 1500)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    if (!recording) return
    const id = window.setInterval(() => setRecTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [recording])
  // Finish recording: persist the session, then reveal it in the sessions modal.
  const handleSaveSession = useCallback((name: string) => {
    const saved = stopRecording(name)
    setSavePromptOpen(false)
    if (saved) { setSessionsInitialId(saved.id); setSessionsOpen(true) }
  }, [])
  const handleDiscardSession = useCallback(() => {
    cancelRecording()
    setSavePromptOpen(false)
  }, [])
  const openRecordedSessions = useCallback(() => {
    setSessionsInitialId(null)
    setSessionsOpen(true)
  }, [])
  // Double-click a tag in the picker: add it as a generator at the front and fade in.
  const startTagNow = useCallback((tag: string) => {
    const st = useLibraryStore.getState()
    st.addQueueTagsFront([tag], st.mixMatchMode, st.mixFeatureTargets)
    const item = useLibraryStore.getState().mixQueue[0]
    if (item && item.kind === 'tags') playQueueItem(item)
  }, [playQueueItem])

  // --- tag picker ----------------------------------------------------------
  const allTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of files) for (const t of f.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [files])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [featOpen, setFeatOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState('')

  // --- tag drop zone -------------------------------------------------------
  const [dragOver, setDragOver] = useState(false)
  const onTagDrop = useCallback((e: React.DragEvent): void => {
    e.preventDefault(); setDragOver(false)
    const tag = e.dataTransfer.getData(MIX_TAG_DND_TYPE) || e.dataTransfer.getData('text/plain')
    if (tag) addMixTag(tag)
  }, [addMixTag])

  // --- now-playing waveform ------------------------------------------------
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasWidth, setCanvasWidth] = useState(0)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => setCanvasWidth(canvas.offsetWidth))
    ro.observe(canvas); setCanvasWidth(canvas.offsetWidth)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (!cur || cur.peaks.length > 0) return
    window.electronAPI.getLibraryPeaks(cur.filePath, 900).then((p) => updateFile(cur.id, { peaks: p })).catch(() => {})
  }, [cur, updateFile])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.offsetWidth, h = canvas.offsetHeight
    if (w === 0 || h === 0) return
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d'); if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h)
    const peaks = cur?.peaks ?? [], mid = h / 2
    if (peaks.length === 0) { ctx.fillStyle = '#2a2a3a'; ctx.fillRect(0, mid - 0.5, w, 1); return }
    const dur = state.duration || cur?.duration || 0
    const splitX = dur > 0 ? (state.currentTime / dur) * w : 0
    const barW = w / peaks.length
    for (let i = 0; i < peaks.length; i++) {
      const x = i * barW
      const barH = Math.max(1, peaks[i] * h * 0.92)
      const played = x < splitX
      ctx.fillStyle = played ? '#f2a65a' : '#4b4660'
      ctx.globalAlpha = played ? 1 : (state.fading ? 0.55 : 0.4)
      ctx.fillRect(x, mid - barH / 2, Math.max(0.5, barW - 0.5), barH)
    }
    ctx.globalAlpha = 1
    // Cue markers set on the track (intro-end teal, outro-start pink, fade-in orange).
    if (dur > 0) {
      const markX = (ms: number): number => (ms / 1000 / dur) * w
      const line = (ms: number | null | undefined, color: string): void => {
        if (ms == null) return
        ctx.fillStyle = color; ctx.globalAlpha = 0.6; ctx.fillRect(Math.round(markX(ms)), 0, 1, h); ctx.globalAlpha = 1
      }
      line(cur?.introEndMs, '#14b8a6')
      line(cur?.outroStartMs, '#f472b6')
      const fi = cur ? mixFadeIns[cur.id] : undefined
      if (fi) line(fi, '#f2a65a')
    }
    if (splitX > 0) { ctx.fillStyle = '#ffd9a8'; ctx.fillRect(Math.round(splitX) - 0.5, 0, 1, h) }
  }, [cur, cur?.peaks, cur?.introEndMs, cur?.outroStartMs, state.currentTime, state.duration, state.fading, canvasWidth, mixFadeIns])

  // --- visualizer ----------------------------------------------------------
  const [visualizerOpen, setVisualizerOpen] = useState(false)
  const [showViz, setShowViz] = useState(false)
  const getWave = useCallback((count: number): number[] => {
    const f = curRef.current
    const out = new Array(count).fill(0)
    if (!f || f.peaks.length === 0) return out
    const dur = f.duration || 1
    const pos = engineRef.current?.position ?? 0
    const idx = Math.floor((pos / dur) * f.peaks.length)
    for (let i = 0; i < count; i++) { const j = idx - (count - 1 - i); if (j >= 0 && j < f.peaks.length) out[i] = f.peaks[j] }
    return out
  }, [])
  const getTempo = useCallback((): number => curRef.current?.audioFeatures?.tempo ?? 0, [])

  // --- drop a pool track onto Now Playing to fade it in --------------------
  const [npDragOver, setNpDragOver] = useState(false)
  const [queueDragOver, setQueueDragOver] = useState(false)
  const onQueueDrop = useCallback((e: React.DragEvent): void => {
    const id = e.dataTransfer.getData(MIX_TRACK_DND_TYPE)
    setQueueDragOver(false)
    if (id) { e.preventDefault(); addQueueTrack(id) }
  }, [addQueueTrack])
  const onNowPlayingDrop = useCallback((e: React.DragEvent): void => {
    e.preventDefault(); setNpDragOver(false)
    const id = e.dataTransfer.getData(MIX_TRACK_DND_TYPE)
    const fromItem = e.dataTransfer.getData(MIX_UPCOMING_ITEM_DND)
    const f = id ? files.find((x) => x.id === id) : null
    if (f) engineRef.current?.fadeTo(f)
    // Dragged out of a tag generator's list → consume it from that generator.
    if (f && fromItem) consumeFromUpcoming(fromItem, f.id)
  }, [files, consumeFromUpcoming])

  // --- playlist → queue ----------------------------------------------------
  const [playlistId, setPlaylistId] = useState<number | ''>('')
  const [addingPlaylist, setAddingPlaylist] = useState(false)
  // Combined "Load…" selection — a template ("tpl:<id>") or a recorded session ("ses:<id>").
  const [loadSel, setLoadSel] = useState<string>('')
  const handleLoadSelection = useCallback((value: string) => {
    setLoadSel(value)
    // Templates ("tpl:") and system presets ("sys:") both resolve via loadMix.
    if (value.startsWith('tpl:') || value.startsWith('sys:')) loadMix(value.slice(4))
    else if (value.startsWith('ses:')) loadSession(value.slice(4))
  }, [loadMix, loadSession])
  const deleteLoadSelection = useCallback(async () => {
    if (loadSel.startsWith('tpl:')) deleteMix(loadSel.slice(4))
    else if (loadSel.startsWith('ses:')) deleteMixSession(loadSel.slice(4))
    else if (loadSel.startsWith('sys:')) {
      // System presets carry a `srv_<serverId>` id; admins delete them on MFB.
      const serverId = Number(loadSel.slice(4).replace('srv_', ''))
      if (Number.isFinite(serverId)) {
        try { await window.electronAPI.deleteSystemPreset(serverId); await loadSystemPresets() }
        catch (e) { console.error('[deleteSystemPreset] failed', e) }
      }
    }
    setLoadSel('')
  }, [loadSel, deleteMix, deleteMixSession, loadSystemPresets])
  const addPlaylistToQueue = useCallback(async () => {
    if (playlistId === '') return
    setAddingPlaylist(true)
    try {
      const detail = await window.electronAPI.getPlaylist(Number(playlistId))
      if (!detail) return
      const byMfbId = new Map<number, LibraryFile>()
      for (const f of useLibraryStore.getState().files) if (f.mfbTrackId != null) byMfbId.set(f.mfbTrackId, f)
      const add = useLibraryStore.getState().addQueueTrack
      for (const seg of detail.segments) for (const t of seg.tracks) {
        const f = byMfbId.get(t.id)
        if (f) add(f.id)
      }
    } catch { /* ignore */ } finally { setAddingPlaylist(false) }
  }, [playlistId])

  const fadeRemaining = Math.max(0, (state.fadeDurationMs - state.fadeElapsedMs) / 1000)
  const fadeProgress = state.fadeDurationMs > 0 ? Math.min(1, state.fadeElapsedMs / state.fadeDurationMs) : 0

  // Time left on the current tag-group generator before the next queue item takes
  // over. Recomputed each playback tick (state.currentTime); null unless a timed
  // group is actively generating.
  const tagCountdown = useMemo(() => {
    const front = mixQueue[0]
    if (!front || front.kind !== 'tags' || front.durationMin == null) return null
    const gs = getGenStart()
    if (!gs || gs.id !== front.id) return null
    const leftS = (front.durationMin * 60000 - (Date.now() - gs.at)) / 1000
    return leftS > 0 ? leftS : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixQueue, state.currentTime])

  return (
    <div className="flex flex-col flex-1 min-w-0 bg-surface-base">
      {/* Header */}
      <div className="flex items-center h-10 gap-4 px-4 border-b shrink-0 border-surface-border">
        <div className="flex items-center min-w-0 gap-2">
          <svg className="w-3.5 h-3.5 text-accent shrink-0" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h2.5a4 4 0 013.2 1.6L9 6.5l1.3 1.9A4 4 0 0013.5 10M2 10h2.5a4 4 0 002.8-1.2M13.5 4h-1.5a4 4 0 00-3.2 1.6" />
          </svg>
          <span className="text-[11px] font-semibold tracking-widest text-gray-200 uppercase">Session Mode</span>
        </div>
        <button type="button" onClick={() => exitMixMode()} className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors uppercase">x Close</button>
        <button type="button" onClick={() => setTourOpen(true)} title="Session Mode tour"
          className="flex items-center justify-center w-5 h-5 rounded-full border border-surface-border text-[10px] text-gray-500 hover:text-gray-200 hover:border-accent/50 transition-colors shrink-0">?</button>
        <div className="flex items-center gap-3 ml-auto">
          {!isPro ? (
            /* Free tier: locked Load — opens the Pro upsell instead of loading. */
            <button type="button" onClick={() => setUpsellOpen(true)} title="Loading templates & sessions is a Pro feature"
              className="flex items-center gap-1 bg-surface-panel border border-surface-border rounded px-2 py-0.5 text-[10px] text-gray-500 hover:text-accent hover:border-accent/50 transition-colors">
              Load…
              <svg className="w-3 h-3 text-accent shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5.5" width="7" height="5" rx="1" /><path d="M4 5.5V4a2 2 0 014 0v1.5" /></svg>
            </button>
          ) : (savedMixes.length > 0 || mixSessions.length > 0 || systemPresets.length > 0) ? (
            <span data-tour="session-load" className="flex items-center gap-1">
              <select value={loadSel} onChange={(e) => handleLoadSelection(e.target.value)}
                className="bg-surface-panel border border-surface-border rounded px-2 py-0.5 text-[10px] text-gray-300 outline-none max-w-[160px]"
                title="Load a system preset, template, or recorded session">
                <option value="">Load…</option>
                {systemPresets.length > 0 && (
                  <optgroup label="System Presets">
                    {systemPresets.map((m) => <option key={m.id} value={`sys:${m.id}`}>{m.name}</option>)}
                  </optgroup>
                )}
                {savedMixes.length > 0 && (
                  <optgroup label="Templates">
                    {savedMixes.map((m) => <option key={m.id} value={`tpl:${m.id}`}>{m.name}</option>)}
                  </optgroup>
                )}
                {mixSessions.length > 0 && (
                  <optgroup label="Recorded Sessions">
                    {mixSessions.map((s) => <option key={s.id} value={`ses:${s.id}`}>{s.name}</option>)}
                  </optgroup>
                )}
              </select>
              {loadSel && (!loadSel.startsWith('sys:') || isAdmin) && (
                <button type="button" onClick={deleteLoadSelection}
                  title={loadSel.startsWith('ses:') ? 'Delete this recorded session' : loadSel.startsWith('sys:') ? 'Delete this system preset (admin)' : 'Delete this template'}
                  className="text-gray-600 transition-colors hover:text-gray-400">
                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 3h8M4.5 3V2h3v1M4 3v6M6 3v6M8 3v6M3 3l.5 7h5l.5-7" /></svg>
                </button>
              )}
            </span>
          ) : null}
          {isPro && (<>
          {/* Ellipsis menu — export / recorded-session actions */}
          <div data-tour="session-export" className="relative" ref={exportMenuRef}>
            <button type="button" onClick={() => setExportMenuOpen((v) => !v)} title="Session options"
              className={`flex items-center justify-center w-6 h-6 rounded border transition-colors ${exportMenuOpen ? 'border-accent/50 bg-accent/10 text-accent' : 'border-surface-border text-gray-400 hover:text-gray-200 hover:bg-surface-hover'}`}>
              <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="currentColor"><circle cx="3" cy="7" r="1.1" /><circle cx="7" cy="7" r="1.1" /><circle cx="11" cy="7" r="1.1" /></svg>
            </button>
            {exportMenuOpen && (
              <div onClick={() => setExportMenuOpen(false)}
                className="absolute right-0 top-7 z-50 min-w-[180px] rounded border border-surface-border bg-surface-panel shadow-lg py-1 text-[11px]">
                <button type="button" onClick={() => copyCurrentTracklist()} disabled={!cur && mixQueue.length === 0}
                  className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface-hover hover:text-gray-100 disabled:opacity-40 transition-colors">
                  {exportCopied ? 'Copied ✓' : 'Export tracklist'}
                </button>
                <button type="button" onClick={openRecordedSessions} disabled={mixSessions.length === 0}
                  className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface-hover hover:text-gray-100 disabled:opacity-40 transition-colors">
                  Recorded sessions{mixSessions.length > 0 ? ` · ${mixSessions.length}` : ''}…
                </button>
              </div>
            )}
          </div>

          <span data-tour="session-save-template" className="flex items-center">
            {savingName !== null ? (
              <span className="flex items-center gap-1">
                <input autoFocus value={savingName} onChange={(e) => setSavingName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') confirmSave(); else if (e.key === 'Escape') setSavingName(null) }}
                  onBlur={() => setSavingName(null)} placeholder="Template name…"
                  className="w-28 bg-surface-panel border border-surface-border rounded px-1.5 py-0.5 text-[10px] text-gray-200 placeholder-gray-700 outline-none focus:border-accent/50" />
                <button type="button" onMouseDown={(e) => { e.preventDefault(); confirmSave() }} className="text-[10px] text-accent hover:text-accent/80 transition-colors">Save</button>
              </span>
            ) : (
              <button type="button" onClick={() => setSavingName('')} className="text-[10px] text-gray-400 hover:text-accent transition-colors" title="Save this queue as a session template">Save as Template</button>
            )}
          </span>

          {/* Admin (user 1): publish this queue as a system preset for all users. */}
          {isAdmin && (
            <span className="flex items-center">
              {savingPresetName !== null ? (
                <span className="flex items-center gap-1">
                  <input autoFocus value={savingPresetName} onChange={(e) => setSavingPresetName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void confirmSavePreset(); else if (e.key === 'Escape') setSavingPresetName(null) }}
                    onBlur={() => setSavingPresetName(null)} placeholder="System preset name…"
                    className="w-32 bg-surface-panel border border-surface-border rounded px-1.5 py-0.5 text-[10px] text-gray-200 placeholder-gray-700 outline-none focus:border-accent/50" />
                  <button type="button" onMouseDown={(e) => { e.preventDefault(); void confirmSavePreset() }} className="text-[10px] text-accent hover:text-accent/80 transition-colors">Publish</button>
                </span>
              ) : (
                <button type="button" onClick={() => setSavingPresetName('')} disabled={presetSaving || mixQueue.filter((q) => q.kind === 'tags').length === 0}
                  className="text-[10px] text-accent/80 hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title={mixQueue.filter((q) => q.kind === 'tags').length === 0
                    ? 'Add a tag generator to the queue first — presets only store tag generators (not individual tracks)'
                    : 'Publish this queue’s tag generators as a system preset for all users (admin)'}>
                  {presetSaving ? 'Publishing…' : 'Save as System Preset'}
                </button>
              )}
            </span>
          )}
          </>)}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* LEFT: now playing + up next */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Now playing */}
          <div
            onDragOver={(e) => { if (e.dataTransfer.types.includes(MIX_TRACK_DND_TYPE)) { e.preventDefault(); setNpDragOver(true) } }}
            onDragLeave={() => setNpDragOver(false)}
            onDrop={onNowPlayingDrop}
            className={`p-5 border-b shrink-0 border-surface-border transition-colors ${npDragOver ? 'bg-accent/10 ring-1 ring-inset ring-accent/40' : ''}`}
          >
            {/* Inline visualizer (optional; fullscreen on expand) */}
            {showViz && (
              <div className="relative h-40 mb-4 overflow-hidden border rounded-lg border-surface-border">
                {!visualizerOpen && <MixVizCanvas getWave={getWave} getTempo={getTempo} />}
                <button type="button" onClick={() => setVisualizerOpen(true)}
                  className="absolute flex items-center justify-center transition-colors rounded-full top-2 right-2 w-7 h-7 text-white/60 hover:text-white bg-black/30 hover:bg-black/50"
                  title="Fullscreen visualizer">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" /></svg>
                </button>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[9px] uppercase tracking-widest text-gray-600">
                Now Playing{npDragOver && <span className="tracking-normal normal-case text-accent"> — drop to fade in</span>}
                <button type="button" onClick={() => setShowViz((v) => !v)}
                  className={`normal-case tracking-normal inline-flex items-center gap-1 transition-colors ${showViz ? 'text-accent' : 'text-gray-600 hover:text-gray-400'}`}
                  title={showViz ? 'Hide visualizer' : 'Show visualizer'}>
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z" /><circle cx="8" cy="8" r="1.7" /></svg>
                </button>
              </span>
              {state.fading && state.outgoing ? (
                <span className="flex items-center gap-1.5 text-[10px] text-accent">
                  <svg className="w-3.5 h-3.5 animate-pulse" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 5h9l-2-2M15 11H6l2 2" />
                  </svg>
                  <span className="truncate max-w-[130px] text-gray-400">{state.outgoing.trackTitle || state.outgoing.fileName}</span>
                  <span className="text-gray-600">→</span>
                  <span className="truncate max-w-[130px] text-gray-300">{cur ? (cur.trackTitle || cur.fileName) : ''}</span>
                  <span className="tabular-nums">· {fadeRemaining.toFixed(1)}s</span>
                </span>
              ) : tagCountdown != null && (
                <span className="flex items-center gap-1 text-[10px] text-gray-500" title="Time left on this tag group before the next queue item takes over">
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6.5" /><path d="M8 4.5V8l2.5 1.5" /></svg>
                  <span className="text-gray-400 tabular-nums">{fmt(tagCountdown)}</span>
                  <span>until next tag</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-2">
              {cur?.albumImageUrl ? (
                <img src={cur.albumImageUrl} alt="" className="object-cover rounded w-11 h-11 shrink-0" />
              ) : (
                <div className="flex items-center justify-center rounded w-11 h-11 shrink-0 bg-surface-hover">
                  <svg className="w-4 h-4 text-gray-600" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z" /></svg>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[15px] text-gray-100 truncate">
                  {cur ? (cur.trackTitle || cur.fileName) : <span className="text-gray-600">—</span>}
                </div>
                {cur?.artist && <div className="text-[12px] text-gray-500 truncate mt-0.5">{cur.artist}</div>}
              </div>
              {cur && (
                <button type="button" onClick={() => setSelectedId(cur.id)}
                  className="flex items-center justify-center w-5 h-5 text-gray-500 transition-colors rounded shrink-0 hover:text-accent hover:bg-accent/10"
                  title="View this track's fade points and curves">
                  <svg className="w-3 h-3" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                    <path d="M1 7h1.5M11.5 7H13M4 4v6M6 2.5v9M8 4.5v5M10 3.5v7" />
                  </svg>
                </button>
              )}
              {cur && (
                <button type="button" onClick={() => eng()?.stop()}
                  className="flex items-center justify-center w-5 h-5 text-gray-500 transition-colors rounded shrink-0 hover:text-red-400 hover:bg-red-500/10"
                  title="Clear the current track">
                  <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l6 6M8 2l-6 6" /></svg>
                </button>
              )}
            </div>

            <canvas
              ref={canvasRef}
              className="w-full h-24 mt-3 cursor-pointer"
              title="Click to cue and crossfade to this point"
              onClick={(e) => {
                if (!cur || !cur.duration) return
                const rect = e.currentTarget.getBoundingClientRect()
                const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                engineRef.current?.seekFadeTo(frac * cur.duration)
              }}
            />
            {/* crossfade progress bar */}
            <div className="h-0.5 mt-1 bg-surface-border rounded overflow-hidden">
              {state.fading && <div className="h-full bg-accent transition-[width] duration-100" style={{ width: `${fadeProgress * 100}%` }} />}
            </div>
            <div className="flex items-center justify-between mt-1 font-mono text-[10px] tabular-nums text-gray-600">
              <span>{fmt(state.currentTime)}</span>
              <span className="text-gray-500">−{fmt(Math.max(0, state.duration - state.currentTime))} left</span>
              <span>{fmt(state.duration)}</span>
            </div>

            {/* transport + crossfade length on one line */}
            <div data-tour="session-transport" className="flex items-center gap-2 mt-4">
              <button type="button" disabled={!canPlay} onClick={() => eng()?.toggle()}
                className="flex items-center justify-center w-10 h-10 text-gray-200 transition-colors border rounded-full border-surface-border bg-surface-hover hover:text-white hover:border-accent/50 hover:bg-accent/20 disabled:opacity-30"
                title={state.playing ? 'Pause' : 'Play'}>
                {state.playing
                  ? <svg className="w-4 h-4" viewBox="0 0 10 10" fill="currentColor"><rect x="1.5" y="1" width="2.5" height="8" rx="0.5" /><rect x="6" y="1" width="2.5" height="8" rx="0.5" /></svg>
                  : <svg className="w-4 h-4" viewBox="0 0 10 10" fill="currentColor"><path d="M2 1.5l7 3.5-7 3.5V1.5z" /></svg>}
              </button>

              {/* Record — captures the blow-by-blow of this session (Pro) */}
              {isPro ? (
              <span data-tour="session-record" className="flex items-center shrink-0">
                {recording ? (
                  <button type="button" onClick={() => setSavePromptOpen(true)} title="Stop recording & save this session"
                    className="flex items-center gap-1.5 h-9 px-3 rounded-full border border-red-500/50 text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors shrink-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-[11px] tabular-nums">{fmt((Date.now() - recording.startedAt) / 1000)}</span>
                    <span className="text-[10px] text-gray-500">· {recording.trackCount}</span>
                  </button>
                ) : (
                  <button type="button" disabled={!canPlay} onClick={() => startRecording()} title="Record this session (tracklist + edits)"
                    className="flex items-center justify-center w-9 h-9 rounded-full border border-surface-border text-gray-400 hover:text-red-400 hover:border-red-500/50 hover:bg-red-500/10 transition-colors disabled:opacity-30 shrink-0">
                    <span className="w-3 h-3 rounded-full bg-red-500/80" />
                  </button>
                )}
              </span>
              ) : (
                /* Free tier: locked Record — clicking opens the Pro upsell. */
                <button type="button" onClick={() => setUpsellOpen(true)} title="Recording is a Pro feature"
                  className="relative flex items-center justify-center w-9 h-9 rounded-full border border-surface-border text-gray-600 hover:text-accent hover:border-accent/50 hover:bg-accent/10 transition-colors shrink-0">
                  <span className="w-3 h-3 rounded-full bg-gray-600" />
                  <svg className="absolute -top-1 -right-1 w-3.5 h-3.5 text-accent bg-surface-panel rounded-full p-px" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2.5" y="5.5" width="7" height="5" rx="1" /><path d="M4 5.5V4a2 2 0 014 0v1.5" />
                  </svg>
                </button>
              )}

              <button type="button" disabled={!canPlay} onClick={() => eng()?.next()}
                className="flex items-center justify-center text-gray-300 transition-colors border rounded-full w-9 h-9 border-surface-border hover:text-white hover:border-accent/50 hover:bg-accent/10 disabled:opacity-30"
                title="Skip to next">
                <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="currentColor"><path d="M10 2h-1.5v8H10zM1.5 2l6 4-6 4V2z" /></svg>
              </button>
              <button type="button" disabled={!canPlay} onClick={() => eng()?.fadeInNextNow()}
                className="h-9 px-3 rounded-full border border-surface-border text-[11px] text-gray-300 hover:text-white hover:border-accent/50 hover:bg-accent/10 transition-colors disabled:opacity-30 shrink-0"
                title="Start the crossfade into the next track now">Fade next</button>

              <div className="flex items-center flex-1 min-w-0 gap-2 ml-1">
                <span className="text-[9px] uppercase tracking-widest text-gray-600 shrink-0">Xfade</span>
                <input type="range" min={2000} max={40000} step={1000} value={mixFadeMs}
                  onChange={(e) => setMixFadeMs(Number(e.target.value))}
                  className="flex-1 min-w-0 h-1 accent-[#f2a65a] cursor-pointer" title="Crossfade length" />
                <span className="text-[10px] text-gray-300 tabular-nums shrink-0 w-7 text-right">{Math.round(mixFadeMs / 1000)}s</span>
              </div>
            </div>
          </div>

          {/* Up next queue */}
          <div data-tour="session-queue" className="flex items-center justify-between px-4 pt-3 pb-1.5 shrink-0">
            <span className="text-[9px] uppercase tracking-widest text-gray-600">
              Up Next {mixQueue.length > 0 && <span className="tracking-normal text-gray-700 normal-case">· {mixQueue.length}</span>}
            </span>
            {mixQueue.length > 0 && <button type="button" onClick={() => clearQueue()} className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors">Clear</button>}
          </div>
          <div
            className={`flex-1 min-h-0 overflow-y-auto transition-colors ${queueDragOver ? 'bg-accent/5 ring-1 ring-inset ring-accent/40' : ''}`}
            onDragOver={(e) => { if (e.dataTransfer.types.includes(MIX_TRACK_DND_TYPE)) { e.preventDefault(); setQueueDragOver(true) } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setQueueDragOver(false) }}
            onDrop={onQueueDrop}
          >
            {mixQueue.length === 0 ? (
              <p className="px-4 py-4 text-[11px] text-gray-600 leading-relaxed">
                Queue is empty — playing random tracks from the pool ({pool.length}).<br />
                Drag or add tracks from the pool on the right, drop in tag generators, or load a playlist.
              </p>
            ) : (
              <QueueList items={mixQueue} fileById={fileById} tagPreviews={tagPreviews} selectedId={selectedId}
                onMove={moveQueueItem} onRemove={removeQueueItem} onSelect={setSelectedId} onPlay={playQueueItem}
                onPlayUpcoming={playUpcomingTrack} onSetMatch={setQueueItemMatch} onSetDuration={setQueueItemDuration}
                onShowMore={showMoreUpcoming} onShuffleUpcoming={shuffleUpcoming} onReorderUpcoming={reorderUpcoming} />
            )}
            <div className="px-4 py-2 text-[10px] text-gray-700">
              then: {mixTailTags ? `random from ${mixTailTags.join(', ')}` : `random from pool (${pool.length})`}
            </div>
          </div>
        </div>

        {/* RIGHT: available pool — swapped for the track properties panel while
            inspecting a track (info icon on a pool row), so it stays two columns. */}
        {selectedFileId ? (
          <div className="flex flex-col min-h-0 w-96 shrink-0">
            <PropertiesPanel />
          </div>
        ) : (
        <div className="flex flex-col min-h-0 border-l w-96 shrink-0 border-surface-border">
          {/* Tag + feel + playlist controls */}
          <div data-tour="session-tags" className="px-3 py-3 border-b shrink-0 border-surface-border">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onTagDrop}
              className={`rounded-lg border border-dashed px-3 py-2 transition-colors ${dragOver ? 'border-accent bg-accent/10' : 'border-surface-border bg-surface-panel/40'}`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {mixTags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-accent/15 border border-accent/30 text-[11px] text-accent">
                    {tag}
                    <button type="button" onClick={() => removeMixTag(tag)} className="opacity-60 hover:opacity-100" aria-label={`Remove ${tag}`}>
                      <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l6 6M8 2l-6 6" /></svg>
                    </button>
                  </span>
                ))}
                <button type="button" onClick={() => setPickerOpen((v) => !v)}
                  className="inline-flex items-center gap-1 pl-2 pr-2.5 py-1 rounded-full border border-dashed border-surface-border text-[11px] text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
                  title={pickerOpen ? 'Close tag panel' : 'Filter the pool by tags'}>
                  <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">{pickerOpen ? <path d="M2 2l6 6M8 2l-6 6" /> : <path d="M5 1v8M1 5h8" />}</svg>
                  {pickerOpen ? 'Close tags' : 'Add tag'}
                </button>
              </div>
            </div>

            <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5 mt-2">
              <button type="button" onClick={() => setFeatOpen((v) => !v)}
                className={`text-[10px] transition-colors inline-flex items-center gap-1 ${featureTargetEntries.length > 0 ? 'text-accent' : 'text-gray-400 hover:text-gray-200'}`}>
                <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 1v8M5 1v8M7.5 1v8" /></svg>
                Feel EQ{featureTargetEntries.length > 0 ? ` · ${featureTargetEntries.length}` : ''}
              </button>
              {(mixTags.length > 0 || featureTargetEntries.length > 0) && (
                <button type="button" onClick={() => addQueueTags(mixTags, mixMatchMode, mixFeatureTargets)}
                  className="text-[10px] text-accent hover:text-accent/80 transition-colors inline-flex items-center gap-1"
                  title="Add these tags + the current Feel EQ to Up Next as a generator">
                  <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 1v8M1 5h8" /></svg>
                  Add to queue
                </button>
              )}
              <div className="flex items-center gap-1 text-[10px]">
                {(['any', 'all'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMixMatchMode(m)}
                    className={`px-1.5 py-0.5 rounded transition-colors ${mixMatchMode === m ? 'text-accent bg-accent/10' : 'text-gray-600 hover:text-gray-400'}`}>
                    {m === 'any' ? 'Any' : 'All'}
                  </button>
                ))}
              </div>
              {mixTags.length > 0 && <button type="button" onClick={() => clearMixTags()} className="ml-auto text-[10px] text-gray-600 hover:text-gray-400 transition-colors">Clear</button>}
            </div>

            {pickerOpen && (
              <div className="mt-2 border rounded border-surface-border bg-surface-panel">
                <input type="text" autoFocus value={tagQuery} onChange={(e) => setTagQuery(e.target.value)} placeholder="Filter tags…"
                  className="w-full bg-transparent px-2.5 py-1.5 text-[11px] text-gray-300 placeholder-gray-700 outline-none border-b border-surface-border" />
                <div className="py-1 overflow-y-auto max-h-40">
                  {allTags.filter(([t]) => !mixTags.includes(t) && t.toLowerCase().includes(tagQuery.toLowerCase())).slice(0, 60).map(([tag, count]) => (
                    <button key={tag} type="button"
                      onClick={() => { addMixTag(tag); setTagQuery('') }}
                      onDoubleClick={() => { startTagNow(tag); setTagQuery(''); setPickerOpen(false) }}
                      title="Add more tags to filter available tracks · double-click to play this tag now"
                      className="w-full flex items-center justify-between px-2.5 py-1 text-left text-[11px] text-gray-400 hover:bg-surface-hover hover:text-gray-200 transition-colors">
                      <span className="truncate">{tag}</span><span className="text-[10px] text-gray-600 tabular-nums ml-2">{count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {featOpen && (
              <div className="p-3 mt-2 border rounded border-surface-border bg-surface-panel">
                <div className="flex justify-around gap-3 h-44">
                  {MIX_FEATURES.map(({ key, label, short, color }) => {
                    const w = mixFeatureTargets[key] ?? 0
                    const active = w !== 0
                    return (
                      <div key={key} className="flex flex-col items-center flex-1 h-full gap-1" title={label}>
                        <span className="text-[9px] tabular-nums h-3" style={{ color: active ? color : '#4b5563' }}>
                          {active ? `${w > 0 ? '+' : ''}${Math.round(w * 100)}` : '0'}
                        </span>
                        <VerticalSlider value={w} color={color} onChange={(v) => setMixFeatureTarget(key, v)} />
                        <button type="button" onClick={() => setMixFeatureTarget(key, 0)}
                          className="text-[9px] tracking-wide transition-colors hover:opacity-80"
                          style={{ color: active ? color : '#6b7280' }}
                          title="Reset band to neutral">
                          {short}
                        </button>
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-center justify-between pt-2 mt-1 border-t border-surface-border">
                  <p className="text-[9px] text-gray-600 leading-tight max-w-[70%]">Boost (up) or cut (down) each dimension — center is off. Steers the pool &amp; the random pick.</p>
                  {featureTargetEntries.length > 0 && <button type="button" onClick={() => clearMixFeatureTargets()} className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors shrink-0">Reset</button>}
                </div>
              </div>
            )}

            {/* Playlist → queue (Pro) */}
            {isPro ? (
              playlists.length > 0 && (
              <div className="flex items-center gap-2 mt-2">
                <select value={playlistId} onChange={(e) => setPlaylistId(e.target.value === '' ? '' : Number(e.target.value))}
                  className="flex-1 min-w-0 bg-surface-panel border border-surface-border rounded px-2 py-1 text-[11px] text-gray-300 outline-none">
                  <option value="">Add a playlist…</option>
                  {playlists.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
                <button type="button" disabled={playlistId === '' || addingPlaylist} onClick={addPlaylistToQueue}
                  className="text-[10px] px-2.5 py-1 rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-40 shrink-0">
                  {addingPlaylist ? 'Adding…' : 'Add to queue'}
                </button>
              </div>
              )
            ) : (
              /* Free tier: locked "Add a playlist" — disabled look, opens the Pro upsell. */
              <div className="flex items-center gap-2 mt-2">
                <button type="button" onClick={() => setUpsellOpen(true)} title="Adding a playlist is a Pro feature"
                  className="flex-1 min-w-0 flex items-center justify-between gap-2 bg-surface-panel border border-surface-border rounded px-2 py-1 text-[11px] text-gray-600 opacity-70 hover:opacity-100 hover:text-accent hover:border-accent/50 transition-colors">
                  <span className="truncate">Add a playlist…</span>
                  <svg className="w-3 h-3 text-accent shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5.5" width="7" height="5" rx="1" /><path d="M4 5.5V4a2 2 0 014 0v1.5" /></svg>
                </button>
                <span className="text-[10px] px-2.5 py-1 rounded border border-surface-border text-gray-700 shrink-0 cursor-default select-none">Add to queue</span>
              </div>
            )}
          </div>

          {/* Available pool */}
          <div className="flex items-center justify-between px-4 pt-3 pb-1.5 shrink-0">
            <span className="text-[9px] uppercase tracking-widest text-gray-600">Available <span className="tracking-normal text-gray-700 normal-case">· {filteredPool.length}{featureTargetEntries.length > 0 ? ' · sorted by feel' : ''}</span></span>
          </div>
          <div className="flex items-center gap-1.5 mx-3 mb-2 px-2 py-1 rounded border border-surface-border bg-surface-panel/40 shrink-0">
            <svg className="w-3 h-3 text-gray-600 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="5" r="3.5" /><path d="M8 8l2.5 2.5" /></svg>
            <input type="text" value={poolQuery} onChange={(e) => setPoolQuery(e.target.value)} placeholder="Search tracks…"
              className="flex-1 min-w-0 bg-transparent text-[11px] text-gray-300 placeholder-gray-700 outline-none" />
            {poolQuery && <button type="button" onClick={() => setPoolQuery('')} className="text-gray-600 hover:text-gray-400 shrink-0"><svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg></button>}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto" onScroll={onPoolScroll}>
            {filteredPool.length === 0 ? (
              <p className="px-4 py-6 text-[11px] text-gray-600 text-center">{pool.length === 0 ? 'No tracks match these tags.' : `No tracks match “${poolQuery}”.`}</p>
            ) : (
              <PoolList items={visiblePool} selectedId={selectedId} infoId={selectedFileId} previewFileId={previewFileId} onAdd={addQueueTrack} onSelect={setSelectedId} onInfo={selectFile} onPreview={setPreview} poolIds={poolIds} />
            )}
          </div>
        </div>
        )}
      </div>

      {selected && (
        <MixCueEditorModal
          key={selected.id}
          file={selected}
          onSave={(updates) => updateFile(selected.id, updates)}
          onClose={() => setSelectedId(null)}
        />
      )}

      {visualizerOpen && (
        <MixVisualizer getWave={getWave} getTempo={getTempo} onClose={() => setVisualizerOpen(false)} />
      )}

      {savePromptOpen && (
        <SaveSessionModal
          onSave={handleSaveSession}
          onCancel={() => setSavePromptOpen(false)}
          onDiscard={handleDiscardSession}
        />
      )}

      {sessionsOpen && <SessionsModal initialSessionId={sessionsInitialId} onClose={() => setSessionsOpen(false)} />}

      {tourOpen && <GuidedTour steps={tourSteps} onClose={closeTour} />}

      {upsellOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/70" onClick={() => setUpsellOpen(false)} />
          <div className="relative flex flex-col w-full max-w-sm gap-4 p-5 shadow-2xl bg-surface-panel rounded-xl border border-surface-border">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-accent" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2.5" y="5.5" width="7" height="5" rx="1" /><path d="M4 5.5V4a2 2 0 014 0v1.5" />
              </svg>
              <h2 className="text-sm font-semibold text-white">Unlock Session Mode Pro</h2>
            </div>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Playing and building a live mix is free. <span className="text-gray-300">Pro</span> adds the tools
              to keep what you play:
            </p>
            <ul className="flex flex-col gap-1.5 text-[11px] text-gray-400">
              {['Record the blow-by-blow of a live session', 'Save reusable templates', 'Load & replay past sessions'].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <svg className="w-3 h-3 text-accent shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-5.5" /></svg>
                  {t}
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setUpsellOpen(false)}
                className="px-3 py-1.5 text-[11px] text-gray-400 rounded border border-surface-border hover:text-gray-200 hover:bg-surface-hover transition-colors">
                Not now
              </button>
              <button type="button" onClick={() => window.open(PRO_UPSELL_URL, '_blank')}
                className="px-3 py-1.5 text-[11px] font-medium text-white rounded bg-accent hover:bg-accent/80 transition-colors">
                Learn about Pro
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Small waveform/preview icon button, revealed on row hover.
function PreviewIconButton({ onClick }: { onClick: (e: React.MouseEvent) => void }): JSX.Element {
  return (
    <button type="button" onClick={onClick} title="Preview / set fade-in point"
      className="flex items-center justify-center w-4 h-4 text-gray-600 transition-all opacity-0 shrink-0 group-hover:opacity-100 hover:text-accent">
      <svg className="w-3 h-3" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
        <path d="M1 7h1.5M11.5 7H13M4 4v6M6 2.5v9M8 4.5v5M10 3.5v7" />
      </svg>
    </button>
  )
}

// --- Available pool list ---------------------------------------------------
const PoolList = memo(function PoolList({ items, selectedId, infoId, previewFileId, onAdd, onSelect, onInfo, onPreview, poolIds }: {
  items: { file: LibraryFile; feel: number | null }[]
  selectedId: string | null
  infoId: string | null
  previewFileId: string | null
  onAdd: (fileId: string) => void
  onSelect: (id: string) => void
  onInfo: (id: string | null) => void
  onPreview: (fileId: string | null, queue: string[]) => void
  poolIds: string[]
}): JSX.Element {
  return (
    <>
      {items.map(({ file: f, feel }) => {
        const isPreviewing = previewFileId === f.id
        const isInfo = infoId === f.id
        return (
        <div key={f.id} draggable
          onDoubleClick={() => onAdd(f.id)}
          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData(MIX_TRACK_DND_TYPE, f.id) }}
          className={`group flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors ${selectedId === f.id || isInfo ? 'bg-accent/10 text-gray-200' : 'text-gray-400 hover:bg-surface-hover'}`}
          title="Double-click to add to queue">
          <button type="button" onClick={(e) => { e.stopPropagation(); onAdd(f.id) }}
            className="flex items-center justify-center w-4 h-4 text-gray-600 transition-colors rounded shrink-0 hover:text-accent hover:bg-accent/10" title="Add to queue">
            <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 1v8M1 5h8" /></svg>
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); isPreviewing ? onPreview(null, []) : onPreview(f.id, poolIds) }}
            className={`flex items-center justify-center w-4 h-4 rounded-full border transition-colors shrink-0 ${isPreviewing ? 'opacity-100 border-accent text-accent' : 'text-gray-600 border-gray-600 opacity-0 group-hover:opacity-100 hover:border-accent hover:text-accent'}`}
            title={isPreviewing ? 'Stop preview' : 'Preview track'}>
            {isPreviewing ? (
              <svg className="w-2 h-2" viewBox="0 0 10 10" fill="currentColor"><rect x="1.5" y="1" width="2.5" height="8" rx="0.5" /><rect x="6" y="1" width="2.5" height="8" rx="0.5" /></svg>
            ) : (
              <svg className="w-2 h-2" viewBox="0 0 10 10" fill="currentColor"><path d="M2 1.5l7 3.5-7 3.5V1.5z" /></svg>
            )}
          </button>
          <span className="flex-1 truncate">{f.trackTitle || f.fileName}</span>
          {feel != null && (
            <span className="flex items-center gap-1 shrink-0" title={`Feel match ${Math.round(feel * 100)}%`}>
              <span className="w-8 h-1 overflow-hidden rounded bg-surface-border">
                <span className="block h-full bg-accent" style={{ width: `${feel * 100}%` }} />
              </span>
              <span className="w-6 text-right text-[9px] tabular-nums text-gray-600">{Math.round(feel * 100)}%</span>
            </span>
          )}
          {feel == null && f.artist && <span className="truncate text-gray-600 max-w-[34%]">{f.artist}</span>}
          <button type="button" onClick={(e) => { e.stopPropagation(); onInfo(isInfo ? null : f.id) }}
            className={`flex items-center justify-center w-4 h-4 rounded-full border transition-all shrink-0 ${isInfo ? 'opacity-100 border-accent text-accent' : 'text-gray-600 border-transparent opacity-0 group-hover:opacity-100 hover:text-accent'}`}
            title={isInfo ? 'Hide track details' : 'Show track details'}>
            <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="5" /><path d="M6 5.2v3" /><circle cx="6" cy="3.4" r="0.5" fill="currentColor" stroke="none" /></svg>
          </button>
          <PreviewIconButton onClick={(e) => { e.stopPropagation(); onSelect(f.id) }} />
        </div>
        )
      })}
    </>
  )
})

// --- Up-Next queue (tracks + tag-group generators) -------------------------
const QUEUE_DURATIONS: (number | null)[] = [null, 2, 5, 10, 15, 20, 30, 45, 60]
const nextDuration = (d: number | null): number | null => {
  const i = QUEUE_DURATIONS.findIndex((x) => x === d)
  return QUEUE_DURATIONS[(i + 1) % QUEUE_DURATIONS.length]
}

const QueueList = memo(function QueueList({ items, fileById, tagPreviews, selectedId, onMove, onRemove, onSelect, onPlay, onPlayUpcoming, onSetMatch, onSetDuration, onShowMore, onShuffleUpcoming, onReorderUpcoming }: {
  items: MixQueueItem[]
  fileById: Map<string, LibraryFile>
  tagPreviews: Map<string, { count: number; tracks: LibraryFile[] }>
  selectedId: string | null
  onMove: (fromId: string, toId: string) => void
  onRemove: (id: string) => void
  onSelect: (id: string) => void
  onPlay: (item: MixQueueItem) => void
  onPlayUpcoming: (itemId: string, f: LibraryFile) => void
  onSetMatch: (id: string, mode: 'any' | 'all') => void
  onSetDuration: (id: string, min: number | null) => void
  onShowMore: (id: string) => void
  onShuffleUpcoming: (id: string) => void
  onReorderUpcoming: (itemId: string, fromId: string, toId: string) => void
}): JSX.Element {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  // Drag state for reordering tracks *within* a tag generator's upcoming list.
  const [upDrag, setUpDrag] = useState<{ itemId: string; fromId: string } | null>(null)
  const [upOverId, setUpOverId] = useState<string | null>(null)
  // Inline duration entry: which generator is being typed into, + its draft value.
  const [durEditId, setDurEditId] = useState<string | null>(null)
  const [durDraft, setDurDraft] = useState('')
  const commitDuration = (id: string): void => {
    const n = Math.round(Number(durDraft))
    onSetDuration(id, durDraft.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null)
    setDurEditId(null)
  }
  // How many upcoming tracks each tag-generator reveals (grows by 10).
  const [shownCount, setShownCount] = useState<Record<string, number>>({})
  // Which tag-generators have their upcoming list collapsed (expanded by default).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  return (
    <>
      {items.map((item, i) => {
        const file = item.kind === 'track' ? fileById.get(item.fileId) : null
        const preview = item.kind === 'tags' ? tagPreviews.get(item.id) : undefined
        return (
          <div key={item.id}>
            <div draggable
              onDoubleClick={() => onPlay(item)}
              onDragStart={(e) => { setDragId(item.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(MIX_QUEUE_DND_TYPE, item.id) }}
              onDragOver={(e) => { e.preventDefault(); if (overId !== item.id) setOverId(item.id) }}
              onDrop={(e) => { e.preventDefault(); if (dragId) onMove(dragId, item.id); setDragId(null); setOverId(null) }}
              onDragEnd={() => { setDragId(null); setOverId(null) }}
              title={item.kind === 'track' ? 'Double-click to play now' : 'Double-click to start this generator'}
              className={`group flex items-center gap-2 px-4 py-1.5 text-[11px] cursor-grab active:cursor-grabbing transition-colors ${
                selectedId && file?.id === selectedId ? 'bg-accent/10 text-gray-200' : 'text-gray-400 hover:bg-surface-hover'
              } ${overId === item.id && dragId && dragId !== item.id ? 'border-t border-accent' : 'border-t border-transparent'} ${dragId === item.id ? 'opacity-40' : ''}`}>
              <svg className="w-3 h-3 text-gray-700 shrink-0" viewBox="0 0 12 12" fill="currentColor"><circle cx="4" cy="3" r="1" /><circle cx="8" cy="3" r="1" /><circle cx="4" cy="6" r="1" /><circle cx="8" cy="6" r="1" /><circle cx="4" cy="9" r="1" /><circle cx="8" cy="9" r="1" /></svg>
              <span className="w-4 text-right text-gray-700 tabular-nums">{i + 1}</span>
              {item.kind === 'track' ? (
                <>
                  <span className="flex-1 truncate">{file ? (file.trackTitle || file.fileName) : <span className="italic text-gray-700">missing track</span>}</span>
                  {file?.artist && <span className="truncate text-gray-600 max-w-[30%]">{file.artist}</span>}
                  {file && <PreviewIconButton onClick={(e) => { e.stopPropagation(); onSelect(file.id) }} />}
                </>
              ) : (
                <span className="flex-1 inline-flex items-center gap-1.5 min-w-0">
                  {preview && preview.tracks.length > 0 ? (
                    <button type="button" onClick={(e) => { e.stopPropagation(); setCollapsed((c) => ({ ...c, [item.id]: !c[item.id] })) }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      className="shrink-0 text-gray-600 transition-colors hover:text-accent"
                      title={collapsed[item.id] ? 'Show queued tracks' : 'Hide queued tracks'}>
                      <svg className={`w-2.5 h-2.5 transition-transform ${collapsed[item.id] ? '' : 'rotate-90'}`} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 2l4 3-4 3" /></svg>
                    </button>
                  ) : (
                    <span className="w-2.5 shrink-0" />
                  )}
                  <svg className="w-3 h-3 shrink-0 text-accent/70" viewBox="0 0 12 12" fill="currentColor" aria-label="Tag generator"><title>Tag generator — auto-plays library tracks matching these tags</title><path d="M1.5 2A1.5 1.5 0 013 .5h3.9a1.5 1.5 0 011 .4l3.1 3.2a1.5 1.5 0 010 2.1L7.9 9.3a1.5 1.5 0 01-2.1 0L2.4 5.9A1.5 1.5 0 012 4.9V2z" /></svg>
                  <span className="truncate text-accent/90"
                    title={item.tags.length > 0 ? `Plays tracks tagged ${item.tags.join(item.matchMode === 'all' ? ' AND ' : ' OR ')}` : 'Plays random tracks from the whole pool (no tag filter)'}>
                    {item.tags.length > 0 ? item.tags.join(item.matchMode === 'all' ? ' + ' : ', ') : 'all tracks'}
                  </span>
                  {item.tags.length > 1 && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); onSetMatch(item.id, item.matchMode === 'all' ? 'any' : 'all') }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      className="shrink-0 px-1 rounded text-[9px] tracking-wide text-gray-500 hover:text-accent bg-surface-panel border border-surface-border transition-colors"
                      title={item.matchMode === 'all' ? 'Matches tracks with ALL these tags — click for ANY' : 'Matches tracks with ANY of these tags — click for ALL'}>
                      {item.matchMode === 'all' ? 'ALL' : 'ANY'}
                    </button>
                  )}
                  {Object.entries(item.feel).map(([k, wt]) => {
                    const feat = MIX_FEATURES.find((ff) => ff.key === k)
                    if (!feat) return null
                    return <span key={k} className="shrink-0 text-[9px] tabular-nums" style={{ color: feat.color }}
                      title={`Feel EQ · ${feat.label}: ${wt > 0 ? 'boost' : 'cut'} ${Math.abs(Math.round(wt * 100))} (favours tracks ${wt > 0 ? 'higher' : 'lower'} in ${feat.label.toLowerCase()})`}>{feat.short} {wt > 0 ? '+' : ''}{Math.round(wt * 100)}</span>
                  })}
                  {durEditId === item.id ? (
                    <span className="inline-flex items-center shrink-0" onClick={(e) => e.stopPropagation()}>
                      <input autoFocus type="number" min={0} value={durDraft}
                        onChange={(e) => setDurDraft(e.target.value)}
                        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitDuration(item.id); else if (e.key === 'Escape') setDurEditId(null) }}
                        onBlur={() => commitDuration(item.id)}
                        placeholder="∞"
                        className="w-9 px-1 rounded-l text-[9px] tabular-nums text-gray-200 bg-surface-panel border border-accent/50 outline-none" />
                      <span className="px-1 rounded-r text-[9px] text-gray-500 bg-surface-panel border border-l-0 border-accent/50">m</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center shrink-0">
                      <button type="button" onClick={(e) => { e.stopPropagation(); onSetDuration(item.id, nextDuration(item.durationMin)) }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="px-1 rounded-l text-[9px] tabular-nums text-gray-500 hover:text-accent bg-surface-panel border border-surface-border transition-colors"
                        title="How long this generator plays before the queue advances — click to cycle presets">
                        {item.durationMin == null ? '∞' : `${item.durationMin}m`}
                      </button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); setDurDraft(item.durationMin?.toString() ?? ''); setDurEditId(item.id) }}
                        className="flex items-center px-0.5 rounded-r border border-l-0 border-surface-border text-gray-600 hover:text-accent bg-surface-panel transition-colors"
                        title="Type a specific length in minutes (e.g. 8)">
                        <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 1.5l2 2L4 10l-2.5.5L2 8z" /></svg>
                      </button>
                    </span>
                  )}
                  <span className="text-gray-700 shrink-0 tabular-nums"
                    title={preview ? `${preview.count} matching track${preview.count === 1 ? '' : 's'} in your library` : 'Random tracks from the pool (no tag filter)'}>
                    {preview ? `${preview.count}` : 'random'}
                  </span>
                </span>
              )}
              <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(item.id) }}
                className="flex items-center justify-center w-4 h-4 text-gray-700 transition-all opacity-0 shrink-0 group-hover:opacity-100 hover:text-gray-300" title="Remove">
                <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l6 6M8 2l-6 6" /></svg>
              </button>
            </div>
            {/* Upcoming tracks — next 10, expandable, drag to reorder; click one to play now */}
            {item.kind === 'tags' && !collapsed[item.id] && preview && preview.tracks.length > 0 && (() => {
              const shown = shownCount[item.id] ?? 10
              const visible = preview.tracks.slice(0, shown)
              const canShowMore = shown < preview.count
              return (
                <div className="pb-1.5 pl-10 pr-4">
                  <div className="flex items-center gap-1.5 py-0.5 text-[9px] text-gray-700">
                    <span className="tracking-wide uppercase">Next {visible.length}{preview.count > preview.tracks.length ? ` of ${preview.count}` : ''}</span>
                    {preview.tracks.length > 1 && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); onShuffleUpcoming(item.id) }}
                        className="inline-flex items-center gap-1 px-1 ml-auto text-gray-600 transition-colors border rounded hover:text-accent bg-surface-panel border-surface-border" title="Shuffle these tracks">
                        <span aria-hidden>⟳</span> Random
                      </button>
                    )}
                  </div>
                  {visible.map((f, idx) => (
                    <div key={f.id} draggable
                      onDoubleClick={() => onPlayUpcoming(item.id, f)}
                      onDragStart={(e) => {
                        setUpDrag({ itemId: item.id, fromId: f.id })
                        e.dataTransfer.effectAllowed = 'copyMove'
                        // Reorder within the list AND drag out like a pool track (drop on
                        // Now Playing to play it, or on the queue to add it as a track).
                        e.dataTransfer.setData(MIX_TRACK_DND_TYPE, f.id)
                        e.dataTransfer.setData(MIX_UPCOMING_ITEM_DND, item.id)
                      }}
                      onDragOver={(e) => { if (upDrag?.itemId === item.id) { e.preventDefault(); e.stopPropagation(); if (upOverId !== f.id) setUpOverId(f.id) } }}
                      onDrop={(e) => { if (upDrag?.itemId === item.id) { e.preventDefault(); e.stopPropagation(); if (upDrag.fromId !== f.id) onReorderUpcoming(item.id, upDrag.fromId, f.id) } setUpDrag(null); setUpOverId(null) }}
                      onDragEnd={() => { setUpDrag(null); setUpOverId(null) }}
                      className={`group flex items-center gap-2 py-0.5 text-[10px] text-gray-600 hover:text-gray-300 cursor-grab active:cursor-grabbing transition-colors ${
                        upDrag?.itemId === item.id && upOverId === f.id && upDrag.fromId !== f.id ? 'border-t border-accent' : 'border-t border-transparent'
                      } ${upDrag?.fromId === f.id ? 'opacity-40' : ''}`}
                      title="Double-click to play now · drag to reorder or onto Now Playing">
                      <svg className="w-2.5 h-2.5 text-gray-700 transition-opacity opacity-40 shrink-0 group-hover:opacity-70" viewBox="0 0 12 12" fill="currentColor"><circle cx="4" cy="3" r="1" /><circle cx="8" cy="3" r="1" /><circle cx="4" cy="6" r="1" /><circle cx="8" cy="6" r="1" /><circle cx="4" cy="9" r="1" /><circle cx="8" cy="9" r="1" /></svg>
                      <span className="w-4 text-right text-gray-700 tabular-nums text-[9px] shrink-0">{idx + 1}</span>
                      <span className="truncate">{f.trackTitle || f.fileName}</span>
                      {f.artist && <span className="truncate text-gray-700 max-w-[34%]">{f.artist}</span>}
                    </div>
                  ))}
                  {canShowMore && (
                    <button type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        const next = shown + 10
                        setShownCount((s) => ({ ...s, [item.id]: next }))
                        if (next > preview.tracks.length) onShowMore(item.id)
                      }}
                      className="mt-0.5 pl-4 text-[9px] text-gray-600 hover:text-accent transition-colors">
                      Show 10 more
                    </button>
                  )}
                </div>
              )
            })()}
          </div>
        )
      })}
    </>
  )
})

// --- Bipolar vertical slider for the Feel EQ (pointer-driven) --------------
// value ∈ [-1, 1]; center (0) = off. Fill runs from the center line to the
// handle: up = boost, down = cut. Snaps to center near the middle.
function VerticalSlider({ value, color, onChange }: {
  value: number
  color: string
  onChange: (v: number) => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const start = (e: React.PointerEvent): void => {
    e.preventDefault()
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || rect.height === 0) return
    const val = (cy: number): number => {
      let v = 1 - 2 * ((cy - rect.top) / rect.height)
      v = Math.max(-1, Math.min(1, v))
      return Math.abs(v) < 0.06 ? 0 : v
    }
    onChange(val(e.clientY))
    const move = (ev: PointerEvent): void => onChange(val(ev.clientY))
    const up = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const posPct = ((value + 1) / 2) * 100 // handle height from the bottom
  const fillBottom = Math.min(posPct, 50)
  const fillHeight = Math.abs(posPct - 50)
  return (
    <div ref={ref} onPointerDown={start} className="relative flex-1 min-h-0 overflow-hidden border rounded cursor-pointer select-none w-7 bg-surface-base border-surface-border touch-none">
      <div className="absolute inset-x-0 h-px bg-surface-border" style={{ bottom: '50%' }} />
      <div className="absolute inset-x-0" style={{ bottom: `${fillBottom}%`, height: `${fillHeight}%`, background: color, opacity: value >= 0 ? 0.9 : 0.5 }} />
      <div className="absolute inset-x-0 h-[2px]" style={{ bottom: `calc(${posPct}% - 1px)`, background: value === 0 ? '#6b6488' : '#fff' }} />
    </div>
  )
}
