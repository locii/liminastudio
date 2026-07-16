import { useState, useRef, useEffect, useCallback } from 'react'
import { pathGuessUpdatesForApply } from '../lib/libraryTrackDisplay'
import { useLibraryStore } from '../store/libraryStore'
import { syncLibraryToMfb } from '../lib/syncLibrary'
import { mfbTagNames, reconcileTags, hourPhase, hasRealFeatures } from '../lib/mfbTags'
import { mfbTrackUrl } from '../types'
import type { MfbAudioFeatures } from '../types'
import { WaveformPreview } from './WaveformPreview'
import { TrackLookup } from './TrackLookup'
import { MixCueEditorModal } from './MixCueEditorModal'
import { SpotifyImportModal } from './SpotifyImportModal'

function formatMs(ms: number): string {
  const s = ms / 1000
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1)
  return `${m}:${sec.padStart(4, '0')}`
}

function formatDuration(seconds: number): string {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${(bytes / 1_000).toFixed(0)} KB`
}

function SectionHeader({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onToggle} className="flex justify-between items-center w-full text-left group">
      <span className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</span>
      <svg
        className={`w-3 h-3 text-gray-600 group-hover:text-gray-400 transition-all shrink-0 ${open ? '':'-rotate-90'}`}
        viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      >
        <path d="M2 4l4 4 4-4" />
      </svg>
    </button>
  )
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex gap-2 justify-between items-baseline">
      <span className="text-[10px] text-gray-400 uppercase tracking-wider shrink-0">{label}</span>
      <span className="text-[11px] text-gray-200 text-right truncate">{value}</span>
    </div>
  )
}

function EditableRow({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])

  function commit(): void {
    setEditing(false)
    if (draft !== value) onSave(draft)
  }

  return (
    <div className="flex gap-2 justify-between items-baseline">
      <span className="text-[10px] text-gray-400 uppercase tracking-wider shrink-0">{label}</span>
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
          className="flex-1 min-w-0 text-right text-[11px] text-gray-200 bg-transparent border-b border-accent/50 outline-none"
          autoFocus
        />
      ) : (
        <button
          type="button"
          onClick={() => { setDraft(value); setEditing(true) }}
          className="text-[11px] text-gray-200 text-right truncate hover:text-white min-w-0 max-w-[180px]"
          title="Click to edit"
        >
          {value.trim() || <span className="text-gray-600">—</span>}
        </button>
      )}
    </div>
  )
}

export function PropertiesPanel(): JSX.Element {
  const files = useLibraryStore((s) => s.files)
  const selectedFileId = useLibraryStore((s) => s.selectedFileId)
  const updateFile = useLibraryStore((s) => s.updateFile)
  const selectFile = useLibraryStore((s) => s.selectFile)
  const removeFile = useLibraryStore((s) => s.removeFile)
  const unlinkMfb = useLibraryStore((s) => s.unlinkMfb)
  const pendingMatches = useLibraryStore((s) => s.pendingMatches)
  const applyPendingMatch = useLibraryStore((s) => s.applyPendingMatch)
  const clearPendingMatch = useLibraryStore((s) => s.clearPendingMatch)
  const userAccount = useLibraryStore((s) => s.userAccount)

  const [sections, setSections] = useState({
    info: true,
    folderLayout: true,
    tags: true,
    audioFeatures: true,
    buy: true,
    duplicates: true,
    notes: true,
    mixCues: false,
  })
  function toggleSection(key: keyof typeof sections): void {
    setSections((s) => ({ ...s, [key]: !s[key] }))
  }

  const [showMixCueEditor, setShowMixCueEditor] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [rescanning, setRescanning] = useState(false)
  const [refreshed, setRefreshed] = useState(false)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const m4bAudioRef = useRef<HTMLAudioElement | null>(null)
  const [m4bPreviewPlaying, setM4bPreviewPlaying] = useState(false)
  const [m4bPreviewLoading, setM4bPreviewLoading] = useState(false)

  const previewFileId = useLibraryStore((s) => s.previewFileId)
  const setPreview = useLibraryStore((s) => s.setPreview)

  const selectedPlaylistDetail = useLibraryStore((s) => s.selectedPlaylistDetail)

  const file = files.find((f) => f.id === selectedFileId)
  const albumImageUrl = file?.albumImageUrl
    ?? (file?.mfbTrackId != null
      ? selectedPlaylistDetail?.segments.flatMap((s) => s.tracks).find((t) => t.id === file.mfbTrackId)?.album_image_url
      : undefined)
  const pendingMatch = file ? pendingMatches[file.id] : undefined
  const pendingMatchLinkedFiles = pendingMatch ? files.filter((f) => f.mfbTrackId === pendingMatch.id) : []
  const pendingMatchLinkedCount = pendingMatchLinkedFiles.length
  const duplicates = file?.mfbTrackId !== null && file?.mfbTrackId !== undefined
    ? files.filter((f) => f.id !== file.id && f.mfbTrackId === file.mfbTrackId)
    : []

  useEffect(() => {
    setConfirmDelete(false)
    setConfirmUnlink(false)
    setShowMenu(false)
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    m4bAudioRef.current?.pause()
    m4bAudioRef.current = null
    setM4bPreviewPlaying(false)
    setM4bPreviewLoading(false)
  }, [selectedFileId])

  const handleMenuClickOutside = useCallback((e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      setShowMenu(false)
    }
  }, [])

  useEffect(() => {
    if (showMenu) document.addEventListener('mousedown', handleMenuClickOutside)
    else document.removeEventListener('mousedown', handleMenuClickOutside)
    return () => document.removeEventListener('mousedown', handleMenuClickOutside)
  }, [showMenu, handleMenuClickOutside])

  async function toggleM4bPreview(): Promise<void> {
    if (m4bPreviewPlaying || m4bAudioRef.current) {
      m4bAudioRef.current?.pause()
      m4bAudioRef.current = null
      setM4bPreviewPlaying(false)
      return
    }
    if (m4bPreviewLoading || !pendingMatch) return
    setM4bPreviewLoading(true)
    try {
      const data = await window.electronAPI.mfbGetTrack(pendingMatch.id) as { preview_url?: string | null }
      if (!data.preview_url) return
      const audio = new Audio(data.preview_url)
      m4bAudioRef.current = audio
      audio.addEventListener('ended', () => { m4bAudioRef.current = null; setM4bPreviewPlaying(false) })
      await audio.play()
      window.dispatchEvent(new CustomEvent('app:audio-start', { detail: 'm4b-preview' }))
      setM4bPreviewPlaying(true)
    } catch { /* ignore */ } finally {
      setM4bPreviewLoading(false)
    }
  }

  function armConfirmDelete(): void {
    setConfirmDelete(true)
    setConfirmUnlink(false)
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 5000)
  }

  function armConfirmUnlink(): void {
    setConfirmUnlink(true)
    setConfirmDelete(false)
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    confirmTimerRef.current = setTimeout(() => setConfirmUnlink(false), 5000)
  }

  function cancelConfirm(): void {
    setConfirmDelete(false)
    setConfirmUnlink(false)
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
  }

  if (!file) {
    return (
      <div className="flex justify-center items-center border-l shrink-0">
        <p className="text-[11px] text-gray-400 text-center px-4">
          Select a file to see its properties
        </p>
      </div>
    )
  }

  // Fetch a track's full detail from MFB and apply it to this file. Shared by
  // "Re-fetch from MFB" (existing match) and "Fetch from Music for Breathwork"
  // (Spotify import of an unmatched file). Returns false if the track couldn't
  // be loaded.
  const applyMfbTrack = async (trackId: number): Promise<boolean> => {
    const data = (await window.electronAPI.mfbGetTrack(trackId)) as {
      id: number; title: string; description: string
      artists: { id: number; name: string }[]
      album: { id: number; title: string; image_url: string }
      tags: Record<string, { id: number; name: string; slug: { en: string } }[]>
      audio_features?: MfbAudioFeatures
      streaming?: { bandcamp_url?: string; beatport_url?: string }
    }
    if (!data?.id || !data?.title) return false
    const tagsData = data.tags ?? {}
    const artist = (data.artists ?? []).map((a) => a.name).join(', ')
    // Refresh MFB (system) tags while keeping any tags the user added themselves.
    const { tags, mfbTags } = reconcileTags(file.tags, file.mfbTags, mfbTagNames(tagsData))
    const phase = hourPhase(tagsData)
    // Only apply features when populated — a still-enriching track returns nulls.
    const feat = data.audio_features
    const realFeatures = hasRealFeatures(feat)
    updateFile(file.id, {
      artist, album: data.album?.title ?? '', tags, mfbTags,
      notes: data.description ?? '',
      trackTitle: data.title,
      mfbTrackId: data.id,
      mfbApplied: true,
      appliedPathGuess: true,
      albumImageUrl: data.album?.image_url ?? null,
      audioFeatures: realFeatures ? feat : (file.audioFeatures ?? null),
      audioFeaturesEstimated: realFeatures ? false : file.audioFeaturesEstimated,
      bandcampUrl: data.streaming?.bandcamp_url ?? null,
      beatportUrl: data.streaming?.beatport_url ?? null,
      ...(phase ? { breathworkPhase: phase } : {}),
    })
    return true
  }

  return (
    <div className="flex flex-col w-full h-full border-l border-surface-border bg-surface-panel">

      {/* Pending match banner */}
      {pendingMatch && (
        <div className="mx-3 mt-3 mb-0 rounded border border-accent/30 bg-accent/8 p-2.5 flex flex-col gap-1.5 shrink-0">
          <div className="flex gap-2 justify-between items-center">
            <span className="text-[10px] text-accent uppercase tracking-wider font-medium">Pending Match</span>
            <button
              type="button"
              onClick={() => clearPendingMatch(file.id)}
              title="Dismiss pending match"
              className="text-gray-500 transition-colors hover:text-gray-400"
            >
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </div>
          <p className="text-[11px] text-gray-200 truncate">{pendingMatch.title}</p>
          <p className="text-[10px] text-gray-300 truncate">
            {(pendingMatch.artists ?? []).map((a) => a.name).join(', ')} · {pendingMatch.album?.title}
          </p>
          {pendingMatchLinkedCount > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500">
                {pendingMatchLinkedCount} file{pendingMatchLinkedCount === 1 ? '' : 's'} already linked to this track
              </span>
              {pendingMatchLinkedFiles.map((lf) => (
                <div key={lf.id} className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (previewFileId === lf.id) setPreview(null, [])
                      else setPreview(lf.id, [lf.id])
                    }}
                    title={previewFileId === lf.id ? 'Stop preview' : 'Preview linked file'}
                    className={`shrink-0 w-4 h-4 flex items-center justify-center rounded-full border transition-colors ${
                      previewFileId === lf.id
                        ? 'border-accent text-accent'
                        : 'border-gray-600 text-gray-600 hover:border-accent hover:text-accent'
                    }`}
                  >
                    {previewFileId === lf.id ? (
                      <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor">
                        <rect x="1.5" y="1" width="2.5" height="8" rx="0.5" />
                        <rect x="6" y="1" width="2.5" height="8" rx="0.5" />
                      </svg>
                    ) : (
                      <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor">
                        <path d="M2 1.5l7 3.5-7 3.5V1.5z" />
                      </svg>
                    )}
                  </button>
                  <span className="text-[10px] text-gray-400 truncate flex-1 min-w-0" title={lf.filePath}>{lf.fileName}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-0.5">
            <button
              type="button"
              onClick={() => { applyPendingMatch(file.id); syncLibraryToMfb() }}
              className="flex-1 py-1 text-[11px] rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              Apply to Track
            </button>
            <button
              type="button"
              onClick={toggleM4bPreview}
              disabled={m4bPreviewLoading}
              title={m4bPreviewPlaying ? 'Stop preview' : 'Preview track'}
              className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-full border transition-colors disabled:opacity-40 ${
                m4bPreviewPlaying
                  ? 'border-accent text-accent'
                  : 'text-gray-600 border-gray-600 hover:border-accent hover:text-accent'
              }`}
            >
              {m4bPreviewLoading ? (
                <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M6 1v2M6 9v2M1 6h2M9 6h2" strokeLinecap="round" />
                </svg>
              ) : m4bPreviewPlaying ? (
                <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor">
                  <rect x="1.5" y="1" width="2.5" height="8" rx="0.5" />
                  <rect x="6" y="1" width="2.5" height="8" rx="0.5" />
                </svg>
              ) : (
                <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor">
                  <path d="M2 1.5l7 3.5-7 3.5V1.5z" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={() => window.open(mfbTrackUrl(pendingMatch.id, pendingMatch.title))}
              title="View on Music for Breathwork"
              className="px-2.5 py-1 text-[11px] rounded border border-surface-border text-gray-400 hover:text-gray-200 hover:bg-surface-hover transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8A1.5 1.5 0 0 0 13 12.5V9M9.5 2H14v4.5M14 2L7.5 8.5" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Track header: name + actions menu */}
      <div className="flex gap-4 items-center px-3 py-2 min-w-0 border-b border-surface-border shrink-0">
        {albumImageUrl && (
          <img src={albumImageUrl} alt="" className="object-cover w-8 h-8 rounded shrink-0" />
        )}
        <p className="text-[11px] text-gray-200 font-medium truncate flex-1 min-w-0" title={file.filePath}>
          {file.trackTitle || file.fileName}
        </p>

        {/* Confirm overlays */}
        {confirmDelete && (
          <div className="flex items-center gap-0.5 shrink-0">
            <span className="text-[10px] text-red-400 mr-0.5">Remove?</span>
            <button type="button" onClick={() => removeFile(file.id)}
              className="px-1.5 h-5 text-[10px] font-medium text-red-400 hover:text-red-300 rounded hover:bg-red-500/15 transition-colors">
              Yes
            </button>
            <button type="button" onClick={cancelConfirm}
              className="px-1.5 h-5 text-[10px] text-gray-400 hover:text-gray-300 rounded hover:bg-surface-hover transition-colors">
              No
            </button>
          </div>
        )}
        {confirmUnlink && (
          <div className="flex items-center gap-0.5 shrink-0">
            <span className="text-[10px] text-orange-400 mr-0.5">Unlink?</span>
            <button type="button" onClick={() => { unlinkMfb(file.id); cancelConfirm(); syncLibraryToMfb() }}
              className="px-1.5 h-5 text-[10px] font-medium text-orange-400 hover:text-orange-300 rounded hover:bg-orange-500/15 transition-colors">
              Yes
            </button>
            <button type="button" onClick={cancelConfirm}
              className="px-1.5 h-5 text-[10px] text-gray-400 hover:text-gray-300 rounded hover:bg-surface-hover transition-colors">
              No
            </button>
          </div>
        )}

        {/* Ellipsis menu */}
        {!confirmDelete && !confirmUnlink && (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setShowMenu((v) => !v)}
              title="More actions"
              className={`flex justify-center items-center w-6 h-6 rounded transition-colors text-gray-500 hover:text-gray-300 hover:bg-surface-hover ${showMenu ? 'text-gray-300 bg-surface-hover' : ''}`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="3" cy="8" r="1.25" /><circle cx="8" cy="8" r="1.25" /><circle cx="13" cy="8" r="1.25" />
              </svg>
            </button>

            {showMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[176px] bg-surface-panel border border-surface-border rounded-lg shadow-xl py-1 text-[11px]">
                <button
                  type="button"
                  onClick={async () => {
                    setShowMenu(false)
                    await window.electronAPI.copyFile(file.filePath)
                    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
                    setCopied(true)
                    copyTimerRef.current = setTimeout(() => setCopied(false), 3000)
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-gray-300 hover:bg-surface-hover transition-colors"
                >
                  <svg className="w-3.5 h-3.5 shrink-0 text-gray-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5" />
                    <path d="M10.5 5.5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9A1.5 1.5 0 0 0 3.5 10.5H5.5" />
                  </svg>
                  Copy file path
                </button>

                {/* Unmatched file: search Music for Breathwork (via Spotify) and
                    pick the exact track to inherit its data + features. */}
                {!file.mfbTrackId && userAccount && file.duration > 0 && file.fileName && (
                  <button
                    type="button"
                    onClick={() => { setShowMenu(false); setShowImportModal(true) }}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-gray-300 hover:bg-surface-hover transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 shrink-0 text-gray-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4.5 11.5A3 3 0 0 1 4 5.6 4 4 0 0 1 11.8 6 2.75 2.75 0 0 1 11.5 11.5" />
                      <path d="M8 7.5v5M6 10.5l2 2 2-2" />
                    </svg>
                    Find on Music for Breathwork…
                  </button>
                )}

                {file.mfbTrackId && (
                  <>
                    {userAccount && (
                    <button
                      type="button"
                      disabled={rescanning}
                      onClick={async () => {
                        setShowMenu(false)
                        if (!file.mfbTrackId) return
                        setRescanning(true)
                        try {
                          const ok = await applyMfbTrack(file.mfbTrackId)
                          if (!ok) return
                          if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
                          setRefreshed(true)
                          refreshTimerRef.current = setTimeout(() => setRefreshed(false), 3000)
                        } catch { /* ignore */ } finally {
                          setRescanning(false)
                        }
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-gray-300 hover:bg-surface-hover transition-colors disabled:opacity-40"
                    >
                      <svg className={`w-3.5 h-3.5 shrink-0 text-gray-500 ${rescanning ? 'animate-spin' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" /><path d="M8 2.5l3-1.5M8 2.5l1.5 3" />
                      </svg>
                      Re-fetch from MFB
                    </button>
                    )}

                    <button
                      type="button"
                      onClick={() => { setShowMenu(false); window.open(mfbTrackUrl(file.mfbTrackId!, file.trackTitle || String(file.mfbTrackId))) }}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-gray-300 hover:bg-surface-hover transition-colors"
                    >
                      <svg className="w-3.5 h-3.5 shrink-0 text-gray-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8A1.5 1.5 0 0 0 13 12.5V9M9.5 2H14v4.5M14 2L7.5 8.5" />
                      </svg>
                      View on MFB
                    </button>

                    <div className="my-1 border-t border-surface-border" />

                    <button
                      type="button"
                      onClick={() => { setShowMenu(false); armConfirmUnlink() }}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-red-400 hover:bg-surface-hover transition-colors"
                    >
                      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6.5 9.5l-2 2a2.12 2.12 0 0 0 3 3l2-2M9.5 6.5l2-2a2.12 2.12 0 0 0-3-3l-2 2M5.5 10.5l5-5M2 2l12 12" />
                      </svg>
                      Unlink MFB match
                    </button>
                  </>
                )}

                <div className="my-1 border-t border-surface-border" />

                <button
                  type="button"
                  onClick={() => { setShowMenu(false); armConfirmDelete() }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-red-400 hover:bg-surface-hover transition-colors"
                >
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 5h10M6 5V3.5h4V5M5 5v7.5h6V5H5zM7 8v2.5M9 8v2.5" />
                  </svg>
                  Remove from library
                </button>
              </div>
            )}
          </div>
        )}

        {/* Close panel */}
        <button
          type="button"
          onClick={() => selectFile(null)}
          title="Close panel"
          className="flex justify-center items-center w-6 h-6 text-gray-500 rounded transition-colors shrink-0 hover:text-gray-400 hover:bg-surface-hover"
        >
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </div>

      {/* Toast notifications */}
      {copied && (
        <div className="mx-3 mt-2 px-2.5 py-1.5 rounded border border-accent/30 bg-accent/8 flex items-center gap-1.5 shrink-0">
          <svg className="w-3 h-3 text-accent shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6l3 3 5-5" />
          </svg>
          <span className="text-[10px] text-accent">File copied to clipboard</span>
        </div>
      )}
      {refreshed && (
        <div className="mx-3 mt-2 px-2.5 py-1.5 rounded border border-accent/30 bg-accent/8 flex items-center gap-1.5 shrink-0">
          <svg className="w-3 h-3 text-accent shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6l3 3 5-5" />
          </svg>
          <span className="text-[10px] text-accent">Track data updated from Music for Breathwork</span>
        </div>
      )}

      {/* Waveform */}
      <div className="shrink-0">
        <WaveformPreview
          key={file.id}
          fileId={file.id}
          filePath={file.filePath}
          duration={file.duration}
          peaks={file.peaks}
          sampleRate={file.sampleRate}
          clipStartMs={file.clipStartMs}
          clipEndMs={file.clipEndMs}
          introEndMs={file.introEndMs}
          outroStartMs={file.outroStartMs}
          onSetCuePoints={userAccount ? () => setShowMixCueEditor(true) : undefined}
        />
      </div>

      {/* Cue point summary */}
      {(file.clipStartMs != null || file.clipEndMs != null || file.introEndMs != null || file.outroStartMs != null) && (
        <div className="flex items-center gap-3 flex-wrap px-3 py-1.5 border-b border-surface-border shrink-0">
          {file.clipStartMs != null && (
            <span className="flex items-center gap-1 text-[10px] text-blue-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
              S {formatMs(file.clipStartMs)}
            </span>
          )}
          {file.clipEndMs != null && (
            <span className="flex items-center gap-1 text-[10px] text-violet-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
              E {formatMs(file.clipEndMs)}
            </span>
          )}
          {file.introEndMs != null && (
            <span className="flex items-center gap-1 text-[10px] text-teal-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0" />
              In {formatMs(file.introEndMs)}
            </span>
          )}
          {file.outroStartMs != null && (
            <span className="flex items-center gap-1 text-[10px] text-orange-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
              Out {formatMs(file.outroStartMs)}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowMixCueEditor(true)}
            className="ml-auto text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            Edit
          </button>
        </div>
      )}

      {/* Scrollable metadata */}
      <div className="overflow-y-auto flex-1">

      {file.trackTitle && (
        <div className="flex gap-2 justify-between items-baseline px-3 py-2 border-b border-surface-border">
          <span className="text-[10px] text-gray-400 uppercase tracking-wider shrink-0">File</span>
          <span className="text-[11px] text-gray-300 truncate" title={file.fileName}>{file.fileName}</span>
        </div>
      )}

      {/* Metadata */}
      <div className="flex flex-col gap-2 p-3 border-b border-surface-border">
        <SectionHeader label="Info" open={sections.info} onToggle={() => toggleSection('info')} />
        {sections.info && (
          <div className="flex flex-col gap-2 mt-1">
            <EditableRow label="Artist" value={file.artist} onSave={(v) => updateFile(file.id, { artist: v })} />
            <EditableRow label="Album" value={file.album} onSave={(v) => updateFile(file.id, { album: v })} />
            <Row label="Duration" value={formatDuration(file.duration)} />
            <Row label="Format" value={file.format.toUpperCase()} />
            <Row label="Sample rate" value={`${(file.sampleRate / 1000).toFixed(1)} kHz`} />
            <Row label="Channels" value={file.channels === 2 ? 'Stereo' : file.channels === 1 ? 'Mono' : String(file.channels)} />
            <Row label="File size" value={formatSize(file.fileSize)} />
          </div>
        )}
      </div>

      {!file.appliedPathGuess && (file.artistPathGuess.trim() || file.albumPathGuess.trim()) && (
        <div className="flex flex-col gap-2 p-3 border-b border-surface-border">
          <div className="flex justify-between items-center">
            <SectionHeader label="From folder layout" open={sections.folderLayout} onToggle={() => toggleSection('folderLayout')} />
            {sections.folderLayout && file.artistPathGuess.trim() && file.albumPathGuess.trim() && !file.appliedPathGuess && (
              <button
                type="button"
                onClick={() => updateFile(file.id, {
                  artistPathGuess: file.albumPathGuess,
                  albumPathGuess: file.artistPathGuess,
                })}
                title="Swap artist / album"
                className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1 shrink-0 ml-2"
              >
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 4h10M8 1l3 3-3 3M11 8H1M4 5l-3 3 3 3" />
                </svg>
                Swap
              </button>
            )}
          </div>

          {sections.folderLayout && (
            <>
              <div className="flex flex-col gap-1">
                {file.artistPathGuess.trim() && (
                  <div className="flex gap-2 justify-between items-baseline">
                    <span className="text-[10px] text-gray-400 uppercase shrink-0 tracking-wider">Artist</span>
                    <span className={`text-[11px] text-gray-200 truncate ${!file.appliedPathGuess ? 'italic' : ''}`} title={file.artistPathGuess}>
                      {file.artistPathGuess.trim()}
                    </span>
                  </div>
                )}
                {file.albumPathGuess.trim() && (
                  <div className="flex gap-2 justify-between items-baseline">
                    <span className="text-[10px] text-gray-400 uppercase shrink-0 tracking-wider">Album</span>
                    <span className={`text-[11px] text-gray-200 truncate ${!file.appliedPathGuess ? 'italic' : ''}`} title={file.albumPathGuess}>
                      {file.albumPathGuess.trim()}
                    </span>
                  </div>
                )}
              </div>
              {!file.appliedPathGuess && (
                file.artistPathGuess.trim() && file.albumPathGuess.trim() ? (
                  <button
                    type="button"
                    onClick={() => updateFile(file.id, pathGuessUpdatesForApply(file))}
                    className="w-full py-1.5 text-[11px] rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                  >
                    Apply folder names to track
                  </button>
                ) : (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateFile(file.id, {
                        artist: file.artistPathGuess.trim() || file.albumPathGuess.trim(),
                        appliedPathGuess: true,
                      })}
                      className="flex-1 py-1.5 text-[11px] rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                    >
                      Use as Artist
                    </button>
                    <button
                      type="button"
                      onClick={() => updateFile(file.id, {
                        album: file.artistPathGuess.trim() || file.albumPathGuess.trim(),
                        appliedPathGuess: true,
                      })}
                      className="flex-1 py-1.5 text-[11px] rounded border border-surface-border text-gray-300 hover:bg-surface-hover transition-colors"
                    >
                      Use as Album
                    </button>
                  </div>
                )
              )}
            </>
          )}
        </div>
      )}

      {/* Tags */}
      <div className="flex flex-col gap-2 p-3 border-b border-surface-border">
        <SectionHeader label="Tags" open={sections.tags} onToggle={() => toggleSection('tags')} />
        {sections.tags && (
          <div className="flex flex-wrap gap-1 mt-1">
            {(file.tags ?? []).map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-surface-hover border border-surface-border text-gray-200"
              >
                {tag}
                <button
                  onClick={() => updateFile(file.id, {
                    tags: file.tags.filter((t) => t !== tag),
                    mfbTags: file.mfbTags?.filter((t) => t !== tag),
                  })}
                  title={`Remove tag "${tag}"`}
                  className="text-gray-500 hover:text-gray-300"
                >×</button>
              </span>
            ))}
            <TagInput onAdd={(tag) => {
              if (!file.tags.includes(tag)) updateFile(file.id, { tags: [...file.tags, tag] })
            }} />
          </div>
        )}
      </div>

      {/* Audio features */}
      {file.audioFeatures && (
        <div className="flex flex-col gap-2 p-3 border-b border-surface-border">
          <SectionHeader label="Audio Features" open={sections.audioFeatures} onToggle={() => toggleSection('audioFeatures')} />
          {sections.audioFeatures && (
            <div className="flex flex-col gap-1.5 mt-1">
              {file.audioFeaturesEstimated && (
                <p className="text-[10px] text-gray-500 leading-snug -mt-0.5 mb-0.5" title="This track isn't in the Music for Breathwork catalogue. Features were estimated locally from a 30s clip via Reccobeats and may be approximate.">
                  <span className="text-accent">≈ Estimated</span> · not in the MFB catalogue
                </p>
              )}
              <AudioFeatureBar label="Intensity" value={file.audioFeatures.intensity} />
              <AudioFeatureBar label="Activation" value={file.audioFeatures.activation_intensity} />
              <AudioFeatureBar label="Affective" value={file.audioFeatures.affective_intensity} />
              <AudioFeatureBar label="Spaciousness" value={Number(file.audioFeatures.spaciousness)} />
              <AudioFeatureBar label="Tension" value={Number(file.audioFeatures.tension)} />
              <AudioFeatureLabelRow label="Energy" text={file.audioFeatures.energy_label} value={file.audioFeatures.energy} />
              <AudioFeatureLabelRow label="Valence" text={file.audioFeatures.valence_label} value={file.audioFeatures.valence} />
              <AudioFeatureLabelRow label="Danceability" text={file.audioFeatures.danceability_label} value={file.audioFeatures.danceability} />
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-gray-500 w-20 shrink-0">Tempo</span>
                <span className="text-[10px] text-gray-200">{file.audioFeatures.tempo_label || '—'}</span>
                <span className="text-[10px] text-gray-400 tabular-nums">{Number.isFinite(file.audioFeatures.tempo) ? `${file.audioFeatures.tempo.toFixed(0)} BPM` : '—'}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {(file.bandcampUrl || file.beatportUrl) && (
        <div className="flex flex-col gap-2 p-3 border-b border-surface-border">
          <SectionHeader label="Buy" open={sections.buy} onToggle={() => toggleSection('buy')} />
          {sections.buy && (
            <div className="flex gap-2 mt-1">
              {file.bandcampUrl && (
                <button
                  type="button"
                  onClick={() => window.open(file.bandcampUrl!)}
                  className="px-2.5 py-1 text-[10px] rounded border border-surface-border text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
                >
                  Bandcamp
                </button>
              )}
              {file.beatportUrl && (
                <button
                  type="button"
                  onClick={() => window.open(file.beatportUrl!)}
                  className="px-2.5 py-1 text-[10px] rounded border border-surface-border text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
                >
                  Beatport
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Duplicate MFB match */}
      {duplicates.length > 0 && (
        <div className="flex flex-col gap-2 p-3 border-b border-surface-border">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-1.5">
              <SectionHeader label="Duplicate Match" open={sections.duplicates} onToggle={() => toggleSection('duplicates')} />
              <span className="text-[10px] text-gray-500">({duplicates.length + 1} files)</span>
            </div>
          </div>
          {sections.duplicates && (
            <>
              <p className="text-[10px] text-gray-400 leading-relaxed">
                {duplicates.length} other {duplicates.length === 1 ? 'file is' : 'files are'} linked to the same Music for Breathwork track listing.
                Only one file per track is used when building sessions — unlink the duplicates to resolve.
              </p>
              <DupeRow
                id={file.id}
                fileName={file.fileName}
                folderPath={file.folderPath}
                format={file.format}
                sampleRate={file.sampleRate}
                fileSize={file.fileSize}
                isCurrent
                onUnlink={() => unlinkMfb(file.id)}
              />
              {duplicates.map((d) => (
                <DupeRow
                  key={d.id}
                  id={d.id}
                  fileName={d.fileName}
                  folderPath={d.folderPath}
                  format={d.format}
                  sampleRate={d.sampleRate}
                  fileSize={d.fileSize}
                  onPrefer={() => {
                    unlinkMfb(file.id)
                    for (const other of duplicates) { if (other.id !== d.id) unlinkMfb(other.id) }
                    selectFile(d.id)
                  }}
                  onUnlink={() => unlinkMfb(d.id)}
                  onRemove={() => removeFile(d.id)}
                />
              ))}
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => { for (const d of duplicates) unlinkMfb(d.id) }}
                  className="flex-1 py-1.5 text-[11px] rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                >
                  Unlink the other{duplicates.length > 1 ? ` ${duplicates.length}` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => { for (const d of duplicates) removeFile(d.id) }}
                  className="flex-1 py-1.5 text-[11px] rounded border border-red-500/30 bg-red-500/5 text-red-400 hover:bg-red-500/15 transition-colors"
                >
                  Remove the other{duplicates.length > 1 ? ` ${duplicates.length}` : ''}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Lookup track data from musicforbreathwork.com */}
      <TrackLookup
        key={file.id}
        fileId={file.id}
        fileName={file.fileName}
        artist={file.artist}
        folderArtist={file.artistPathGuess}
        folderAlbum={file.albumPathGuess}
        alreadyMatched={file.mfbTrackId !== null && file.mfbTrackId !== undefined}
      />

      {/* Notes */}
      <div className="flex flex-col gap-2 p-3 border-b border-surface-border">
        <SectionHeader label="Notes" open={sections.notes} onToggle={() => toggleSection('notes')} />
        {sections.notes && (
          <textarea
            value={file.notes}
            onChange={(e) => updateFile(file.id, { notes: e.target.value })}
            placeholder="Add notes…"
            rows={4}
            className="w-full text-[11px] text-gray-200 bg-surface-hover border border-surface-border rounded px-2 py-1.5 resize-none outline-none focus:border-accent/50 placeholder-gray-700 leading-relaxed mt-1"
          />
        )}
      </div>

      {/* Mix Cues — requires MFB login */}
      {userAccount && (
        <div className="flex flex-col gap-2 p-3">
          <SectionHeader label="Mix Cues" open={sections.mixCues} onToggle={() => toggleSection('mixCues')} />
          {sections.mixCues && (
            <div className="flex flex-col gap-2 mt-2">
              <button
                type="button"
                onClick={() => setShowMixCueEditor(true)}
                className="w-full py-1.5 text-[11px] rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
              >
                Set Cue Points
              </button>

              {(file.introEndMs != null || file.outroStartMs != null || file.clipStartMs != null || file.clipEndMs != null) && (
                <button
                  type="button"
                  onClick={() => updateFile(file.id, {
                    introEndMs: null, outroStartMs: null, fadeInCurve: 0, fadeOutCurve: 0,
                    clipStartMs: null, clipEndMs: null,
                  })}
                  className="w-full py-1 text-[10px] text-gray-600 hover:text-gray-300 border border-surface-border rounded transition-colors"
                >
                  Reset all cue points
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {showMixCueEditor && (
        <MixCueEditorModal
          file={file}
          onSave={(updates) => updateFile(file.id, updates)}
          onClose={() => setShowMixCueEditor(false)}
        />
      )}

      {showImportModal && (
        <SpotifyImportModal
          fileName={file.fileName}
          artist={file.artist}
          folderArtist={file.artistPathGuess}
          duration={file.duration}
          onImported={async (trackId) => {
            const ok = await applyMfbTrack(trackId)
            window.electronAPI.mfbClearCatalogue()
            if (ok) {
              if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
              setRefreshed(true)
              refreshTimerRef.current = setTimeout(() => setRefreshed(false), 3000)
            }
          }}
          onClose={() => setShowImportModal(false)}
        />
      )}

      </div>{/* end scrollable metadata */}
    </div>
  )
}

function DupeRow({
  id, fileName, folderPath, format, sampleRate, fileSize, isCurrent, onPrefer, onUnlink, onRemove,
}: {
  id: string
  fileName: string
  folderPath: string
  format: string
  sampleRate: number
  fileSize: number
  isCurrent?: boolean
  onPrefer?: () => void
  onUnlink?: () => void
  onRemove?: () => void
}): JSX.Element {
  const previewFileId = useLibraryStore((s) => s.previewFileId)
  const setPreview = useLibraryStore((s) => s.setPreview)
  const isPlaying = previewFileId === id
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)

  return (
    <div className={`flex flex-col gap-1 px-2 py-1.5 rounded border ${isCurrent ? 'border-accent/30 bg-accent/8' : 'border-surface-border bg-surface-hover'}`}>
      <div
        className="flex items-center gap-1.5 min-w-0"
        onMouseEnter={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          setTooltipPos({ x: rect.left, y: rect.top })
        }}
        onMouseLeave={() => setTooltipPos(null)}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (isPlaying) setPreview(null, [])
            else setPreview(id, [id])
          }}
          className={`shrink-0 w-4 h-4 flex items-center justify-center rounded-full border transition-colors ${
            isPlaying
              ? 'border-accent text-accent'
              : 'text-gray-600 border-gray-600 hover:border-accent hover:text-accent'
          }`}
          title={isPlaying ? 'Stop preview' : 'Preview'}
        >
          {isPlaying ? (
            <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor">
              <rect x="1.5" y="1" width="2.5" height="8" rx="0.5" />
              <rect x="6" y="1" width="2.5" height="8" rx="0.5" />
            </svg>
          ) : (
            <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor">
              <path d="M2 1.5l7 3.5-7 3.5V1.5z" />
            </svg>
          )}
        </button>
        {isCurrent && <span className="text-[9px] text-accent uppercase tracking-wider shrink-0">current</span>}
        <span className="text-[11px] text-gray-200 truncate flex-1 min-w-0">{fileName}</span>
        {tooltipPos && (
          <div
            className="fixed z-[999] bg-black rounded p-2 text-[10px] text-gray-200 shadow-lg pointer-events-none border border-white/10 max-w-xs"
            style={{ left: tooltipPos.x, top: tooltipPos.y - 8, transform: 'translateY(-100%)' }}
          >
            <div className="font-medium break-all">{fileName}</div>
            <div className="text-gray-400 mt-0.5 break-all">{folderPath}</div>
            <div className="text-gray-500 mt-0.5 uppercase">{format} · {(sampleRate / 1000).toFixed(0)} kHz · {formatSize(fileSize)}</div>
          </div>
        )}
      </div>
      <span className="text-[10px] text-gray-500 truncate" title={folderPath}>{folderPath}</span>
      <div className="flex gap-2 items-center">
        <span className="text-[10px] text-gray-500 uppercase">{format}</span>
        <span className="text-[10px] text-gray-500">{(sampleRate / 1000).toFixed(0)} kHz</span>
        <span className="text-[10px] text-gray-500">{formatSize(fileSize)}</span>
        {(onPrefer || onUnlink || onRemove) && (
          <div className="flex gap-2 ml-auto shrink-0">
            {!isCurrent && onPrefer && (
              <button type="button" onClick={onPrefer}
                className="text-[10px] text-accent hover:text-white transition-colors font-medium">
                Use this file
              </button>
            )}
            {onUnlink && (
              <button type="button" onClick={onUnlink}
                className="text-[10px] text-gray-500 hover:text-gray-200 transition-colors">
                Unlink
              </button>
            )}
            {!isCurrent && onRemove && (
              <button type="button" onClick={onRemove}
                className="text-[10px] text-gray-500 hover:text-red-400 transition-colors">
                Remove
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TagInput({ onAdd }: { onAdd: (tag: string) => void }): JSX.Element {
  return (
    <input
      type="text"
      placeholder="+ tag"
      className="w-16 text-[10px] bg-transparent text-gray-400 placeholder-gray-700 outline-none"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault()
          const val = (e.target as HTMLInputElement).value.trim()
          if (val) { onAdd(val); (e.target as HTMLInputElement).value = '' }
        }
      }}
    />
  )
}

function AudioFeatureBar({ label, value }: { label: string; value: number | null | undefined }): JSX.Element {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : null
  return (
    <div className="flex gap-2 items-center">
      <span className="text-[10px] text-gray-400 w-20 shrink-0">{label}</span>
      <div className="overflow-hidden flex-1 h-1 rounded-full bg-surface-hover">
        <div className="h-full rounded-full bg-accent/50" style={{ width: `${Math.round((v ?? 0) * 100)}%` }} />
      </div>
      <span className="text-[10px] text-gray-300 tabular-nums w-8 text-right">{v === null ? '—' : v.toFixed(2)}</span>
    </div>
  )
}

function AudioFeatureLabelRow({ label, text, value }: { label: string; text: string; value: number | null | undefined }): JSX.Element {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return (
    <div className="flex gap-2 items-center">
      <span className="text-[10px] text-gray-400 w-20 shrink-0">{label}</span>
      <div className="overflow-hidden flex-1 h-1 rounded-full bg-surface-hover">
        <div className="h-full rounded-full bg-accent/50" style={{ width: `${Math.round(v * 100)}%` }} />
      </div>
      <span className="text-[10px] text-gray-200 text-right truncate max-w-[90px]">{text || '—'}</span>
    </div>
  )
}
