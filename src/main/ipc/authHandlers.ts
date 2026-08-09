import { ipcMain, safeStorage, app, shell } from 'electron'
import { get, request } from 'https'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { randomBytes, createHash } from 'crypto'
import { join } from 'path'
import { promises as fs } from 'fs'

const BASE = 'https://musicforbreathwork.com/api'
const SITE = BASE.replace(/\/api\/?$/, '') // web root, for the browser authorize page
const TOKEN_FILE = join(app.getPath('userData'), 'auth.bin')

/** Fixed client id agreed with the musicforbreathwork.com desktop authorize flow. */
const OAUTH_CLIENT_ID = 'limina-desktop'

/** Give up waiting for the browser callback after this long. */
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000

/** RFC 4648 §5 base64url (no padding) — used for the PKCE verifier/challenge and state. */
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Minimal HTML shown in the user's browser after the redirect lands on our loopback server. */
function callbackPage(ok: boolean): string {
  const title = ok ? 'You’re signed in' : 'Sign-in cancelled'
  const body = ok
    ? 'Limina Studio is now connected to your account. You can close this tab and return to the app.'
    : 'The sign-in was cancelled or failed. You can close this tab and try again from Limina Studio.'
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>html{color-scheme:dark}body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
background:#0f0f0f;color:#e5e5e5;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.card{max-width:340px;text-align:center;padding:0 24px}.mark{font-size:32px;color:#6366f1;margin-bottom:12px}
h1{font-size:17px;font-weight:600;margin:0 0 8px}p{color:#9ca3af;margin:0}</style></head>
<body><div class="card"><div class="mark">${ok ? '◎' : '×'}</div><h1>${title}</h1><p>${body}</p></div></body></html>`
}

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

  // Browser-delegated sign-in (Authorization Code + PKCE over loopback). The user
  // authorizes on musicforbreathwork.com in their real browser — the app never
  // sees their password. See DesktopAuthController on the server side.
  ipcMain.handle('auth:beginOAuth', async () => {
    const verifier = base64url(randomBytes(32))
    const challenge = base64url(createHash('sha256').update(verifier).digest())
    const state = base64url(randomBytes(16))

    // Spin up a one-shot loopback server on a random free port, open the browser,
    // and wait for the redirect back to /callback.
    const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>(
      (resolve, reject) => {
        let redirectUri = ''
        const server = createServer((req, res) => {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1')
          if (url.pathname !== '/callback') {
            res.writeHead(404).end()
            return
          }
          const returnedState = url.searchParams.get('state')
          const errParam = url.searchParams.get('error')
          const code = url.searchParams.get('code')
          const ok = !errParam && !!code && returnedState === state

          res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(callbackPage(ok))
          // Close after the response has been flushed so the page renders.
          setImmediate(() => server.close())

          if (errParam) return reject(new Error(errParam))
          if (returnedState !== state) return reject(new Error('state_mismatch'))
          if (!code) return reject(new Error('no_code'))
          resolve({ code, redirectUri })
        })

        const timeout = setTimeout(() => {
          server.close()
          reject(new Error('timeout'))
        }, OAUTH_TIMEOUT_MS)
        server.on('close', () => clearTimeout(timeout))
        server.on('error', reject)

        server.listen(0, '127.0.0.1', () => {
          const port = (server.address() as AddressInfo).port
          redirectUri = `http://127.0.0.1:${port}/callback`
          const authUrl =
            `${SITE}/desktop/authorize?` +
            new URLSearchParams({
              client_id: OAUTH_CLIENT_ID,
              response_type: 'code',
              redirect_uri: redirectUri,
              code_challenge: challenge,
              code_challenge_method: 'S256',
              state,
              scope: 'limina',
            }).toString()
          shell.openExternal(authUrl)
        })
      }
    )

    const result = await apiPost<{ token: string; expires_at: string; user: AuthUser }>(
      '/auth/token',
      { code, code_verifier: verifier, redirect_uri: redirectUri, device_name: 'Limina Studio' }
    )
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
