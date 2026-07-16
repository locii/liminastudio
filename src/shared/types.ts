export type BreathworkPhase =
  | 'first-hour'
  | 'second-hour'
  | 'third-hour'
  | 'second-hour-transition'
  | 'third-hour-transition'
  | 'breakthrough'
  | 'jumpstart'
  | 'call-to-adventure'
  | 'breakthrough-tension'
  | 'breakthrough-release'

export const BREATHWORK_PHASES: { value: BreathworkPhase; label: string }[] = [
  { value: 'first-hour',               label: 'First Hour'               },
  { value: 'second-hour',              label: 'Second Hour'              },
  { value: 'third-hour',               label: 'Third Hour'               },
  { value: 'second-hour-transition',   label: 'Second Hour Transition'   },
  { value: 'third-hour-transition',    label: 'Third Hour Transition'    },
  { value: 'breakthrough',             label: 'Breakthrough'             },
  { value: 'jumpstart',                label: 'Jumpstart'                },
  { value: 'call-to-adventure',        label: 'Call to Adventure'        },
  { value: 'breakthrough-tension',     label: 'Breakthrough Tension'     },
  { value: 'breakthrough-release',     label: 'Breakthrough Release'     },
]

// Colors follow journey arc: green → amber → orange → red → blue → pale blue
export const PHASE_COLORS: Record<BreathworkPhase, string> = {
  'call-to-adventure':       '#7ac47a',
  'jumpstart':               '#9ec86e',
  'first-hour':              '#b8c46e',
  'second-hour-transition':  '#c8b46e',
  'second-hour':             '#c99a4e',
  'breakthrough-tension':    '#c96a3e',
  'breakthrough':            '#c43838',
  'breakthrough-release':    '#5b8fd4',
  'third-hour-transition':   '#7aaed4',
  'third-hour':              '#9ec8e0',
}

export function phaseColorForTag(tagName: string): string | null {
  const lower = tagName.toLowerCase()
  const phase = BREATHWORK_PHASES.find(
    (p) => p.label.toLowerCase() === lower || p.value === lower
  )
  return phase ? PHASE_COLORS[phase.value] : null
}

export interface WatchedFolder {
  id: string
  path: string
  label: string        // last path component
  fileCount: number
  lastScanned: string | null
}

export interface LibraryFile {
  id: string           // stable hash of filePath
  filePath: string
  fileName: string
  artist: string
  album: string
  /** Inferred from watched-folder path …/Artist/Album/ ; shown italic until Apply */
  artistPathGuess: string
  albumPathGuess: string
  /** Whether folder guesses were written into artist/album (confirmed in track panel). */
  appliedPathGuess: boolean
  folderPath: string
  duration: number     // seconds
  sampleRate: number
  channels: number
  format: string       // 'wav' | 'mp3' | 'flac' | 'aiff' | 'm4a'
  fileSize: number     // bytes
  tags: string[]
  /** Subset of `tags` that came from MFB (the "system" tags). Everything in
   *  `tags` not listed here is a user-added tag and is preserved across MFB
   *  syncs. Undefined on legacy files (treated as "all current tags are MFB"). */
  mfbTags?: string[]
  /** The MFB track's `updated_at` value as of the last successful resync. The
   *  incremental resync re-fetches a track only when the catalogue's current
   *  `updated_at` differs from this. Undefined until first synced. */
  mfbSyncedAt?: string
  rating: number       // 0–5
  notes: string
  breathworkPhase: BreathworkPhase | null
  dateAdded: string    // ISO
  peaks: number[]      // cached waveform peaks
  trackTitle: string      // MFB track title once applied; empty until then
  mfbTrackId: number | null  // MFB track ID once applied; null until then
  mfbIndexed: boolean  // whether this track has been searched against MFB
  mfbApplied: boolean  // whether an MFB match was applied to this track
  mfbMatchRejected: boolean  // user dismissed a pending match; skip auto re-indexing
  audioFeatures: MfbAudioFeatures | null
  audioFeaturesEstimated: boolean  // true when audioFeatures came from local Reccobeats analysis, not an MFB match
  featuresAnalyzed: boolean         // whether the local feature scan has attempted this file (avoids retry loops)
  albumImageUrl: string | null
  bandcampUrl: string | null
  beatportUrl: string | null
  appleMusicUrl: string | null
  introEndMs: number | null       // ms from start where intro ends; null = auto-detect on export
  outroStartMs: number | null     // ms from start where outro begins; null = auto-detect on export
  fadeInCurve: number   // 0 = cut, 0.5 = linear, 1.0 = exponential
  fadeOutCurve: number
  clipStartMs: number | null      // ms from file start where clip begins; null = file start
  clipEndMs: number | null        // ms from file start where clip ends; null = file end
  cuesAnalyzed: boolean           // whether the Auto-Mix cue scan has run (populates intro/outro)
}

export interface MfbTag { id: number; name: string; slug: { en: string } }

export interface MfbAudioFeatures {
  intensity: number
  activation_intensity: number
  affective_intensity: number
  tempo: number
  tempo_label: string
  energy: number
  energy_label: string
  valence: number
  valence_label: string
  danceability: number
  danceability_label: string
  spaciousness: number
  tension: number
}

export interface MfbMatch {
  id: number
  title: string
  slug?: string
  artists: { id: number; name: string }[]
  album: { id: number; title: string; image_url: string }
  audio_features?: MfbAudioFeatures
  tags: Record<string, MfbTag[]>
  description: string
  bandcamp_url?: string
  beatport_url?: string
  apple_music_url?: string
}

/** A Spotify search result shown in the import picker for the user to choose. */
export interface SpotifySearchCandidate {
  spotify_id: string
  title: string
  artist: string
  album: string
  image_url: string | null
  duration: number | null
}

/** The steering blob of a Session Mode preset — a SavedMix minus id/name/createdAt.
 *  `queue` items are MixQueueItem (typed loosely here to avoid a renderer dep). */
export interface SessionPresetPayload {
  queue: unknown[]
  mixTags: string[]
  mixMatchMode: 'any' | 'all'
  mixFeatureTargets: Record<string, number>
  mixFadeMs: number
  mixTailTags: string[] | null
}

/** A curated Session Mode preset served from MFB (GET /api/session-presets). */
export interface SessionPresetDTO {
  id: number
  name: string
  payload: SessionPresetPayload
  sort_order: number
  updated_at: string
}

export function appleMusicDeepLink(url: string): string {
  const lang = (typeof navigator !== 'undefined' ? navigator.language : undefined) || 'en-US'
  const m = lang.match(/[a-z]{2}-([A-Z]{2})/i)
  const country = m ? m[1].toLowerCase() : 'us'
  return url
    .replace(/(music\.apple\.com\/)[a-z]{2}(\/)/, `$1${country}$2`)
    .replace('https://', 'music://')
}

export function mfbTrackUrl(id: number, slugOrTitle: string): string {
  const slug = `${id}-${slugOrTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`
  return `https://musicforbreathwork.com/tracks/${slug}`
}

export interface MfbPlaylistTrack {
  id: number
  title: string
  artist: string
  duration: number  // milliseconds
  album_image_url?: string
  bandcamp_url?: string
  beatport_url?: string
  apple_music_url?: string
}

export interface MfbPlaylistSegment {
  id: number
  name: string
  order: number
  duration: number
  tracks: MfbPlaylistTrack[]
}

/** Lightweight list item returned by /user/playlists */
export interface MfbPlaylist {
  id: number
  title: string
  trackIds: number[]
  image_url?: string
}

/** Full playlist detail returned by /user/playlists/:id */
export interface MfbPlaylistDetail {
  id: number
  title: string
  description?: string
  segments: MfbPlaylistSegment[]
}

export interface PlaylistTrackSearchResult {
  id: number
  title: string
  artist: string
  album_image_url?: string
  duration: number  // milliseconds
  bandcamp_url?: string
  beatport_url?: string
  apple_music_url?: string
  playlists: { id: number; title: string }[]
}

export interface Catalogue {
  version: string
  watchedFolders: WatchedFolder[]
  files: LibraryFile[]
  removedFiles?: LibraryFile[]
  /** Maps MFB playlist ID → saved .limina file path */
  playlistSessions?: Record<number, string>
  /** Auto-Mix per-track fade-in points (file id → ms into the file). */
  mixFadeIns?: Record<string, number>
  /** Auto-Mix default crossfade length (ms). */
  mixFadeMs?: number
  /** Saved Auto-Mixes (queue templates + settings). Typed loosely to avoid a renderer dep. */
  savedMixes?: unknown[]
  /** Recorded Generate sessions (skeleton + realized tracklist). Typed loosely. */
  sessions?: unknown[]
}

export interface ScanResult {
  files: LibraryFile[]
  errors: string[]
}
