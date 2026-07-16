import { useMemo, useState } from 'react'
import { useLibraryStore } from '../store/libraryStore'
import type { MixSession } from '../store/libraryStore'
import { getMixEngine } from '../lib/mixEngineSingleton'

function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}
function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 60) return `${totalMin}m`
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`
}

// Merge the played tracklist and the plan edits into one chronological timeline.
type Row =
  | { atMs: number; kind: 'track'; title: string; artist: string; tags: string[] | null; fadeInMs: number; startMs: number; playedMs: number; ended: string | null }
  | { atMs: number; kind: 'edit'; summary: string }

function buildTimeline(session: MixSession): Row[] {
  const rows: Row[] = [
    ...session.played.map((p): Row => ({ atMs: p.atMs, kind: 'track', title: p.title, artist: p.artist, tags: p.fromTags, fadeInMs: p.fadeInMs ?? 0, startMs: p.startMs ?? 0, playedMs: p.playedMs, ended: p.ended })),
    ...session.edits.map((e): Row => ({ atMs: e.atMs, kind: 'edit', summary: e.summary })),
  ]
  return rows.sort((a, b) => a.atMs - b.atMs)
}

function fadeSecs(ms: number): string {
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`
}

function sessionToText(session: MixSession): string {
  const lines: string[] = []
  lines.push(session.name)
  lines.push(`${new Date(session.startedAt).toLocaleString()} · ${fmtDuration(session.durationMs)} · ${session.played.length} tracks`)
  lines.push('')
  for (const r of buildTimeline(session)) {
    if (r.kind === 'track') {
      const tags = r.tags && r.tags.length ? `  [${r.tags.join(', ')}]` : ''
      const who = r.artist ? ` — ${r.artist}` : ''
      const xf = r.fadeInMs > 0 ? `  (↝ ${fadeSecs(r.fadeInMs)} crossfade in)` : ''
      lines.push(`${fmtClock(r.atMs).padStart(6)}  ${r.title}${who}${tags}${xf}`)
    } else {
      lines.push(`${fmtClock(r.atMs).padStart(6)}  · ${r.summary}`)
    }
  }
  return lines.join('\n')
}

export function SessionsModal({ onClose, initialSessionId }: { onClose: () => void; initialSessionId?: string | null }): JSX.Element {
  const sessions = useLibraryStore((s) => s.mixSessions)
  const deleteMixSession = useLibraryStore((s) => s.deleteMixSession)
  const saveSessionAsTemplate = useLibraryStore((s) => s.saveSessionAsTemplate)
  const loadSession = useLibraryStore((s) => s.loadSession)

  const replaySession = (session: MixSession): void => {
    loadSession(session.id)
    const e = getMixEngine()
    e.xfadeMs = session.skeleton.mixFadeMs   // sync now so the first crossfade is right
    e.play()                                 // this click is a valid audio gesture
    onClose()
  }

  const [expandedId, setExpandedId] = useState<string | null>(initialSessionId ?? sessions[0]?.id ?? null)
  const [namingId, setNamingId] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const expanded = useMemo(() => sessions.find((s) => s.id === expandedId) ?? null, [sessions, expandedId])
  const timeline = useMemo(() => (expanded ? buildTimeline(expanded) : []), [expanded])

  const copyTracklist = async (session: MixSession): Promise<void> => {
    try {
      await navigator.clipboard.writeText(sessionToText(session))
      setCopiedId(session.id)
      setTimeout(() => setCopiedId((c) => (c === session.id ? null : c)), 1500)
    } catch { /* ignore */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-surface-panel rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border shrink-0">
          <h2 className="text-sm font-semibold text-white">Recorded sessions</h2>
          <button onClick={onClose} className="ml-4 text-gray-500 transition-colors hover:text-white shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg>
          </button>
        </div>

        {sessions.length === 0 ? (
          <p className="px-6 py-10 text-[12px] text-gray-600 text-center">No sessions recorded yet.</p>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* Session list */}
            <div className="w-56 border-r border-surface-border overflow-y-auto shrink-0">
              {sessions.map((s) => (
                <button key={s.id} type="button" onClick={() => setExpandedId(s.id)}
                  className={`w-full text-left px-4 py-2.5 border-b border-surface-border/50 transition-colors ${expandedId === s.id ? 'bg-accent/10' : 'hover:bg-surface-hover'}`}>
                  <div className={`text-[12px] truncate ${expandedId === s.id ? 'text-gray-100' : 'text-gray-300'}`}>{s.name}</div>
                  <div className="text-[10px] text-gray-600 mt-0.5">
                    {new Date(s.startedAt).toLocaleDateString()} · {fmtDuration(s.durationMs)} · {s.played.length} tracks
                  </div>
                </button>
              ))}
            </div>

            {/* Session detail */}
            <div className="flex flex-col flex-1 min-w-0">
              {expanded && (
                <>
                  <div className="flex items-center gap-2 px-5 py-3 border-b border-surface-border shrink-0">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-gray-100 truncate">{expanded.name}</div>
                      <div className="text-[10px] text-gray-600 mt-0.5">{new Date(expanded.startedAt).toLocaleString()} · {fmtDuration(expanded.durationMs)}</div>
                    </div>
                    <button type="button" onClick={() => replaySession(expanded)} disabled={expanded.played.length === 0}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] text-accent border border-accent/40 bg-accent/10 rounded hover:bg-accent/20 transition-colors shrink-0 disabled:opacity-40"
                      title="Load this session's tracklist and start playing">
                      <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="currentColor"><path d="M2 1.5l7 3.5-7 3.5V1.5z" /></svg>
                      Load & play
                    </button>
                    <button type="button" onClick={() => copyTracklist(expanded)}
                      className="px-2.5 py-1 text-[10px] text-gray-300 border border-surface-border rounded hover:border-accent/50 hover:text-white transition-colors shrink-0">
                      {copiedId === expanded.id ? 'Copied ✓' : 'Export tracklist'}
                    </button>
                    {namingId === expanded.id ? (
                      <span className="flex items-center gap-1 shrink-0">
                        <input autoFocus value={templateName} onChange={(e) => setTemplateName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && templateName.trim()) { saveSessionAsTemplate(expanded.id, templateName.trim()); setNamingId(null) } else if (e.key === 'Escape') setNamingId(null) }}
                          placeholder="Template name…"
                          className="w-28 bg-surface-hover border border-surface-border rounded px-1.5 py-1 text-[10px] text-gray-200 placeholder-gray-600 outline-none focus:border-accent/50" />
                        <button type="button" onMouseDown={(e) => { e.preventDefault(); if (templateName.trim()) { saveSessionAsTemplate(expanded.id, templateName.trim()); setNamingId(null) } }}
                          className="text-[10px] text-accent hover:text-accent/80 transition-colors">Save</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => { setNamingId(expanded.id); setTemplateName(`${expanded.name} (template)`) }}
                        className="px-2.5 py-1 text-[10px] text-gray-300 border border-surface-border rounded hover:border-accent/50 hover:text-white transition-colors shrink-0">
                        Save as template
                      </button>
                    )}
                    <button type="button" onClick={() => { deleteMixSession(expanded.id); setExpandedId(null) }}
                      className="text-gray-600 transition-colors hover:text-red-400 shrink-0" title="Delete session">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 3h8M4.5 3V2h3v1M4 3v6M6 3v6M8 3v6M3 3l.5 7h5l.5-7" /></svg>
                    </button>
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto px-5 py-2">
                    {timeline.length === 0 ? (
                      <p className="py-6 text-[11px] text-gray-600 text-center">Nothing was captured in this session.</p>
                    ) : timeline.map((r, i) => (
                      <div key={i}>
                        {r.kind === 'track' && r.fadeInMs > 0 && (
                          <div className="flex items-center gap-1.5 pl-14 py-0.5 text-[10px] text-accent/80" title="Crossfade into the next track">
                            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M1 5h9l-2-2M15 11H6l2 2" /></svg>
                            <span className="tabular-nums">{fadeSecs(r.fadeInMs)} crossfade</span>
                          </div>
                        )}
                        <div className="flex items-baseline gap-3 py-1 text-[11px] border-b border-surface-border/30">
                          <span className="w-12 text-right font-mono text-[10px] text-gray-600 tabular-nums shrink-0">{fmtClock(r.atMs)}</span>
                          {r.kind === 'track' ? (
                            <span className="flex items-baseline gap-2 min-w-0 flex-1">
                              <span className="text-gray-200 truncate">{r.title}</span>
                              {r.artist && <span className="text-gray-500 truncate max-w-[30%]">{r.artist}</span>}
                              {r.startMs > 0 && <span className="text-[9px] text-gray-600 shrink-0 tabular-nums" title="Started at this point in the track">from {fmtClock(r.startMs)}</span>}
                              {r.tags && r.tags.length > 0 && <span className="text-accent/70 text-[10px] truncate">[{r.tags.join(', ')}]</span>}
                              {r.ended === 'skip' && <span className="text-[9px] text-gray-600 shrink-0">skipped</span>}
                            </span>
                          ) : (
                            <span className="flex-1 min-w-0 text-gray-500 italic truncate">· {r.summary}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
