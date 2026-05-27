import { useEffect, useRef, useState } from 'react'
import { CHANGELOG } from '../../data/changelog'

interface Props {
  open: boolean
  onClose: () => void
}

export function WhatsNewModal({ open, onClose }: Props): JSX.Element | null {
  const [visible, setVisible] = useState(false)
  const [pastVersionsOpen, setPastVersionsOpen] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) {
      // Tiny delay so the transition plays on mount
      const t = setTimeout(() => setVisible(true), 10)
      return () => clearTimeout(t)
    } else {
      setVisible(false)
    }
  }, [open])

  useEffect(() => {
    if (open) closeRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const [current, ...past] = CHANGELOG

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="relative flex flex-col w-[520px] max-h-[80vh] rounded-2xl overflow-hidden shadow-2xl border border-white/10 transition-all duration-200"
        style={{
          background: '#161618',
          opacity: visible ? 1 : 0,
          transform: visible ? 'scale(1) translateY(0)' : 'scale(0.97) translateY(8px)',
        }}
      >
        {/* Header band */}
        <div className="shrink-0 px-7 pt-7 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold tracking-widest uppercase text-indigo-400/80">
                  What&apos;s new
                </span>
                <span className="text-[10px] font-mono text-white/20">v{current.version}</span>
              </div>
              <h2 className="text-xl font-semibold text-white leading-tight">
                Limina Mix updated
              </h2>
              <p className="text-xs text-white/35 mt-0.5">{current.date}</p>
            </div>
            <button
              ref={closeRef}
              onClick={onClose}
              className="mt-0.5 shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-white/30 hover:text-white/70 hover:bg-white/8 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="shrink-0 h-px mx-7 bg-white/8" />

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-7 py-5 flex flex-col gap-5">
          {/* Current version sections */}
          {current.sections.map((section) => (
            <div key={section.title}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base leading-none">{section.icon}</span>
                <span className="text-xs font-semibold text-white/80 tracking-wide">
                  {section.title}
                </span>
              </div>
              <ul className="flex flex-col gap-1 pl-6">
                {section.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs text-white/45 leading-relaxed">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-indigo-400/50 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Previous versions — collapsed */}
          {past.length > 0 && (
            <div>
              <button
                onClick={() => setPastVersionsOpen((v) => !v)}
                className="flex items-center gap-1.5 text-[10px] text-white/25 hover:text-white/50 transition-colors"
              >
                <svg
                  className={`w-3 h-3 transition-transform ${pastVersionsOpen ? 'rotate-90' : ''}`}
                  viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
                >
                  <polyline points="4,2 8,6 4,10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Previous versions
              </button>

              {pastVersionsOpen && (
                <div className="mt-3 flex flex-col gap-4 pl-2 border-l border-white/8">
                  {past.map((entry) => (
                    <div key={entry.version}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-mono text-white/25">v{entry.version}</span>
                        <span className="text-[10px] text-white/20">{entry.date}</span>
                      </div>
                      {entry.sections.map((section) => (
                        <div key={section.title} className="mb-2 last:mb-0">
                          <p className="text-[10px] font-medium text-white/40 mb-1">{section.title}</p>
                          <ul className="flex flex-col gap-0.5 pl-3">
                            {section.items.map((item) => (
                              <li key={item} className="text-[10px] text-white/25 leading-relaxed">
                                · {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-7 pb-6 pt-4">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
          >
            Let&apos;s go
          </button>
        </div>
      </div>
    </div>
  )
}
