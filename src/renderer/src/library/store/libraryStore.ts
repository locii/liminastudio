import { create } from 'zustand'
import type { BreathworkPhase, Catalogue, LibraryFile, MfbMatch, MfbPlaylist, MfbPlaylistDetail, MfbTag, WatchedFolder, SessionPresetDTO } from '../types'
import type { MixEngineState } from '../lib/mixEngine'
import { reconcileTags } from '../lib/mfbTags'

/** One matched track's status during a background MFB resync pass. */
export interface MfbRefreshItem {
  fileId: string
  fileName: string
  title: string
  status: 'queued' | 'syncing' | 'synced' | 'failed'
}

function normalizeCurve(v: unknown): number {
  if (typeof v === 'number') {
    // Remap old 0-1 storage (0=cut, 0.5=linear, 1=slow) to Limina Mix -1..1 (0=linear, -1=slow, 1=fast)
    if (v >= 0 && v <= 1) return Math.max(-1, Math.min(1, 1 - v * 2))
    return Math.max(-1, Math.min(1, v))
  }
  if (v === 'exponential') return -0.8
  if (v === 'cut') return 0
  return 0  // 'linear' or missing
}

/** Earliest of two ISO date strings, ignoring empty/invalid ones. */
function earliestIso(a: string | undefined, b: string | undefined): string {
  const av = a && !Number.isNaN(Date.parse(a)) ? a : ''
  const bv = b && !Number.isNaN(Date.parse(b)) ? b : ''
  if (!av) return bv
  if (!bv) return av
  return Date.parse(av) <= Date.parse(bv) ? av : bv
}

function normalizeImportedFile(f: Catalogue['files'][number]): LibraryFile {
  return {
    ...f,
    artist: f.artist ?? '',
    album: f.album ?? '',
    artistPathGuess: f.artistPathGuess ?? '',
    albumPathGuess: f.albumPathGuess ?? '',
    appliedPathGuess: f.appliedPathGuess ?? false,
    trackTitle: f.trackTitle ?? '',
    mfbTrackId: f.mfbTrackId ?? null,
    mfbIndexed: f.mfbIndexed ?? false,
    mfbApplied: f.mfbApplied ?? false,
    mfbMatchRejected: f.mfbMatchRejected ?? false,
    mfbTags: f.mfbTags,
    mfbSyncedAt: f.mfbSyncedAt,
    audioFeatures: f.audioFeatures ?? null,
    audioFeaturesEstimated: f.audioFeaturesEstimated ?? false,
    featuresAnalyzed: f.featuresAnalyzed ?? false,
    bandcampUrl: f.bandcampUrl ?? null,
    beatportUrl: f.beatportUrl ?? null,
    appleMusicUrl: f.appleMusicUrl ?? null,
    introEndMs: f.introEndMs ?? null,
    outroStartMs: f.outroStartMs ?? null,
    fadeInCurve: normalizeCurve(f.fadeInCurve),
    fadeOutCurve: normalizeCurve(f.fadeOutCurve),
    clipStartMs: f.clipStartMs ?? null,
    clipEndMs: f.clipEndMs ?? null,
    cuesAnalyzed: f.cuesAnalyzed ?? false,
    dateAdded: f.dateAdded ?? '',
  }
}

export interface UserAccount {
  id: number
  name: string
  email: string
}

/** An entry in the Auto-Mix Up-Next queue. A tags item captures a feel-EQ
 *  snapshot (boost/cut weights, −1..1) alongside its tags, so it steers its own
 *  generation independently of the live EQ. */
export type MixQueueItem =
  // `fadeMs`/`startMs`/`holdMs` are optional overrides used to replay a recorded
  // session faithfully: crossfade length into it, file start offset, and how long
  // to play it before advancing (reproducing the session's timing).
  | { id: string; kind: 'track'; fileId: string; fadeMs?: number; startMs?: number; holdMs?: number }
  // `upcoming` is the materialised ordered list of track ids this generator will
  // play next — so the ghost preview and actual playback stay in sync.
  | { id: string; kind: 'tags'; tags: string[]; matchMode: 'any' | 'all'; feel: Record<string, number>; durationMin: number | null; upcoming: string[] }

let mixItemSeq = 0
const mixItemId = (): string => `mq_${Date.now().toString(36)}_${mixItemSeq++}`

/** A saved Auto-Mix: the queue template plus its steering settings. */
export interface SavedMix {
  id: string
  name: string
  createdAt: string
  queue: MixQueueItem[]
  mixTags: string[]
  mixMatchMode: 'any' | 'all'
  mixFeatureTargets: Record<string, number>
  mixFadeMs: number
  mixTailTags: string[] | null
}

/** One track as it actually played during a recorded session. */
export interface SessionPlayedTrack {
  atMs: number             // elapsed from session start when it began
  fileId: string
  title: string            // snapshot so it survives library edits
  artist: string
  fromTags: string[] | null // the generator/section it came from (tail tags at the time)
  startMs: number          // file offset this track started at (clip/fade-in/seek)
  fadeInMs: number         // crossfade length used to bring this track in (0 = hard start)
  playedMs: number         // how long it actually played (filled when the next track starts / on stop)
  ended: 'crossfade' | 'skip' | 'end' | null
}

/** A live change to the plan during a recorded session (human-readable). */
export interface SessionEdit {
  atMs: number
  summary: string
}

/** A recorded Auto-Mix session: the skeleton it began with + what actually happened. */
export interface MixSession {
  id: string
  name: string
  startedAt: string        // ISO wall clock
  durationMs: number
  skeleton: Omit<SavedMix, 'id' | 'name' | 'createdAt'>  // the plan at record start
  played: SessionPlayedTrack[]
  edits: SessionEdit[]
}

interface LibraryState {
  watchedFolders: WatchedFolder[]
  files: LibraryFile[]
  removedFiles: LibraryFile[]
  selectedFileId: string | null
  selectedFolderId: string | null  // null = show all
  /** Active tag filters (AND). Empty = no tag filter. */
  selectedTags: string[]
  scanning: boolean
  pendingMatches: Record<string, MfbMatch>
  userAccount: UserAccount | null
  showLoginModal: boolean
  playlists: MfbPlaylist[]
  selectedPlaylistId: number | null
  selectedPlaylistDetail: MfbPlaylistDetail | null
  selectedMissingTrackId: number | null
  playlistSessions: Record<number, string>

  // Actions
  setUserAccount: (user: UserAccount | null) => void
  setShowLoginModal: (show: boolean) => void
  setPlaylists: (playlists: MfbPlaylist[]) => void
  patchPlaylist: (id: number, updates: Partial<MfbPlaylist>) => void
  selectPlaylist: (id: number | null) => void
  setPlaylistDetail: (detail: MfbPlaylistDetail | null) => void
  selectMissingTrack: (id: number | null) => void
  setPlaylistSession: (playlistId: number, filePath: string) => void
  loadCatalogue: (catalogue: Catalogue) => void
  addWatchedFolder: (folder: WatchedFolder) => void
  removeWatchedFolder: (id: string) => void
  addFiles: (files: LibraryFile[]) => void
  updateFile: (id: string, updates: Partial<LibraryFile>) => void
  removeFile: (id: string) => void
  restoreFile: (id: string) => void
  selectFile: (id: string | null) => void
  selectFolder: (id: string | null) => void
  showFileInLibrary: (folderId: string | null, fileId: string) => void
  selectTag: (tag: string) => void
  toggleSelectedTag: (tag: string) => void
  clearSelectedTags: () => void
  setScanning: (scanning: boolean) => void
  setPendingMatch: (fileId: string, match: MfbMatch) => void
  applyPendingMatch: (fileId: string) => void
  clearPendingMatch: (fileId: string) => void
  applyAllPendingMatches: () => void
  unlinkMfb: (fileId: string) => void
  resetUnmatchedIndexing: () => void
  resetAllIndexing: () => void
  toCatalogue: () => Catalogue
  unmatchedOnly: boolean
  setUnmatchedOnly: (v: boolean) => void
  loginFlash: boolean
  setLoginFlash: (v: boolean) => void
  previewFileId: string | null
  previewQueue: string[]
  setPreview: (fileId: string | null, queue: string[]) => void
  removeFiles: (ids: string[]) => void
  playlistTrackQuery: string
  setPlaylistTrackQuery: (q: string) => void

  // Auto-Mix (tag-driven crossfading queue). Advanced feature, MFB account only.
  mixMode: boolean
  mixTags: string[]
  /** 'any' = file matches if it has any mix tag (union); 'all' = must have every tag. */
  mixMatchMode: 'any' | 'all'
  enterMixMode: () => void
  exitMixMode: () => void
  addMixTag: (tag: string) => void
  removeMixTag: (tag: string) => void
  clearMixTags: () => void
  setMixMatchMode: (mode: 'any' | 'all') => void
  /** Per-track fade-in start point (ms into the file) for Auto-Mix, keyed by file id. */
  mixFadeIns: Record<string, number>
  setMixFadeIn: (fileId: string, ms: number) => void
  clearMixFadeIn: (fileId: string) => void
  /** Default crossfade length (ms) for Auto-Mix. */
  mixFadeMs: number
  setMixFadeMs: (ms: number) => void
  /** 4-band "feel" EQ: target value (0–1) per audio-feature key. Presence = an
   *  active band. Soft — steers/ranks the random pick, never a hard filter. */
  mixFeatureTargets: Record<string, number>
  setMixFeatureTarget: (key: string, value: number) => void
  toggleMixFeatureTarget: (key: string) => void
  clearMixFeatureTargets: () => void
  /** Explicit Up-Next queue: ordered specific tracks and/or tag-group generators. */
  mixQueue: MixQueueItem[]
  addQueueTrack: (fileId: string) => void
  addQueueTags: (tags: string[], matchMode: 'any' | 'all', feel: Record<string, number>) => void
  /** Prepend a tag-group so it becomes the active queue front. */
  addQueueTagsFront: (tags: string[], matchMode: 'any' | 'all', feel: Record<string, number>) => void
  setQueueItemMatch: (id: string, matchMode: 'any' | 'all') => void
  setQueueItemDuration: (id: string, durationMin: number | null) => void
  setQueueItemUpcoming: (id: string, upcoming: string[]) => void
  removeQueueItem: (id: string) => void
  moveQueueItem: (fromId: string, toId: string) => void
  clearQueue: () => void
  dequeueFront: () => void
  /** Track ids already played this session — excluded from generator re-picks so
   *  no track repeats within a session. Reset when the queue is cleared/replaced. */
  playedIds: Set<string>
  markPlayed: (id: string) => void
  resetPlayed: () => void
  /** Drop all queue items before `id` (jump the queue to that item). */
  dropQueueBefore: (id: string) => void
  /** Tags of the most-recently-used tag group, driving the tail once the queue empties. */
  mixTailTags: string[] | null
  setMixTailTags: (tags: string[] | null) => void
  /** Saved mixes (queue templates + settings), persisted in the catalogue. */
  savedMixes: SavedMix[]
  saveMix: (name: string) => void
  loadMix: (id: string) => void
  deleteMix: (id: string) => void
  /** Curated system presets served from MFB (not persisted; refetched per session). */
  systemPresets: SavedMix[]
  loadSystemPresets: () => Promise<void>
  /** Recorded sessions (skeleton + realized tracklist), persisted in the catalogue. */
  mixSessions: MixSession[]
  addMixSession: (session: MixSession) => void
  deleteMixSession: (id: string) => void
  /** Turn a recorded session's realized tracklist into a reusable session template. */
  saveSessionAsTemplate: (id: string, name: string) => void
  /** Load a session's exact played tracklist into the queue to replay it. */
  loadSession: (id: string) => void
  /** Live recording status (null = not recording); mirrored from the session recorder. */
  recording: { startedAt: number; trackCount: number } | null
  setRecording: (r: { startedAt: number; trackCount: number } | null) => void
  /** Progress of the manual/background cue-point scan. */
  cueScan: { running: boolean; done: number; total: number }
  setCueScan: (p: { running: boolean; done: number; total: number }) => void
  /** Progress of the background audio-feature scan (Reccobeats). */
  featureScan: { running: boolean; done: number; total: number }
  setFeatureScan: (p: { running: boolean; done: number; total: number }) => void
  /** Progress + per-track log of the background MFB resync (audio features +
   *  system tags for matched tracks). Drives the "Syncing" pill and its log modal. */
  mfbRefresh: { running: boolean; done: number; total: number; items: MfbRefreshItem[] }
  setMfbRefresh: (p: { running: boolean; done: number; total: number; items: MfbRefreshItem[] }) => void
  /** Live playback state pushed from the persistent mix engine. */
  mixPlayback: MixEngineState
  setMixPlayback: (s: MixEngineState) => void
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  watchedFolders: [],
  files: [],
  removedFiles: [],
  selectedFileId: null,
  selectedFolderId: null,
  selectedTags: [],
  scanning: false,
  pendingMatches: {},
  userAccount: null,
  showLoginModal: false,
  playlists: [],
  selectedPlaylistId: null,
  selectedPlaylistDetail: null,
  selectedMissingTrackId: null,
  playlistSessions: {},
  unmatchedOnly: false,
  setUnmatchedOnly: (v) => set({ unmatchedOnly: v }),
  loginFlash: false,
  setLoginFlash: (v) => set({ loginFlash: v }),
  previewFileId: null,
  previewQueue: [],
  playlistTrackQuery: '',

  setUserAccount: (user) => set({ userAccount: user }),
  setShowLoginModal: (show) => set({ showLoginModal: show }),
  setPlaylists: (playlists) => set({ playlists }),
  patchPlaylist: (id, updates) => set((s) => ({
    playlists: s.playlists.map((p) => p.id === id ? { ...p, ...updates } : p),
  })),
  selectPlaylist: (id) => set({ selectedPlaylistId: id, selectedPlaylistDetail: null, selectedFolderId: null, selectedTags: [], selectedFileId: null, selectedMissingTrackId: null, unmatchedOnly: false }),
  setPlaylistDetail: (detail) => set({ selectedPlaylistDetail: detail }),
  selectMissingTrack: (id) => set({ selectedMissingTrackId: id, selectedFileId: null }),

  setPlaylistSession: (playlistId, filePath) => set((s) => ({
    playlistSessions: { ...s.playlistSessions, [playlistId]: filePath },
  })),

  loadCatalogue: (catalogue) => set({
    watchedFolders: catalogue.watchedFolders,
    files: catalogue.files.map(normalizeImportedFile),
    removedFiles: (catalogue.removedFiles ?? []).map(normalizeImportedFile),
    playlistSessions: catalogue.playlistSessions ?? {},
    mixFadeIns: catalogue.mixFadeIns ?? {},
    mixFadeMs: catalogue.mixFadeMs ?? 20000,
    savedMixes: (catalogue.savedMixes as SavedMix[] | undefined) ?? [],
    mixSessions: (catalogue.sessions as MixSession[] | undefined) ?? [],
  }),

  addWatchedFolder: (folder) => set((s) => ({
    watchedFolders: [...s.watchedFolders.filter((f) => f.id !== folder.id), folder],
  })),

  removeWatchedFolder: (id) => set((s) => ({
    watchedFolders: s.watchedFolders.filter((f) => f.id !== id),
    files: s.files.filter((f) => {
      const folder = s.watchedFolders.find((w) => w.id === id)
      return !folder || !f.filePath.startsWith(folder.path)
    }),
    selectedFolderId: s.selectedFolderId === id ? null : s.selectedFolderId,
  })),

  addFiles: (incoming) => set((s) => {
    const removedIds = new Set(s.removedFiles.map((f) => f.id))
    const existing = new Map(s.files.map((f) => [f.id, f]))
    for (const f of incoming) {
      if (removedIds.has(f.id)) continue
      const prev = existing.get(f.id)
      if (!prev) { existing.set(f.id, f); continue }
      const guessesUnchanged =
        prev.artistPathGuess === f.artistPathGuess &&
        prev.albumPathGuess === f.albumPathGuess
      // Update fresh file metadata; preserve all user-curated and MFB data
      existing.set(f.id, {
        ...prev,
        filePath: f.filePath,
        fileName: f.fileName,
        folderPath: f.folderPath,
        duration: f.duration,
        sampleRate: f.sampleRate,
        channels: f.channels,
        format: f.format,
        fileSize: f.fileSize,
        artistPathGuess: f.artistPathGuess,
        albumPathGuess: f.albumPathGuess,
        appliedPathGuess: guessesUnchanged ? prev.appliedPathGuess : false,
        // Backfill "date added" from the file's creation date on rescan.
        // Keep the earliest known value so it doesn't jump around if the
        // file is later copied/moved (which resets birthtime).
        dateAdded: earliestIso(prev.dateAdded, f.dateAdded),
      })
    }
    return { files: [...existing.values()] }
  }),

  updateFile: (id, updates) => set((s) => ({
    files: s.files.map((f) => f.id === id ? { ...f, ...updates } : f),
  })),

  removeFile: (id) => set((s) => {
    const file = s.files.find((f) => f.id === id)
    return {
      files: s.files.filter((f) => f.id !== id),
      removedFiles: file ? [...s.removedFiles, file] : s.removedFiles,
      selectedFileId: s.selectedFileId === id ? null : s.selectedFileId,
    }
  }),

  restoreFile: (id) => set((s) => {
    const file = s.removedFiles.find((f) => f.id === id)
    if (!file) return {}
    return {
      removedFiles: s.removedFiles.filter((f) => f.id !== id),
      files: [...s.files, file],
    }
  }),

  selectFile: (id) => set({ selectedFileId: id, selectedMissingTrackId: null }),

  selectFolder: (id) => set({ selectedFolderId: id, selectedTags: [], selectedFileId: null, selectedPlaylistId: null, unmatchedOnly: false }),

  showFileInLibrary: (folderId, fileId) => set({ selectedFolderId: folderId, selectedFileId: fileId, selectedPlaylistId: null, selectedMissingTrackId: null, selectedTags: [], unmatchedOnly: false }),

  selectTag: (tag) => set((s) => ({
    selectedTags: s.selectedTags.length === 1 && s.selectedTags[0] === tag ? [] : [tag],
    selectedFolderId: null,
    selectedFileId: null,
    selectedPlaylistId: null,
    unmatchedOnly: false,
  })),

  toggleSelectedTag: (tag) => set((s) => {
    const i = s.selectedTags.indexOf(tag)
    const selectedTags = i >= 0
      ? s.selectedTags.filter((t) => t !== tag)
      : [...s.selectedTags, tag]
    return { selectedTags, selectedFolderId: null, selectedFileId: null, selectedPlaylistId: null }
  }),

  clearSelectedTags: () => set({ selectedTags: [] }),

  mixMode: false,
  mixTags: [],
  mixMatchMode: 'any',
  enterMixMode: () => set({
    mixMode: true,
    selectedPlaylistId: null,
    selectedPlaylistDetail: null,
    selectedMissingTrackId: null,
    selectedFileId: null,
    playlistTrackQuery: '',
  }),
  exitMixMode: () => set({ mixMode: false, selectedFileId: null }),
  addMixTag: (tag) => set((s) => (
    s.mixTags.includes(tag) ? {} : { mixTags: [...s.mixTags, tag] }
  )),
  removeMixTag: (tag) => set((s) => ({ mixTags: s.mixTags.filter((t) => t !== tag) })),
  clearMixTags: () => set({ mixTags: [] }),
  setMixMatchMode: (mode) => set({ mixMatchMode: mode }),
  mixFadeIns: {},
  setMixFadeIn: (fileId, ms) => set((s) => ({ mixFadeIns: { ...s.mixFadeIns, [fileId]: ms } })),
  clearMixFadeIn: (fileId) => set((s) => {
    const next = { ...s.mixFadeIns }; delete next[fileId]; return { mixFadeIns: next }
  }),
  mixFadeMs: 20000,
  setMixFadeMs: (ms) => set({ mixFadeMs: ms }),
  // Boost/cut weight per band, −1..1. Center (≈0) disengages the band.
  mixFeatureTargets: {},
  setMixFeatureTarget: (key, value) => set((s) => {
    const next = { ...s.mixFeatureTargets }
    if (Math.abs(value) < 0.02) delete next[key]; else next[key] = value
    return { mixFeatureTargets: next }
  }),
  toggleMixFeatureTarget: (key) => set((s) => {
    const next = { ...s.mixFeatureTargets }
    if (key in next) delete next[key]; else next[key] = 0
    return { mixFeatureTargets: next }
  }),
  clearMixFeatureTargets: () => set({ mixFeatureTargets: {} }),
  mixQueue: [],
  addQueueTrack: (fileId) => set((s) => ({ mixQueue: [...s.mixQueue, { id: mixItemId(), kind: 'track', fileId }] })),
  addQueueTags: (tags, matchMode, feel) => set((s) => (
    tags.length === 0 && Object.keys(feel).length === 0 ? {}
      : { mixQueue: [...s.mixQueue, { id: mixItemId(), kind: 'tags', tags: [...tags], matchMode, feel: { ...feel }, durationMin: null, upcoming: [] }] }
  )),
  addQueueTagsFront: (tags, matchMode, feel) => set((s) => (
    tags.length === 0 && Object.keys(feel).length === 0 ? {}
      : { mixQueue: [{ id: mixItemId(), kind: 'tags', tags: [...tags], matchMode, feel: { ...feel }, durationMin: null, upcoming: [] }, ...s.mixQueue] }
  )),
  setQueueItemMatch: (id, matchMode) => set((s) => ({
    mixQueue: s.mixQueue.map((q) => (q.id === id && q.kind === 'tags' ? { ...q, matchMode, upcoming: [] } : q)),
  })),
  setQueueItemDuration: (id, durationMin) => set((s) => ({
    mixQueue: s.mixQueue.map((q) => (q.id === id && q.kind === 'tags' ? { ...q, durationMin } : q)),
  })),
  setQueueItemUpcoming: (id, upcoming) => set((s) => ({
    mixQueue: s.mixQueue.map((q) => (q.id === id && q.kind === 'tags' ? { ...q, upcoming } : q)),
  })),
  removeQueueItem: (id) => set((s) => ({ mixQueue: s.mixQueue.filter((i) => i.id !== id) })),
  moveQueueItem: (fromId, toId) => set((s) => {
    const q = s.mixQueue.slice()
    const from = q.findIndex((i) => i.id === fromId)
    const to = q.findIndex((i) => i.id === toId)
    if (from < 0 || to < 0 || from === to) return {}
    const [m] = q.splice(from, 1)
    q.splice(to, 0, m)
    return { mixQueue: q }
  }),
  clearQueue: () => set({ mixQueue: [], playedIds: new Set() }),
  dequeueFront: () => set((s) => ({ mixQueue: s.mixQueue.slice(1) })),
  playedIds: new Set(),
  markPlayed: (id) => set((s) => (s.playedIds.has(id) ? {} : { playedIds: new Set(s.playedIds).add(id) })),
  resetPlayed: () => set({ playedIds: new Set() }),
  dropQueueBefore: (id) => set((s) => {
    const i = s.mixQueue.findIndex((q) => q.id === id)
    return i > 0 ? { mixQueue: s.mixQueue.slice(i) } : {}
  }),
  mixTailTags: null,
  setMixTailTags: (tags) => set({ mixTailTags: tags }),
  savedMixes: [],
  saveMix: (name) => set((s) => ({
    savedMixes: [
      ...s.savedMixes,
      {
        id: mixItemId(), name, createdAt: new Date().toISOString(),
        queue: s.mixQueue, mixTags: s.mixTags, mixMatchMode: s.mixMatchMode,
        mixFeatureTargets: s.mixFeatureTargets, mixFadeMs: s.mixFadeMs, mixTailTags: s.mixTailTags,
      },
    ],
  })),
  loadMix: (id) => set((s) => {
    const m = s.savedMixes.find((x) => x.id === id) ?? s.systemPresets.find((x) => x.id === id)
    if (!m) return {}
    // System presets are shared and can be loaded repeatedly: regenerate queue-item
    // ids and reset upcoming so ids never clash and tag groups re-materialise against
    // the current library. User templates load as-is.
    const isSystem = s.systemPresets.some((x) => x.id === m.id)
    const queue: MixQueueItem[] = isSystem
      ? m.queue.map((it) => (it.kind === 'tags' ? { ...it, id: mixItemId(), upcoming: [] } : { ...it, id: mixItemId() }))
      : m.queue
    return {
      mixQueue: queue, mixTags: m.mixTags, mixMatchMode: m.mixMatchMode,
      mixFeatureTargets: m.mixFeatureTargets, mixFadeMs: m.mixFadeMs, mixTailTags: m.mixTailTags,
      playedIds: new Set<string>(),
    }
  }),
  deleteMix: (id) => set((s) => ({ savedMixes: s.savedMixes.filter((x) => x.id !== id) })),
  systemPresets: [],
  loadSystemPresets: async () => {
    try {
      const dtos = await window.electronAPI.listSystemPresets()
      // Map the server DTO to the SavedMix shape the queue/dropdown already speaks.
      const presets: SavedMix[] = dtos.map((d: SessionPresetDTO) => ({
        id: `srv_${d.id}`,
        name: d.name,
        createdAt: d.updated_at,
        queue: (d.payload.queue as MixQueueItem[]) ?? [],
        mixTags: d.payload.mixTags ?? [],
        mixMatchMode: d.payload.mixMatchMode ?? 'any',
        mixFeatureTargets: d.payload.mixFeatureTargets ?? {},
        mixFadeMs: d.payload.mixFadeMs ?? 0,
        mixTailTags: d.payload.mixTailTags ?? null,
      }))
      set({ systemPresets: presets })
    } catch (e) {
      console.error('[loadSystemPresets] failed', e)
    }
  },
  mixSessions: [],
  addMixSession: (session) => set((s) => ({ mixSessions: [session, ...s.mixSessions] })),
  deleteMixSession: (id) => set((s) => ({ mixSessions: s.mixSessions.filter((x) => x.id !== id) })),
  saveSessionAsTemplate: (id, name) => set((s) => {
    const sess = s.mixSessions.find((x) => x.id === id)
    if (!sess) return {}
    // The template = the general frame (tag-generators + explicitly-added tracks),
    // NOT the realized tracklist. Fresh ids; tag groups re-materialise on load.
    const queue: MixQueueItem[] = sess.skeleton.queue.map((it) =>
      it.kind === 'tags' ? { ...it, id: mixItemId(), upcoming: [] } : { ...it, id: mixItemId() },
    )
    return {
      savedMixes: [
        ...s.savedMixes,
        {
          id: mixItemId(), name, createdAt: new Date().toISOString(), queue,
          mixTags: sess.skeleton.mixTags, mixMatchMode: sess.skeleton.mixMatchMode,
          mixFeatureTargets: sess.skeleton.mixFeatureTargets, mixFadeMs: sess.skeleton.mixFadeMs,
          mixTailTags: sess.skeleton.mixTailTags,
        },
      ],
    }
  }),
  loadSession: (id) => set((s) => {
    const sess = s.mixSessions.find((x) => x.id === id)
    if (!sess) return {}
    // Replay = the exact played order as explicit track items (so it reproduces
    // the session, not the tag frame), each carrying its recorded crossfade length
    // and start offset so the engine reproduces the actual transitions.
    const queue: MixQueueItem[] = sess.played.map((p) => ({
      id: mixItemId(), kind: 'track', fileId: p.fileId,
      fadeMs: p.fadeInMs ?? undefined, startMs: p.startMs || undefined,
      // Only hold (force-advance) tracks that were actually followed by a
      // transition — the final track (ended by stopping) should ride out.
      holdMs: (p.ended === 'crossfade' || p.ended === 'skip') ? (p.playedMs || undefined) : undefined,
    }))
    return { mixQueue: queue, mixFadeMs: sess.skeleton.mixFadeMs, mixTailTags: null, playedIds: new Set<string>() }
  }),
  recording: null,
  setRecording: (r) => set({ recording: r }),
  cueScan: { running: false, done: 0, total: 0 },
  setCueScan: (p) => set({ cueScan: p }),
  featureScan: { running: false, done: 0, total: 0 },
  setFeatureScan: (p) => set({ featureScan: p }),
  mfbRefresh: { running: false, done: 0, total: 0, items: [] },
  setMfbRefresh: (p) => set({ mfbRefresh: p }),
  mixPlayback: { playing: false, current: null, currentTime: 0, duration: 0, fading: false, outgoing: null, fadeElapsedMs: 0, fadeDurationMs: 0 },
  setMixPlayback: (s) => set({ mixPlayback: s }),

  setScanning: (scanning) => set({ scanning }),

  setPendingMatch: (fileId, match) => set((s) => ({
    pendingMatches: { ...s.pendingMatches, [fileId]: match },
  })),

  applyPendingMatch: (fileId) => set((s) => {
    const match = s.pendingMatches[fileId]
    if (!match) return {}
    const { [fileId]: _, ...rest } = s.pendingMatches
    const artist = (match.artists ?? []).map((a: { name: string }) => a.name).join(', ')
    const allTags: MfbTag[] = ([] as MfbTag[]).concat(...Object.values(match.tags ?? {}))
    const freshMfbTags = allTags.map((t) => t.name)
    const hourTag = match.tags['Hour']?.[0]
    return {
      pendingMatches: rest,
      files: s.files.map((f) =>
        f.id === fileId
          ? { ...f, artist, album: match.album.title, ...reconcileTags(f.tags, f.mfbTags, freshMfbTags), notes: match.description ?? '',
              trackTitle: match.title,
              mfbTrackId: match.id,
              mfbApplied: true,
              appliedPathGuess: true,
              albumImageUrl: match.album.image_url ?? null,
              // Real MFB features win; otherwise keep any local estimate rather than wiping it.
              audioFeatures: match.audio_features ?? f.audioFeatures,
              audioFeaturesEstimated: match.audio_features ? false : f.audioFeaturesEstimated,
              bandcampUrl: match.bandcamp_url ?? null,
              beatportUrl: match.beatport_url ?? null,
              appleMusicUrl: match.apple_music_url ?? null,
              ...(hourTag ? { breathworkPhase: hourTag.slug.en as BreathworkPhase } : {}) }
          : f
      ),
    }
  }),

  clearPendingMatch: (fileId) => set((s) => {
    const { [fileId]: _, ...rest } = s.pendingMatches
    return {
      pendingMatches: rest,
      files: s.files.map((f) => f.id === fileId ? { ...f, mfbMatchRejected: true } : f),
    }
  }),

  applyAllPendingMatches: () => set((s) => {
    const entries = Object.entries(s.pendingMatches)
    if (entries.length === 0) return {}
    const updatedFiles = s.files.map((f) => {
      const match = s.pendingMatches[f.id]
      if (!match) return f
      const artist = (match.artists ?? []).map((a: { name: string }) => a.name).join(', ')
      const allTags: MfbTag[] = ([] as MfbTag[]).concat(...Object.values(match.tags ?? {}))
      const freshMfbTags = allTags.map((t) => t.name)
      const hourTag = (match.tags ?? {})['Hour']?.[0]
      return {
        ...f, artist, album: match.album?.title ?? '', ...reconcileTags(f.tags, f.mfbTags, freshMfbTags), notes: match.description ?? '',
        trackTitle: match.title, mfbTrackId: match.id, mfbApplied: true, appliedPathGuess: true,
        albumImageUrl: match.album.image_url ?? null,
        // Real MFB features win; otherwise keep any local estimate rather than wiping it.
        audioFeatures: match.audio_features ?? f.audioFeatures,
        audioFeaturesEstimated: match.audio_features ? false : f.audioFeaturesEstimated,
        bandcampUrl: match.bandcamp_url ?? null,
        beatportUrl: match.beatport_url ?? null,
        appleMusicUrl: match.apple_music_url ?? null,
        ...(hourTag ? { breathworkPhase: hourTag.slug.en as BreathworkPhase } : {}),
      }
    })
    return { files: updatedFiles, pendingMatches: {} }
  }),

  unlinkMfb: (fileId) => set((s) => ({
    files: s.files.map((f) =>
      f.id === fileId
        ? {
            ...f,
            mfbTrackId: null,
            mfbApplied: false,
            mfbIndexed: false,
            mfbMatchRejected: false,
            trackTitle: '',
            breathworkPhase: null,
            tags: [],
            mfbTags: undefined,
            mfbSyncedAt: undefined,
            audioFeatures: null,
            bandcampUrl: null,
            beatportUrl: null,
            appleMusicUrl: null,
            notes: '',
          }
        : f
    ),
  })),

  resetUnmatchedIndexing: () => set((s) => ({
    files: s.files.map((f) =>
      !f.mfbTrackId && !f.mfbMatchRejected && !s.pendingMatches[f.id] ? { ...f, mfbIndexed: false } : f
    ),
  })),

  resetAllIndexing: () => set((s) => ({
    pendingMatches: {},
    files: s.files.map((f) => ({
      ...f,
      mfbTrackId: null,
      mfbApplied: false,
      mfbIndexed: false,
      mfbMatchRejected: false,
      trackTitle: '',
      breathworkPhase: null,
      tags: [],
      mfbTags: undefined,
      mfbSyncedAt: undefined,
      audioFeatures: null,
      bandcampUrl: null,
      beatportUrl: null,
      appleMusicUrl: null,
      notes: '',
    })),
  })),

  toCatalogue: () => ({
    version: '0.1.0',
    watchedFolders: get().watchedFolders,
    files: get().files.map((f) => ({ ...f, peaks: [] })),
    removedFiles: get().removedFiles.map((f) => ({ ...f, peaks: [] })),
    playlistSessions: get().playlistSessions,
    mixFadeIns: get().mixFadeIns,
    mixFadeMs: get().mixFadeMs,
    savedMixes: get().savedMixes,
    sessions: get().mixSessions,
  }),

  setPreview: (fileId, queue) => set({ previewFileId: fileId, previewQueue: fileId === null ? [] : queue }),
  setPlaylistTrackQuery: (q) => set({ playlistTrackQuery: q }),

  removeFiles: (ids) => set((s) => {
    const idSet = new Set(ids)
    const removed = s.files.filter((f) => idSet.has(f.id))
    return {
      files: s.files.filter((f) => !idSet.has(f.id)),
      removedFiles: [...s.removedFiles, ...removed],
      selectedFileId: idSet.has(s.selectedFileId ?? '') ? null : s.selectedFileId,
    }
  }),
}))
