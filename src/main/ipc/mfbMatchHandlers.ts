import { ipcMain } from 'electron'
import { get, request } from 'https'
import { loadToken } from './authHandlers'

const BASE = 'https://musicforbreathwork.com/api'

interface CatalogueTrack {
  id: number
  title: string
  artist: string
  album: string
  slug?: string
  updated_at?: string | null
}

let catalogueCache: CatalogueTrack[] | null = null
let catalogueCacheTime = 0
let catalogueCacheAuthed = false
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

function fetchJson<T>(url: string, token?: string | null): Promise<T> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'Accept': 'application/json', 'User-Agent': 'LiminaLibrary/1.0' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    get(url, { headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf-8')
          const status = res.statusCode ?? 0
          if (status >= 400) {
            const retryAfter = res.headers['retry-after']
            const err = new Error(status === 401 ? 'NOT_AUTHENTICATED' : `HTTP ${status}`) as Error & {
              status?: number; retryAfter?: number
            }
            err.status = status
            if (retryAfter) err.retryAfter = Number(retryAfter)
            reject(err)
          } else {
            resolve(JSON.parse(raw) as T)
          }
        } catch (e) { reject(new Error(`JSON parse error: ${e}`)) }
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}

/**
 * Retry a request once on a 429, honoring the server's Retry-After (capped).
 * The MFB API rate-limits per user across all endpoints, so a burst of
 * background reads can briefly starve an interactive call.
 */
async function withRetry429<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const e = err as Error & { status?: number; retryAfter?: number }
    if (e.status !== 429) throw err
    const waitMs = Math.min((e.retryAfter || 2) * 1000, 20000)
    console.warn(`[mfb] 429 — retrying in ${waitMs}ms`)
    await new Promise((r) => setTimeout(r, waitMs))
    return fn()
  }
}

function postJson<T>(url: string, body: unknown, token?: string | null): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf-8')
    const u = new URL(url)
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Content-Length': String(payload.byteLength),
      'User-Agent': 'LiminaLibrary/1.0',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const req = request(
      { method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf-8')
            const status = res.statusCode ?? 0
            if (status >= 400) {
              const retryAfter = res.headers['retry-after']
              const detail = `${raw.slice(0, 300)}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}`
              const err = new Error(status === 401 ? 'NOT_AUTHENTICATED' : `HTTP ${status}: ${detail}`) as Error & {
                status?: number; retryAfter?: number
              }
              err.status = status
              if (retryAfter) err.retryAfter = Number(retryAfter)
              reject(err)
            } else {
              resolve((raw ? JSON.parse(raw) : {}) as T)
            }
          } catch (e) { reject(new Error(`JSON parse error: ${e}`)) }
        })
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function deleteJson<T>(url: string, token?: string | null): Promise<T> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const headers: Record<string, string> = { 'Accept': 'application/json', 'User-Agent': 'LiminaLibrary/1.0' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const req = request({ method: 'DELETE', hostname: u.hostname, path: u.pathname + u.search, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf-8')
          const status = res.statusCode ?? 0
          if (status >= 400) reject(new Error(status === 401 ? 'NOT_AUTHENTICATED' : `HTTP ${status}: ${raw.slice(0, 300)}`))
          else resolve((raw ? JSON.parse(raw) : {}) as T)
        } catch (e) { reject(new Error(`JSON parse error: ${e}`)) }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

async function getCatalogue(): Promise<CatalogueTrack[]> {
  const token = await loadToken()
  if (!token) throw new Error('NOT_AUTHENTICATED')
  // Bust cache if auth state changed (logged in/out since last fetch)
  if (catalogueCache && Date.now() - catalogueCacheTime < CACHE_TTL_MS && catalogueCacheAuthed) {
    return catalogueCache
  }
  console.log('[mfb] fetching catalogue (authenticated)...')
  catalogueCache = await fetchJson<CatalogueTrack[]>(`${BASE}/tracks`, token)
  catalogueCacheTime = Date.now()
  catalogueCacheAuthed = true
  console.log('[mfb] catalogue loaded:', catalogueCache.length, 'tracks')
  return catalogueCache
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'with'])

const GENERIC_FOLDER_TOKENS = new Set([
  'breathwork', 'imported', 'conformed', 'files', 'file', 'media', 'localized',
  'projects', 'project', 'session', 'sessions', 'mix', 'mixes',
  'library', 'audio', 'export', 'exports', 'backup', 'backups',
  'playlist', 'playlists', 'tracks', 'track', 'collection', 'redux',
  'hour', 'hours', 'volume', 'vol', 'set',
])

function isNameyFolder(name: string): boolean {
  if (!name.trim()) return false
  if (/\b(19|20)\d{2}\b/.test(name)) return false  // contains a year
  const tokens = normalize(name).split(' ').filter((t) => t.length > 1)
  if (tokens.length === 0) return false
  for (const t of tokens) if (GENERIC_FOLDER_TOKENS.has(t)) return false
  return true
}

function normalize(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .toLowerCase()
    .replace(/\.[^.]+$/, '')        // strip file extension
    .replace(/^\d+[\s._-]+/, '')    // strip leading track numbers
    .replace(/[^a-z0-9\s]/g, ' ')  // punctuation → space
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(s: string | null | undefined): Set<string> {
  return new Set(
    normalize(s)
      .split(' ')
      .filter((t) => t.length > 1 && !STOP.has(t))
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection++
  return intersection / (a.size + b.size - intersection)
}

interface MatchEntry {
  id: string
  filename: string
  artist: string
  folder_artist: string
  folder_album: string
}

function scoreMatch(entry: MatchEntry, track: CatalogueTrack): number {
  // Split the raw filename on " - " before normalizing so the dash isn't stripped first
  const rawBase = entry.filename.replace(/\.[^.]+$/, '')
  const rawParts = rawBase.split(/\s+-\s+/)
  const filenameArtistGuess = rawParts.length >= 2 ? rawParts[0] : ''
  const filenameTitlePart = rawParts.length >= 2 ? rawParts[rawParts.length - 1] : rawBase

  const fileTokens = tokenize(entry.filename)
  const titleOnlyTokens = rawParts.length >= 2 ? tokenize(filenameTitlePart) : fileTokens
  const trackTitleTokens = tokenize(track.title)
  const trackArtistTokens = tokenize(track.artist)
  const trackAlbumTokens = tokenize(track.album)

  const titleScore = Math.max(jaccard(fileTokens, trackTitleTokens), jaccard(titleOnlyTokens, trackTitleTokens))

  // ID3 artist always trusted; filename "Artist - Title" pattern used as fallback;
  // folder names only count if they look like real names
  const artistSources = [
    entry.artist,
    filenameArtistGuess,
    isNameyFolder(entry.folder_artist) ? entry.folder_artist : '',
  ].filter(Boolean)
  const hasArtistContext = artistSources.length > 0
  const artistScore = hasArtistContext
    ? Math.max(...artistSources.map((a) => jaccard(tokenize(a), trackArtistTokens)))
    : 0

  // Hard reject: title must match something
  if (titleScore === 0) return 0

  // Album context only counts when the folder name looks like a real album title
  const albumSource = isNameyFolder(entry.folder_album) ? entry.folder_album : ''
  const albumScore = albumSource ? jaccard(tokenize(albumSource), trackAlbumTokens) : 0

  // When we have artist context, weight it heavily — title alone isn't enough
  if (hasArtistContext) {
    if (artistScore === 0) {
      // Artist is completely wrong — cap below the auto-match threshold so it
      // still surfaces in manual ranked results but never gets auto-suggested
      return Math.min(titleScore * 0.45 + albumScore * 0.1, 0.22)
    }
    return titleScore * 0.45 + artistScore * 0.45 + albumScore * 0.1
  }
  return titleScore * 0.7 + artistScore * 0.2 + albumScore * 0.1
}

export function registerMfbMatchHandlers(): void {
  ipcMain.handle('mfb:catalogueSearch', async (_, query: string) => {
    const catalogue = await getCatalogue()
    const terms = query.toLowerCase().trim().split(/\s+/).filter((t) => t.length > 0)
    if (terms.length === 0) return []
    return catalogue
      .map((track) => {
        const haystack = `${track.title} ${track.artist} ${track.album}`.toLowerCase()
        const hits = terms.filter((t) => haystack.includes(t)).length
        return { ...track, hits }
      })
      .filter((r) => r.hits > 0)
      .sort((a, b) => b.hits - a.hits || a.title.localeCompare(b.title))
      .slice(0, 20)
      .map(({ hits: _, ...r }) => r)
  })

  ipcMain.handle('mfb:getTrack', async (_, id: number) => {
    const token = await loadToken()
    if (!token) throw new Error('NOT_AUTHENTICATED')
    return withRetry429(() => fetchJson(`${BASE}/tracks/${id}`, token))
  })

  ipcMain.handle('mfb:matchTracks', async (_, entries: MatchEntry[]) => {
    const catalogue = await getCatalogue() // throws NOT_AUTHENTICATED if no token
    const token = await loadToken()
    const THRESHOLD = 0.25

    return Promise.all(entries.map(async (entry) => {
      let bestScore = 0
      let bestTrack: CatalogueTrack | null = null
      for (const track of catalogue) {
        const score = scoreMatch(entry, track)
        if (score > bestScore) { bestScore = score; bestTrack = track }
      }
      console.log(
        '[mfb:match]',
        entry.filename,
        bestTrack && bestScore >= THRESHOLD ? `→ "${bestTrack.title}" (${bestScore.toFixed(2)})` : `no match (best: ${bestScore.toFixed(2)})`
      )
      if (bestScore < THRESHOLD || !bestTrack) return { id: entry.id, track: null, confidence: bestScore }

      try {
        const full = await fetchJson<{
          id: number; title: string; description: string; slug?: string
          artists: { id: number; name: string }[]
          album: { id: number; title: string; image_url: string }
          tags: Record<string, { id: number; name: string; slug: { en: string } }[]>
          audio_features?: Record<string, unknown>
        }>(`${BASE}/tracks/${bestTrack.id}`, token)
        return {
          id: entry.id,
          track: {
            id: full.id,
            title: full.title,
            slug: full.slug ?? bestTrack.slug ?? '',
            artists: full.artists,
            album: full.album,
            tags: full.tags,
            description: full.description ?? '',
            audio_features: full.audio_features,
          },
          confidence: bestScore,
        }
      } catch {
        return {
          id: entry.id,
          track: {
            id: bestTrack.id,
            title: bestTrack.title,
            slug: bestTrack.slug ?? '',
            artists: [{ id: 0, name: bestTrack.artist }],
            album: { id: 0, title: bestTrack.album, image_url: '' },
            tags: {},
            description: '',
          },
          confidence: bestScore,
        }
      }
    }))
  })

  ipcMain.handle('mfb:rankMatches', async (_, entry: MatchEntry) => {
    const catalogue = await getCatalogue()
    return catalogue
      .map((track) => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        score: scoreMatch(entry, track),
      }))
      .filter((r) => r.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
  })

  // Match a local file against Spotify (server-side) and mint it as a private,
  // user-owned catalogue track it can inherit real features from. Returns the
  // new/existing track id, or { id: null, reason } when there's no confident
  // duration-matched Spotify result (client falls back to its local estimate).
  // Free-text Spotify search (server-side), returning candidates in Spotify's
  // own relevance order for the user to pick from.
  ipcMain.handle('spotify:search', async (_, q: string) => {
    const token = await loadToken()
    if (!token) throw new Error('NOT_AUTHENTICATED')
    return withRetry429(() =>
      fetchJson<{
        candidates: { spotify_id: string; title: string; artist: string; album: string; image_url: string | null; duration: number | null }[]
        error?: string
      }>(`${BASE}/tracks/spotify-search?q=${encodeURIComponent(q)}`, token)
    )
  })

  ipcMain.handle(
    'spotify:import',
    async (_, entry: { spotify_id?: string; title?: string; artist?: string; album?: string; duration?: number }) => {
      const token = await loadToken()
      if (!token) throw new Error('NOT_AUTHENTICATED')
      try {
        return await withRetry429(() =>
          postJson<{ id: number | null; spotify_id?: string; enriching?: boolean; reason?: string }>(
            `${BASE}/tracks/import-from-spotify`,
            entry,
            token
          )
        )
      } catch (err) {
        console.error('[spotify:import] request error:', err instanceof Error ? err.message : err)
        throw err
      }
    }
  )

  ipcMain.handle('mfb:clearCatalogue', () => {
    catalogueCache = null
    catalogueCacheTime = 0
    catalogueCacheAuthed = false
  })

  // Curated Session Mode presets served from MFB. Reads are open to any signed-in
  // Limina user; writes are admin-only (enforced server-side, user 1).
  ipcMain.handle('presets:list', async () => {
    const token = await loadToken()
    try {
      return await withRetry429(() => fetchJson<unknown[]>(`${BASE}/session-presets`, token))
    } catch (e) {
      console.error('[presets:list] error:', e instanceof Error ? e.message : e)
      return []
    }
  })
  ipcMain.handle('presets:save', async (_, preset: { name: string; payload: unknown; sort_order?: number }) => {
    const token = await loadToken()
    return withRetry429(() => postJson(`${BASE}/session-presets`, preset, token))
  })
  ipcMain.handle('presets:delete', async (_, id: number) => {
    const token = await loadToken()
    return withRetry429(() => deleteJson(`${BASE}/session-presets/${id}`, token))
  })

  // Lightweight change-map for the renderer's incremental MFB resync:
  // { trackId: updated_at }. Reuses the hourly catalogue cache (no extra fetch).
  ipcMain.handle('mfb:getUpdatedMap', async () => {
    const catalogue = await getCatalogue()
    const map: Record<number, string> = {}
    for (const t of catalogue) if (t.updated_at) map[t.id] = t.updated_at
    return map
  })
}
