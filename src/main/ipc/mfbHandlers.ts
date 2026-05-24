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
      'User-Agent': 'LiminaMix/1.0',
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

function apiGetPublic<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    get(
      `${BASE}${path}`,
      { headers: { 'Accept': 'application/json', 'User-Agent': 'LiminaMix/1.0' } },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8')
          if (res.statusCode && res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return }
          try { resolve(JSON.parse(body) as T) } catch (e) { reject(e) }
        })
        res.on('error', reject)
      }
    ).on('error', reject)
  })
}

function apiGet<T>(path: string, token: string): Promise<T> {
  return new Promise((resolve, reject) => {
    get(
      `${BASE}${path}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'LiminaMix/1.0',
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

export interface MfbUser {
  id: number
  name: string
  email: string
}

export function registerMfbHandlers(): void {
  ipcMain.handle('mfb:login', async (_, email: string, password: string) => {
    const result = await apiPost<{ token: string; user: MfbUser }>('/auth/login', { email, password })
    await saveToken(result.token)
    return result.user
  })

  ipcMain.handle('mfb:logout', async () => {
    const token = await loadToken()
    if (token) {
      try { await apiPost('/auth/logout', {}, token) } catch { /* ignore */ }
    }
    await clearToken()
  })

  ipcMain.handle('mfb:me', async () => {
    const token = await loadToken()
    if (!token) return null
    try {
      return await apiGet<MfbUser>('/auth/me', token)
    } catch {
      return null
    }
  })

  // Public text search — no auth required
  ipcMain.handle('mfb:searchTracks', async (_, query: string) => {
    const q = encodeURIComponent(query.trim())
    if (!q) return []
    return apiGetPublic<{ id: number; title: string; artists: { name: string }[]; album: { title: string } }[]>(
      `/tracks/search?q=${q}&limit=8`
    )
  })

  // Fetch full track detail — requires auth (curated tags, phase, audio features)
  ipcMain.handle('mfb:fetchTrack', async (_, id: number) => {
    const token = await loadToken()
    if (!token) throw new Error('Not authenticated')
    return apiGet<Record<string, unknown>>(`/tracks/${id}`, token)
  })
}
