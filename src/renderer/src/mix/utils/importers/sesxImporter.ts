import { nanoid } from '../nanoid'
import { pickTrackColor } from '../../types'
import type { Track, Clip } from '../../types'

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

      const clipGainParam = clipEl.querySelector('component[id="clipGain"] parameter[index="0"]')
      const clipVolume = clipGainParam ? numAttr(clipGainParam, 'parameterValue', 1) : 1

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
        volume: Math.min(clipVolume, 2),
        automation: [],
      })
    })
  })

  return { tracks, clips, warnings }
}
