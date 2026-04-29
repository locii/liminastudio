import { useMemo } from 'react'

interface Props {
  zoom: number
  duration: number
  height: number
}

function formatRulerTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return sec === 0 ? `${m}:00` : `${m}:${String(sec).padStart(2, '0')}`
}

export function TimeRuler({ zoom, duration, height }: Props): JSX.Element {
  const ticks = useMemo(() => {
    // Adapt tick density to zoom level
    const minor = zoom < 4 ? 60 : zoom < 8 ? 30 : zoom < 20 ? 10 : zoom < 50 ? 5 : 1
    const major = minor * 4

    const result: { time: number; isMajor: boolean }[] = []
    for (let t = 0; t <= Math.ceil(duration); t += minor) {
      result.push({ time: t, isMajor: t % major === 0 })
    }
    return result
  }, [zoom, duration])

  return (
    <div
      className="sticky top-0 z-40 bg-surface-panel border-b border-surface-border select-none"
      style={{ height, position: 'sticky' }}
    >
      {ticks.map(({ time, isMajor }) => (
        <div
          key={time}
          className="absolute bottom-0 flex flex-col items-start"
          style={{ left: `${time * zoom}px` }}
        >
          {/* Tick line */}
          <div
            className="w-px"
            style={{
              height: isMajor ? height * 0.6 : height * 0.3,
              background: isMajor ? '#4a4a4a' : '#2a2a2a',
            }}
          />
          {/* Label on major ticks */}
          {isMajor && (
            <span className="absolute bottom-1 left-1 text-[10px] text-gray-500 tabular-nums whitespace-nowrap">
              {formatRulerTime(time)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
