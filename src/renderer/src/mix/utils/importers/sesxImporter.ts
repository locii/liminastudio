import { nanoid } from '../nanoid'
import { pickTrackColor } from '../../types'
import type { Track, Clip, AutomationPoint } from '../../types'

export interface ImportResult {
  tracks: Track[]
  clips: Clip[]
  warnings: string[]
}

function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? ''
}

function numAttr(el: Element, name: string, fallback = 0): number {
  const v = parseFloat(el.getAttribute(name) ?? '')
  return isNaN(v) ? fallback : v
}

function mapFadeCurve(el: Element | null): number {
  if (!el) return 0.5
  const type = attr(el, 'type')
  if (type === 'cosine') return 0
  const shape = numAttr(el, 'shape', 0)
  return Math.max(-1, Math.min(1, shape / 30))
}

export function parseSesxSession(xml: string): ImportResult {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) throw new Error('Invalid .sesx file: XML parse error')

  const sessionEl = doc.querySelector('session')
  if (!sessionEl) throw new Error('Invalid .sesx file: no <session> element')

  const sampleRate = numAttr(sessionEl, 'sampleRate', 44100)
  const toSec = (samples: number): number => samples / sampleRate

  // fileID → absolute path
  const fileMap = new Map<string, string>()
  doc.querySelectorAll('files > file').forEach((f) => {
    const id = attr(f, 'id')
    const abs = attr(f, 'absolutePath')
    if (id && abs) fileMap.set(id, abs)
  })

  const tracks: Track[] = []
  const clips: Clip[] = []
  const warnings: string[] = []

  Array.from(doc.querySelectorAll('tracks > audioTrack')).forEach((trackEl, order) => {
    const trackId = nanoid()
    const index = numAttr(trackEl, 'index', order + 1)
    const name = trackEl.querySelector('trackParameters > name')?.textContent?.trim() || `Track ${index}`

    const faderParam = trackEl.querySelector('component[id="trackFader"] parameter[index="0"]')
    const volume = Math.min(faderParam ? numAttr(faderParam, 'parameterValue', 1) : 1, 2)

    const muteParam = trackEl.querySelector('component[id="trackMute"] parameter[index="1"]')
    const muted = muteParam ? numAttr(muteParam, 'parameterValue') === 1 : false

    const solo = trackEl.querySelector('trackAudioParameters')?.getAttribute('solo') === 'true'

    tracks.push({ id: trackId, name, color: pickTrackColor(order), volume, muted, solo, order })

    Array.from(trackEl.querySelectorAll('audioClip')).forEach((clipEl) => {
      const fileId = attr(clipEl, 'fileID')
      const filePath = fileMap.get(fileId)
      if (!filePath) {
        warnings.push(`Skipped clip "${attr(clipEl, 'name')}": file ID ${fileId} not found`)
        return
      }

      const startTime = toSec(numAttr(clipEl, 'startPoint'))
      const sourceInPoint = numAttr(clipEl, 'sourceInPoint')
      const sourceOutPoint = numAttr(clipEl, 'sourceOutPoint')
      const trimStart = toSec(sourceInPoint)
      // We don't have full file duration from sesx; use sourceOutPoint as the known endpoint.
      // trimEnd stays 0 — actual file duration is fetched via getAudioMetadata on load.
      const duration = toSec(sourceOutPoint)

      // Clip gain. Audition's clipGain component holds a "volume" param (index 0)
      // and a "static gain" param (index 1). When the user drew a volume envelope,
      // the volume param carries <parameterKeyframes> — those ARE the clip's volume
      // automation ("volume nodes"). Their sampleOffset is in SOURCE-file samples,
      // so subtract sourceInPoint to get time from the clip's visual start.
      const gainComp = clipEl.querySelector('component[id="clipGain"]')
      const volParam = gainComp?.querySelector('parameter[index="0"]') ?? null
      const staticGainParam = gainComp?.querySelector('parameter[index="1"]') ?? null
      const staticGain = staticGainParam ? numAttr(staticGainParam, 'parameterValue', 1) : 1
      const keyframeEls = volParam ? Array.from(volParam.querySelectorAll('parameterKeyframe')) : []
      const effectiveDuration = Math.max(0, toSec(sourceOutPoint - sourceInPoint))

      let clipVolume: number
      let automation: AutomationPoint[]
      if (keyframeEls.length > 0) {
        // Envelope drives the level; the static value is just the last-edited fader
        // position and must be ignored. clip.volume becomes the (usually unity) gain.
        clipVolume = Math.min(staticGain, 2)
        automation = keyframeEls
          .map((kf) => ({
            id: nanoid(),
            time: toSec(numAttr(kf, 'sampleOffset') - sourceInPoint),
            value: Math.max(0, Math.min(numAttr(kf, 'value', 1), 4)),
          }))
          .filter((p) => p.time >= -0.001 && p.time <= effectiveDuration + 0.5)
          .map((p) => ({ ...p, time: Math.max(0, Math.min(p.time, effectiveDuration)) }))
          .sort((a, b) => a.time - b.time)
      } else {
        const volValue = volParam ? numAttr(volParam, 'parameterValue', 1) : 1
        clipVolume = Math.min(volValue * staticGain, 2)
        automation = []
      }

      const fadeInEl = clipEl.querySelector('fadeIn')
      const fadeOutEl = clipEl.querySelector('fadeOut')
      const fadeIn = fadeInEl
        ? Math.max(0, toSec(numAttr(fadeInEl, 'endPoint') - numAttr(fadeInEl, 'startPoint')))
        : 0
      const fadeOut = fadeOutEl
        ? Math.max(0, toSec(numAttr(fadeOutEl, 'endPoint') - numAttr(fadeOutEl, 'startPoint')))
        : 0

      const fileName = (filePath.split('/').pop() ?? attr(clipEl, 'name')).replace(/\.[^.]+$/, '')

      clips.push({
        id: nanoid(),
        trackId,
        filePath,
        fileName,
        startTime,
        duration,
        trimStart,
        trimEnd: 0,
        fadeIn,
        fadeOut,
        fadeInCurve: mapFadeCurve(fadeInEl),
        fadeOutCurve: mapFadeCurve(fadeOutEl),
        crossfadeIn: 0,
        crossfadeOut: 0,
        volume: clipVolume,
        automation,
      })
    })
  })

  return { tracks, clips, warnings }
}
