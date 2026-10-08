import { useMemo } from 'react'
import type React from 'react'
import type { Clip } from '../../types'
import type { MfbAudioFeatures } from '../../../../../shared/types'

export type ArcMetric = 'affective_intensity' | 'activation_intensity' | 'tension' | 'spaciousness'

export const ARC_METRICS: { key: ArcMetric; label: string }[] = [
  { key: 'affective_intensity', label: 'Affective intensity' },
  { key: 'activation_intensity', label: 'Activating intensity' },
  { key: 'tension', label: 'Tension' },
  { key: 'spaciousness', label: 'Spaciousness' },
]

export function isArcMetric(v: string): v is ArcMetric {
  return ARC_METRICS.some((m) => m.key === v)
}

interface Props {
  contentRef: React.RefObject<HTMLDivElement>
  clips: Clip[]
  /** Library audio features by file path (MFB or locally estimated). */
  featuresByPath: Map<string, MfbAudioFeatures>
  metric: ArcMetric
  zoom: number
  totalWidth: number
  totalDuration: number
  height: number
}

const PAD = 4

/**
 * The shape of the journey: a curve of the chosen audio feature across the
 * whole timeline. Overlapping clips are blended by where each sits in its fade,
 * so crossfades read as a smooth hand-over. Gaps (no clip, or no feature data)
 * break the line.
 */
export function EnergyArcLane({ contentRef, clips, featuresByPath, metric, zoom, totalWidth, totalDuration, height }: Props): JSX.Element {
  const { paths, coverage } = useMemo(() => {
    const spans = clips
      .map((c) => {
        const f = featuresByPath.get(c.filePath)
        const start = c.startTime
        const end = c.startTime + c.duration - c.trimStart - c.trimEnd
        return f ? {
          start, end,
          fadeIn: Math.max(c.fadeIn, c.crossfadeIn ?? 0),
          fadeOut: Math.max(c.fadeOut, c.crossfadeOut ?? 0),
          value: Math.max(0, Math.min(1, f[metric] ?? 0)),
        } : null
      })
      .filter((s): s is NonNullable<typeof s> => s !== null && s.end > s.start)

    const samples = Math.max(50, Math.min(2000, Math.round(totalDuration / 4)))
    const step = totalDuration / samples
    const usable = height - PAD * 2

    // Scale to this session's own range (min span 0.2) so the journey's shape
    // is visible even when every track sits mid-scale.
    let lo = 1
    let hi = 0
    for (const s of spans) { lo = Math.min(lo, s.value); hi = Math.max(hi, s.value) }
    if (hi - lo < 0.2) { const mid = (hi + lo) / 2; lo = Math.max(0, mid - 0.1); hi = Math.min(1, mid + 0.1) }
    const norm = (v: number): number => (hi > lo ? (v - lo) / (hi - lo) : 0.5)

    const runs: [number, number][][] = []
    let run: [number, number][] = []
    for (let i = 0; i <= samples; i++) {
      const t = i * step
      let sum = 0
      let weight = 0
      for (const s of spans) {
        if (t < s.start || t >= s.end) continue
        // Weight by position in the fade so crossfades blend smoothly.
        const wIn = s.fadeIn > 0 ? Math.min(1, (t - s.start) / s.fadeIn) : 1
        const wOut = s.fadeOut > 0 ? Math.min(1, (s.end - t) / s.fadeOut) : 1
        const w = Math.max(0.05, Math.min(wIn, wOut))
        sum += s.value * w
        weight += w
      }
      if (weight > 0) {
        run.push([t * zoom, PAD + usable * (1 - norm(sum / weight))])
      } else if (run.length) {
        runs.push(run); run = []
      }
    }
    if (run.length) runs.push(run)

    const base = height - PAD
    const toPath = (pts: [number, number][]): { line: string; area: string } => {
      const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
      const area = `${line}L${pts[pts.length - 1][0].toFixed(1)},${base}L${pts[0][0].toFixed(1)},${base}Z`
      return { line, area }
    }
    return {
      paths: runs.filter((r) => r.length > 1).map(toPath),
      coverage: spans.length,
    }
  }, [clips, featuresByPath, metric, zoom, totalDuration, height])

  return (
    <div className="relative overflow-hidden border-t shrink-0 border-surface-border bg-surface-base" style={{ height }}>
      <div ref={contentRef} className="absolute top-0 left-0 h-full will-change-transform" style={{ width: `${totalWidth}px`, minWidth: '100%' }}>
        <svg width={totalWidth} height={height} className="block" aria-hidden>
          <defs>
            <linearGradient id="arc-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.45" />
              <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {/* Mid line */}
          <line x1="0" x2={totalWidth} y1={height / 2} y2={height / 2} stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4" />
          {paths.map((p, i) => (
            <g key={i}>
              <path d={p.area} fill="url(#arc-fill)" />
              <path d={p.line} fill="none" stroke="rgb(var(--accent))" strokeWidth="1.5" strokeLinejoin="round" />
            </g>
          ))}
        </svg>
      </div>
      {coverage === 0 && (
        <p className="absolute inset-0 flex items-center px-3 text-[10px] text-gray-500 pointer-events-none">
          No audio-feature data for these tracks yet — match them to Music for Breathwork or run "Estimate audio features" in the Library.
        </p>
      )}
    </div>
  )
}

export function EnergyArcHeader({ height, metric, onMetricChange }: {
  height: number
  metric: ArcMetric
  onMetricChange: (m: ArcMetric) => void
}): JSX.Element {
  return (
    <div className="flex items-center justify-between px-3 border-t shrink-0 border-surface-border bg-surface-panel" style={{ height }}>
      <span className="text-[9px] font-bold tracking-widest uppercase text-gray-500">Arc</span>
      <select
        value={metric}
        onChange={(e) => onMetricChange(e.target.value as ArcMetric)}
        title="Which audio feature the arc shows"
        className="bg-transparent text-[10px] text-gray-300 outline-none cursor-pointer"
      >
        {ARC_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
      </select>
    </div>
  )
}
