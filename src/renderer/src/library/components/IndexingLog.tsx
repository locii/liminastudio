import { useEffect, useRef, useState, useCallback } from 'react'
import { useLibraryStore } from '../store/libraryStore'
import { syncLibraryToMfb } from '../lib/syncLibrary'

interface Props {
  onClose: () => void
  onSelectFile: (id: string) => void
}

export function IndexingLog({ onClose, onSelectFile }: Props): JSX.Element {
  const files = useLibraryStore((s) => s.files)
  const pendingMatches = useLibraryStore((s) => s.pendingMatches)
  const applyPendingMatch = useLibraryStore((s) => s.applyPendingMatch)
  const clearPendingMatch = useLibraryStore((s) => s.clearPendingMatch)
  const removeFile = useLibraryStore((s) => s.removeFile)

  const indexed = files.filter((f) => f.mfbIndexed && !f.mfbApplied)
  const queue = files.filter((f) => !f.mfbIndexed)
  const matchCount = indexed.filter((f) => pendingMatches[f.id]).length

  const [playingFileId, setPlayingFileId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioPortRef = useRef<number>(0)

  useEffect(() => {
    window.electronAPI.getAudioServerPort().then((p) => { audioPortRef.current = p })
  }, [])

  useEffect(() => () => { audioRef.current?.pause() }, [])

  const togglePreview = useCallback((filePath: string, fileId: string) => {
    if (playingFileId === fileId) {
      audioRef.current?.pause()
      setPlayingFileId(null)
    } else {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
      const audio = new Audio(`http://127.0.0.1:${audioPortRef.current}${encodeURI(filePath)}`)
      audio.onended = () => setPlayingFileId(null)
      audio.play().catch(console.error)
      audioRef.current = audio
      setPlayingFileId(fileId)
    }
  }, [playingFileId])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="flex fixed inset-0 z-50 justify-center items-center bg-black/60"
      onMouseDown={onClose}
    >
      <div
        className="relative w-[480px] max-h-[70vh] flex flex-col rounded-lg border border-surface-border bg-surface-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-4 py-3 border-b border-surface-border shrink-0">
          <span className="text-[11px] font-semibold text-gray-300 uppercase tracking-wider">MFB Indexing Log</span>
          <div className="flex gap-3 items-center">
            <span className="text-[10px] text-gray-600 tabular-nums">
              {matchCount} matched · {indexed.length - matchCount} no match · {queue.length} queued
            </span>
            <button type="button" onClick={onClose} className="text-gray-500 transition-colors hover:text-gray-400">
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1">

          {/* Full indexed list */}
          {indexed.length > 0 && (
            <section>
              <p className="px-4 pt-3 pb-1 text-[10px] text-gray-600 uppercase tracking-wider">
                Indexed — {indexed.length}
              </p>
              {[...indexed].reverse().map((f) => {
                const match = pendingMatches[f.id]
                return (
                  <div
                    key={f.id}
                    className="flex items-center gap-2.5 px-4 py-1.5 hover:bg-surface-hover transition-colors group"
                  >
                    {match ? (
                      <svg className="w-3 h-3 text-green-500 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M2 6l3 3 5-5" />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3 text-gray-500 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M3 3l6 6M9 3l-6 6" />
                      </svg>
                    )}
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => { onSelectFile(f.id); onClose() }}
                    >
                      <p className="text-[11px] text-gray-400 truncate">{f.fileName}</p>
                      {match && (
                        <p className="text-[10px] text-accent/70 italic truncate">
                          {match.artists.map((a) => a.name).join(', ')} — {match.album.title}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 items-center opacity-0 transition-opacity shrink-0 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => togglePreview(f.filePath, f.id)}
                        title={playingFileId === f.id ? 'Stop preview' : 'Preview'}
                        className={`w-5 h-5 flex items-center justify-center rounded-full border transition-colors ${
                          playingFileId === f.id
                            ? 'border-accent text-accent !opacity-100'
                            : 'border-gray-600 text-gray-600 hover:border-accent hover:text-accent'
                        }`}
                      >
                        {playingFileId === f.id ? (
                          <svg className="w-2 h-2" viewBox="0 0 10 10" fill="currentColor">
                            <rect x="1.5" y="1" width="2.5" height="8" rx="0.5" />
                            <rect x="6" y="1" width="2.5" height="8" rx="0.5" />
                          </svg>
                        ) : (
                          <svg className="w-2 h-2" viewBox="0 0 10 10" fill="currentColor">
                            <path d="M2 1.5l7 3.5-7 3.5V1.5z" />
                          </svg>
                        )}
                      </button>
                      {match ? (
                        <>
                          <button
                            type="button"
                            onClick={() => { applyPendingMatch(f.id); syncLibraryToMfb() }}
                            className="px-2 py-0.5 text-[10px] rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            onClick={() => clearPendingMatch(f.id)}
                            className="px-2 py-0.5 text-[10px] rounded border border-surface-border text-gray-600 hover:text-gray-400 transition-colors"
                          >
                            Skip
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => removeFile(f.id)}
                          title="Remove from library"
                          className="flex justify-center items-center w-5 h-5 text-gray-500 rounded transition-colors hover:text-red-400"
                        >
                          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 3h8M5 3V2h2v1M4 3v6h4V3H4zM5 5v2M7 5v2" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </section>
          )}

          {/* Queue — truncated */}
          {queue.length > 0 && (
            <section>
              <p className="px-4 pt-3 pb-1 text-[10px] text-gray-600 uppercase tracking-wider">
                Up Next — {queue.length}
              </p>
              {queue.slice(0, 5).map((f, i) => (
                <div key={f.id} className="flex items-center gap-2.5 px-4 py-1.5 group">
                  <span className="text-[10px] text-gray-500 tabular-nums w-4 shrink-0 text-right">{i + 1}</span>
                  <p className="text-[11px] text-gray-600 truncate flex-1 min-w-0">{f.fileName}</p>
                  <div className="flex gap-1 items-center opacity-0 transition-opacity shrink-0 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => togglePreview(f.filePath, f.id)}
                      title={playingFileId === f.id ? 'Stop preview' : 'Preview'}
                      className={`w-5 h-5 flex items-center justify-center rounded-full border transition-colors ${
                        playingFileId === f.id
                          ? 'border-accent text-accent !opacity-100'
                          : 'border-gray-600 text-gray-600 hover:border-accent hover:text-accent'
                      }`}
                    >
                      {playingFileId === f.id ? (
                        <svg className="w-2 h-2" viewBox="0 0 10 10" fill="currentColor">
                          <rect x="1.5" y="1" width="2.5" height="8" rx="0.5" />
                          <rect x="6" y="1" width="2.5" height="8" rx="0.5" />
                        </svg>
                      ) : (
                        <svg className="w-2 h-2" viewBox="0 0 10 10" fill="currentColor">
                          <path d="M2 1.5l7 3.5-7 3.5V1.5z" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFile(f.id)}
                      title="Remove from library"
                      className="flex justify-center items-center w-5 h-5 text-gray-500 rounded transition-colors hover:text-red-400"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 3h8M5 3V2h2v1M4 3v6h4V3H4zM5 5v2M7 5v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
              {queue.length > 5 && (
                <p className="px-4 py-1.5 text-[10px] text-gray-500">+{queue.length - 5} more…</p>
              )}
            </section>
          )}

          {indexed.length === 0 && queue.length === 0 && (
            <p className="px-4 py-6 text-[11px] text-gray-500 text-center">No indexing activity yet.</p>
          )}

          <div className="h-3" />
        </div>
      </div>
    </div>
  )
}
