import { ipcMain, safeStorage, app } from 'electron'
import { get, request } from 'https'
import { join } from 'path'
import { promises as fs } from 'fs'

const BASE = 'https://musicforbreathwork.com/api'
const TOKEN_FILE = join(app.getPath('userData'), 'auth.bin')

async function saveToken(token: string): Promise<void> {
  const encrypted = safeStorage.encryptString(token)
  await fs.writeFile(TOKEN_FILE, encrypted)
}

export async function loadToken(): Promise<string | null> {
  try {
    const encrypted = await fs.readFile(TOKEN_FILE)
    return safeStorage.decryptString(encrypted)
  } catch {
    return null
  }
}

async function clearToken(): Promise<void> {
  try { await fs.unlink(TOKEN_FILE) } catch { /* already gone */ }
}

function apiPost<T>(path: string, body: unknown, token?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf-8')
    const parsed = new URL(`${BASE}${path}`)
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Content-Length': payload.length,
      'Accept': 'application/json',
      'User-Agent': 'LiminaLibrary/1.0',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const req = request(
      { hostname: parsed.hostname, path: parsed.pathname, method: 'POST', headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8')
          if (res.statusCode && res.statusCode >= 400) {
            try {
              const err = JSON.parse(body)
              reject(new Error(err.message ?? `HTTP ${res.statusCode}`))
            } catch {
              reject(new Error(`HTTP ${res.statusCode}`))
            }
            return
          }
          try { resolve(JSON.parse(body) as T) } catch (e) { reject(e) }
        })
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function apiGet<T>(path: string, token: string): Promise<T> {
  return new Promise((resolve, reject) => {
    get(
      `${BASE}${path}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'LiminaLibrary/1.0',
          'Authorization': `Bearer ${token}`,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8')
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`))
            return
          }
          try { resolve(JSON.parse(body) as T) } catch (e) { reject(e) }
        })
        res.on('error', reject)
      }
    ).on('error', reject)
  })
}

export interface AuthUser {
  id: number
  name: string
  email: string
}

export function registerAuthHandlers(): void {
  ipcMain.handle('auth:login', async (_, email: string, password: string) => {
    const result = await apiPost<{ token: string; user: AuthUser }>('/auth/login', { email, password })
    await saveToken(result.token)
    return result.user
  })

  ipcMain.handle('auth:logout', async () => {
    const token = await loadToken()
    if (token) {
      try { await apiPost('/auth/logout', {}, token) } catch { /* ignore if token already invalid */ }
    }
    await clearToken()
  })

  ipcMain.handle('auth:me', async () => {
    const token = await loadToken()
    if (!token) return null
    try {
      return await apiGet<AuthUser>('/auth/me', token)
    } catch {
      return null
    }
  })

  ipcMain.handle('auth:getUserPlaylists', async () => {
    const token = await loadToken()
    if (!token) return []
    try {
      const res = await apiGet<unknown>('/user/playlists', token)
      console.log('[auth:getUserPlaylists] raw response:', JSON.stringify(res).slice(0, 400))
      // Handle both bare array and object-wrapped { data: [...] } / { playlists: [...] }
      const arr: unknown[] = Array.isArray(res)
        ? res
        : Array.isArray((res as Record<string, unknown>)['data'])
          ? (res as Record<string, unknown>)['data'] as unknown[]
          : Array.isArray((res as Record<string, unknown>)['playlists'])
            ? (res as Record<string, unknown>)['playlists'] as unknown[]
            : []
      return arr.map((p) => {
        const pl = p as Record<string, unknown>
        return {
          id: pl['id'] as number,
          title: (pl['title'] ?? pl['name']) as string,
          trackIds: (pl['track_ids'] ?? pl['trackIds'] ?? []) as number[],
          image_url: (pl['image_url'] ?? pl['cover_image_url'] ?? pl['cover'] ?? pl['thumbnail_url'] ?? undefined) as string | undefined,
        }
      })
    } catch (err) {
      console.error('[auth:getUserPlaylists] error:', err)
      return []
    }
  })

  ipcMain.handle('auth:searchPlaylistTracks', async (_, query: string) => {
    const token = await loadToken()
    if (!token) return []
    try {
      const res = await apiGet<unknown>(
        `/user/playlists/tracks/search?q=${encodeURIComponent(query)}`, token
      )
      console.log('[auth:searchPlaylistTracks] raw response:', JSON.stringify(res).slice(0, 500))
      const arr: unknown[] = Array.isArray(res)
        ? res
        : Array.isArray((res as Record<string, unknown>)['data'])
          ? (res as Record<string, unknown>)['data'] as unknown[]
          : []
      return arr.map((t) => {
        const track = t as Record<string, unknown>
        return {
          id: track['id'] as number,
          title: track['title'] as string,
          artist: (track['artist'] ?? '') as string,
          album_image_url: (track['album_image_url'] ?? undefined) as string | undefined,
          duration: (track['duration'] ?? 0) as number,
          bandcamp_url: (track['bandcamp_url'] ?? undefined) as string | undefined,
          beatport_url: (track['beatport_url'] ?? undefined) as string | undefined,
          apple_music_url: (track['apple_music_url'] ?? undefined) as string | undefined,
          playlists: ((track['playlists'] ?? []) as { id: number; title: string }[]),
        }
      })
    } catch (err) {
      console.error('[auth:searchPlaylistTracks] error:', err)
      return []
    }
  })

  ipcMain.handle('auth:syncLibrary', async (_, trackIds: number[]) => {
    const token = await loadToken()
    if (!token) throw new Error('Not authenticated')
    return apiPost<{ synced: boolean; count: number }>('/library/sync', { track_ids: trackIds }, token)
  })

  ipcMain.handle('auth:getPlaylist', async (_, id: number) => {
    const token = await loadToken()
    if (!token) return null
    try {
      const res = await apiGet<Record<string, unknown>>(`/playlist/${id}`, token)
      const rawSegments = (res['segments'] ?? []) as Record<string, unknown>[]
      return {
        id: res['id'] as number,
        title: res['title'] as string,
        description: (res['description'] ?? '') as string,
        segments: rawSegments.map((seg) => ({
          id: seg['id'] as number,
          name: seg['name'] as string,
          order: (seg['order'] ?? 0) as number,
          duration: (seg['duration'] ?? 0) as number,
          tracks: ((seg['tracks'] ?? []) as Record<string, unknown>[]).map((t) => ({
            id: t['id'] as number,
            title: t['title'] as string,
            artist: t['artist'] as string,
            duration: (t['duration'] ?? 0) as number,
            album_image_url: (t['album_image_url'] ?? '') as string,
            bandcamp_url: (t['bandcamp_url'] ?? undefined) as string | undefined,
            beatport_url: (t['beatport_url'] ?? undefined) as string | undefined,
            apple_music_url: (t['apple_music_url'] ?? undefined) as string | undefined,
          })),
        })),
      }
    } catch (err) {
      console.error('[auth:getPlaylist] error:', err)
      return null
    }
  })
}
