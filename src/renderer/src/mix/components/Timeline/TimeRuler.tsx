import { useMemo } from 'react'

interface Props {
  zoom: number
  duration: number
  height: number
}

// Nice intervals in seconds — pick the smallest one that gives enough pixel spacing
const NICE_INTERVALS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
const MIN_LABEL_PX = 72  // minimum pixels between major labels
const MIN_MINOR_PX = 5   // minimum pixels between minor ticks

function pickIntervals(zoom: number): { major: number; minor: number } {
  const major = NICE_INTERVALS.find((n) => n * zoom >= MIN_LABEL_PX) ?? 3600
  const minor = NICE_INTERVALS.find((n) => n * zoom >= MIN_MINOR_PX && n < major) ?? major
  return { major, minor }
}

function formatLabel(s: number, majorInterval: number): string {
  if (s === 0) return '0:00'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (majorInterval >= 3600 && sec === 0 && m === 0) return `${h}h`
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function TimeRuler({ zoom, duration, height }: Props): JSX.Element {
  const ticks = useMemo(() => {
    const { major, minor } = pickIntervals(zoom)
    const result: { time: number; isMajor: boolean }[] = []
    for (let t = 0; t <= Math.ceil(duration); t += minor) {
      result.push({ time: t, isMajor: t % major === 0 })
    }
    return result
  }, [zoom, duration])

  const { major } = useMemo(() => pickIntervals(zoom), [zoom])

  return (
    <div className="bg-surface-panel select-none" style={{ height }}>
      {ticks.map(({ time, isMajor }) => (
        <div
          key={time}
          className="absolute bottom-0 flex flex-col items-start"
          style={{ left: `${time * zoom}px` }}
        >
          <div
            className="w-px"
            style={{
              height: isMajor ? height * 0.6 : height * 0.3,
              background: isMajor ? '#4a4a4a' : '#2a2a2a',
            }}
          />
          {isMajor && (
            <span className="absolute bottom-1 left-1 text-[10px] text-gray-500 tabular-nums whitespace-nowrap">
              {formatLabel(time, major)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
