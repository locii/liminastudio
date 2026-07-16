import type React from 'react'
import { useState, useEffect, useRef } from 'react'
import { useSessionStore } from '../../store/sessionStore'

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.round((s % 1) * 10)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${ms}`
  return `${m}:${String(sec).padStart(2, '0')}.${ms}`
}

const TARGET_PEAK_DBFS = -0.5
const TARGET_PEAK_LINEAR = Math.pow(10, TARGET_PEAK_DBFS / 20)

export function PropertiesPanel(): JSX.Element {
  const selectedClipId = useSessionStore((s) => s.selectedClipId)
  const selectClip = useSessionStore((s) => s.selectClip)
  const clips = useSessionStore((s) => s.clips)
  const tracks = useSessionStore((s) => s.tracks)
  const updateClip = useSessionStore((s) => s.updateClip)
  const [autoGainPending, setAutoGainPending] = useState(false)

  const [mfbUser, setMfbUser] = useState<{ id: number; name: string; email: string } | null | undefined>(undefined)
  const [mfbLoginOpen, setMfbLoginOpen] = useState(false)
  const [mfbEmail, setMfbEmail] = useState('')
  const [mfbPassword, setMfbPassword] = useState('')
  const [mfbLoginError, setMfbLoginError] = useState('')
  const [mfbLoginPending, setMfbLoginPending] = useState(false)
  const [syncPending, setSyncPending] = useState(false)
  const [syncDone, setSyncDone] = useState(false)

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: number; title: string; artists: { name: string }[]; album: { title: string } }[]>([])
  const [searchPending, setSearchPending] = useState(false)
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    window.electronAPI.mfbMe().then(setMfbUser)
  }, [])

  useEffect(() => {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults([])
  }, [selectedClipId])

  async function handleMfbLogin(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setMfbLoginError('')
    setMfbLoginPending(true)
    try {
      const user = await window.electronAPI.mfbLogin(mfbEmail, mfbPassword)
      setMfbUser(user)
      setMfbLoginOpen(false)
      setMfbEmail('')
      setMfbPassword('')
    } catch (err) {
      setMfbLoginError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setMfbLoginPending(false)
    }
  }

  async function handleMfbLogout(): Promise<void> {
    await window.electronAPI.mfbLogout()
    setMfbUser(null)
  }

  async function handleSync(clipId: string, mfbTrackId: number): Promise<void> {
    if (syncPending) return
    setSyncPending(true)
    try {
      const data = await window.electronAPI.mfbFetchTrack(mfbTrackId) as Record<string, unknown>
      const allTags = ([] as { name: string }[]).concat(
        ...Object.values((data['tags'] as Record<string, { name: string }[]>) ?? {})
      )
      const tags = allTags.map((t) => t.name)
      const hourTag = (data['tags'] as Record<string, { name: string; slug?: { en?: string } }[]>)?.['Hour']?.[0]
      const phase = hourTag?.slug?.en ?? null
      updateClip(clipId, {
        mfbTrackTitle: (data['title'] as string) ?? undefined,
        mfbArtist: (data['artist'] as string) ?? undefined,
        mfbAlbumImageUrl: (data['album'] as Record<string, unknown>)?.['image_url'] as string ?? undefined,
        mfbTags: tags,
        mfbBreathworkPhase: phase,
      })
      setSyncDone(true)
      setTimeout(() => setSyncDone(false), 2000)
    } catch (err) {
      console.error('[mfb:sync]', err)
    } finally {
      setSyncPending(false)
    }
  }

  async function handleAutoGain(): Promise<void> {
    if (!clip || autoGainPending) return
    setAutoGainPending(true)
    try {
      const peak = await window.electronAPI.getPeakLevel(clip.filePath)
      if (peak > 0) {
        const suggested = Math.min(2, TARGET_PEAK_LINEAR / peak)
        updateClip(clip.id, { volume: suggested })
      }
    } finally {
      setAutoGainPending(false)
    }
  }

  function handleSearchQueryChange(q: string): void {
    setSearchQuery(q)
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    if (!q.trim()) { setSearchResults([]); return }
    setSearchPending(true)
    searchDebounce.current = setTimeout(async () => {
      try {
        const results = await window.electronAPI.mfbSearchTracks(q)
        setSearchResults(results)
      } catch {
        setSearchResults([])
      } finally {
        setSearchPending(false)
      }
    }, 300)
  }

  function openSearch(fileName: string): void {
    const base = fileName.replace(/\.[^.]+$/, '')
    const parts = base.split(/\s+-\s+/)
    const query = parts.length >= 2 ? parts[parts.length - 1] : base
    setSearchQuery(query)
    setSearchResults([])
    setSearchPending(true)
    setSearchOpen(true)
    window.electronAPI.mfbSearchTracks(query)
      .then(setSearchResults)
      .catch(() => setSearchResults([]))
      .finally(() => setSearchPending(false))
  }

  async function applySearchResult(clipId: string, trackId: number): Promise<void> {
    setSearchOpen(false)
    setSearchResults([])
    await handleSync(clipId, trackId)
  }

  const clip = clips.find((c) => c.id === selectedClipId) ?? null
  const track = clip ? tracks.find((t) => t.id === clip.trackId) ?? null : null
  const effectiveDuration = clip ? clip.duration - clip.trimStart - clip.trimEnd : 0
  const isOpen = clip !== null && track !== null

  const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

  return (
    <>
      <div
        data-tour="properties-panel"
        className={`absolute right-0 top-0 bottom-0 w-72 z-30 flex flex-col border-l border-surface-border bg-surface-panel transition-transform duration-200 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {clip && track && (
          <>
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-surface-border shrink-0">
              <div className="w-1 h-4 rounded-full shrink-0" style={{ background: track.color }} />
              <div className="flex flex-col min-w-0 flex-1">
                <span
                  className="text-xs font-medium text-gray-200 truncate"
                  title={clip.mfbTrackTitle ?? clip.filePath}
                >
                  {clip.mfbTrackId != null ? (clip.mfbTrackTitle ?? clip.fileName) : clip.fileName}
                </span>
                {clip.mfbTrackId != null && clip.mfbArtist && (
                  <span className="text-[10px] text-gray-500 truncate">{clip.mfbArtist}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => selectClip(null)}
                title="Close"
                className="flex items-center justify-center w-5 h-5 text-gray-600 hover:text-gray-300 transition-colors shrink-0"
                style={noDrag}
              >
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex flex-col flex-1 overflow-y-auto gap-5 p-4 min-h-0" style={noDrag}>

              {/* Album art */}
              {clip.mfbAlbumImageUrl && (
                <img
                  src={clip.mfbAlbumImageUrl}
                  alt=""
                  className="w-full rounded-lg object-cover aspect-square"
                />
              )}

              {/* File name (when MFB data is present, show as secondary) */}
              {clip.mfbTrackId != null && (
                <Section label="File">
                  <span className="text-[10px] text-gray-600 truncate" title={clip.filePath}>{clip.fileName}</span>
                </Section>
              )}

              {/* Duration */}
              <Section label="Duration">
                <span className="text-xs tabular-nums text-gray-400">{formatDuration(effectiveDuration)}</span>
              </Section>

              <div className="h-px bg-surface-border shrink-0" />

              {/* Clip gain */}
              <Section label="Clip Gain">
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.01}
                    value={clip.volume}
                    onChange={(e) => updateClip(clip.id, { volume: parseFloat(e.target.value) })}
                    className="flex-1 h-1 rounded-full appearance-none bg-surface-hover cursor-ew-resize accent-accent"
                  />
                  <span className="text-[10px] font-mono tabular-nums text-gray-400 w-8 text-right">
                    {Math.round(clip.volume * 100)}%
                  </span>
                </div>
                <button
                  onClick={handleAutoGain}
                  disabled={autoGainPending}
                  title="Set gain so peak hits -0.5 dBFS"
                  className="self-start mt-1 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded border border-surface-border text-gray-400 hover:text-accent hover:border-accent disabled:opacity-40 transition-colors"
                >
                  {autoGainPending ? '…' : 'Auto Gain'}
                </button>
              </Section>

              <div className="h-px bg-surface-border shrink-0" />

              {/* MFB sync */}
              <Section label="Music for Breathwork">
                {clip.mfbTrackId != null ? (
                  mfbUser ? (
                    <button
                      type="button"
                      onClick={() => handleSync(clip.id, clip.mfbTrackId!)}
                      disabled={syncPending}
                      className="flex items-center gap-1.5 self-start px-2.5 py-1 text-[10px] uppercase tracking-wider rounded border border-surface-border text-gray-400 hover:text-accent hover:border-accent disabled:opacity-40 transition-colors"
                    >
                      <svg
                        className={`w-3 h-3 ${syncPending ? 'animate-spin' : ''}`}
                        viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
                        strokeLinecap="round" strokeLinejoin="round"
                      >
                        <path d="M10 6A4 4 0 112 6" />
                        <path d="M10 2v4H6" />
                      </svg>
                      {syncDone ? 'Synced!' : 'Sync MFB Data'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setMfbLoginOpen(true)}
                      className="self-start px-2.5 py-1 text-[10px] uppercase tracking-wider rounded border border-surface-border text-gray-500 hover:text-accent hover:border-accent transition-colors"
                    >
                      Log in to sync
                    </button>
                  )
                ) : searchOpen ? (
                  <div className="flex flex-col gap-2">
                    <input
                      autoFocus
                      type="text"
                      value={searchQuery}
                      onChange={(e) => handleSearchQueryChange(e.target.value)}
                      placeholder="Search MFB…"
                      className="w-full px-2 py-1 text-[11px] rounded border border-surface-border bg-surface-hover text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
                    />
                    {searchPending && (
                      <span className="text-[10px] text-gray-600">Searching…</span>
                    )}
                    {!searchPending && searchResults.length > 0 && (
                      <div className="flex flex-col gap-0.5">
                        {searchResults.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => applySearchResult(clip.id, r.id)}
                            className="flex flex-col text-left px-2 py-1.5 rounded hover:bg-surface-hover transition-colors"
                          >
                            <span className="text-[11px] text-gray-200 truncate">{r.title}</span>
                            <span className="text-[10px] text-gray-500 truncate">{r.artists[0]?.name} · {r.album.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {!searchPending && searchQuery && searchResults.length === 0 && (
                      <span className="text-[10px] text-gray-600">No results</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setSearchOpen(false)}
                      className="self-start text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => openSearch(clip.fileName)}
                    className="self-start px-2.5 py-1 text-[10px] uppercase tracking-wider rounded border border-surface-border text-gray-500 hover:text-accent hover:border-accent transition-colors"
                  >
                    Find on MFB
                  </button>
                )}
                {mfbUser && (
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] text-gray-600">{mfbUser.name}</span>
                    <button
                      type="button"
                      onClick={handleMfbLogout}
                      className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
                    >
                      Log out
                    </button>
                  </div>
                )}
              </Section>
            </div>
          </>
        )}
      </div>

      {/* MFB login modal */}
      {mfbLoginOpen && (
        <div
          className="flex fixed inset-0 z-50 justify-center items-center bg-black/60"
          onClick={() => setMfbLoginOpen(false)}
        >
          <form
            onSubmit={handleMfbLogin}
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col gap-3 p-5 w-72 rounded-lg border shadow-xl border-surface-border bg-surface-panel"
          >
            <span className="text-sm font-medium text-gray-200">Log in to Music for Breathwork</span>
            <input
              type="email"
              placeholder="Email"
              value={mfbEmail}
              onChange={(e) => setMfbEmail(e.target.value)}
              required
              className="px-2.5 py-1.5 text-xs rounded border border-surface-border bg-surface-hover text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
            />
            <input
              type="password"
              placeholder="Password"
              value={mfbPassword}
              onChange={(e) => setMfbPassword(e.target.value)}
              required
              className="px-2.5 py-1.5 text-xs rounded border border-surface-border bg-surface-hover text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
            />
            {mfbLoginError && <span className="text-[11px] text-red-400">{mfbLoginError}</span>}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setMfbLoginOpen(false)}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={mfbLoginPending}
                className="px-3 py-1.5 text-xs rounded border border-accent text-accent hover:bg-accent/10 disabled:opacity-50 transition-colors"
              >
                {mfbLoginPending ? 'Logging in…' : 'Log in'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  )
}
