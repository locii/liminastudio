import { useEffect, useRef, useState } from 'react'
import { CHANGELOG } from '../data/changelog'

interface Props {
  open: boolean
  onClose: () => void
}

export function WhatsNewModal({ open, onClose }: Props): JSX.Element | null {
  const [visible, setVisible] = useState(false)
  const [pastOpen, setPastOpen] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) {
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
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const [current, ...past] = CHANGELOG

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="relative flex flex-col w-[480px] max-h-[78vh] rounded-xl overflow-hidden shadow-2xl border border-surface-border bg-surface-panel transition-all duration-200"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'scale(1) translateY(0)' : 'scale(0.97) translateY(8px)',
        }}
      >
        {/* Header */}
        <div className="shrink-0 px-6 pt-6 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold tracking-widest uppercase text-accent/80">
                  What&apos;s new
                </span>
                <span className="text-[10px] font-mono text-gray-600">v{current.version}</span>
              </div>
              <h2 className="text-sm font-semibold text-gray-100">Limina Library updated</h2>
              <p className="text-[10px] text-gray-600 mt-0.5">{current.date}</p>
            </div>
            <button
              ref={closeRef}
              onClick={onClose}
              className="mt-0.5 shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[11px] text-gray-600 hover:text-gray-300 hover:bg-white/8 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="shrink-0 h-px mx-6 bg-surface-border" />

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {current.sections.map((section) => (
            <div key={section.title}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-sm leading-none">{section.icon}</span>
                <span className="text-[11px] font-semibold text-gray-200">{section.title}</span>
              </div>
              <ul className="flex flex-col gap-1 pl-5">
                {section.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-[11px] text-gray-500 leading-relaxed">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-accent/50 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Previous versions */}
          {past.length > 0 && (
            <div className="mt-1">
              <button
                onClick={() => setPastOpen((v) => !v)}
                className="flex items-center gap-1.5 text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
              >
                <svg
                  className={`w-2.5 h-2.5 transition-transform ${pastOpen ? 'rotate-90' : ''}`}
                  viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
                >
                  <polyline points="4,2 8,6 4,10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Previous versions
              </button>

              {pastOpen && (
                <div className="mt-3 flex flex-col gap-4 pl-2 border-l border-surface-border">
                  {past.map((entry) => (
                    <div key={entry.version}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] font-mono text-gray-600">v{entry.version}</span>
                        <span className="text-[10px] text-gray-700">{entry.date}</span>
                      </div>
                      {entry.sections.map((section) => (
                        <div key={section.title} className="mb-2 last:mb-0">
                          <p className="text-[10px] font-medium text-gray-500 mb-1">{section.title}</p>
                          <ul className="flex flex-col gap-0.5 pl-3">
                            {section.items.map((item) => (
                              <li key={item} className="text-[10px] text-gray-600 leading-relaxed">· {item}</li>
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
        <div className="shrink-0 px-6 pb-5 pt-3">
          <button
            onClick={onClose}
            className="w-full py-2 rounded-lg bg-accent hover:bg-accent/80 text-white text-[11px] font-medium transition-colors"
          >
            Let&apos;s go
          </button>
        </div>
      </div>
    </div>
  )
}
