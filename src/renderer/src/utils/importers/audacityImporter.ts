import { nanoid } from '../nanoid'
import { pickTrackColor } from '../../types'
import type { Track, Clip } from '../../types'
import type { ImportResult } from './sesxImporter'

function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? ''
}

function numAttr(el: Element, name: string, fallback = 0): number {
  const v = parseFloat(el.getAttribute(name) ?? '')
  return isNaN(v) ? fallback : v
}

export function parseAudacitySession(xml: string): ImportResult {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) throw new Error('Invalid .aup file: XML parse error')

  // Audacity project rate
  const projectEl = doc.querySelector('project')
  if (!projectEl) throw new Error('Invalid .aup file: no <project> element')

  const projectRate = numAttr(projectEl, 'rate', 44100)

  const tracks: Track[] = []
  const clips: Clip[] = []
  const warnings: string[] = []

  // Audacity represents stereo as two linked <wavetrack> elements.
  // We collect all wavetracks and de-duplicate linked pairs (take channel 0).
  const allWavetracks = Array.from(doc.querySelectorAll('wavetrack'))
  const seen = new Set<Element>()
  let order = 0

  for (const wt of allWavetracks) {
    if (seen.has(wt)) continue
    seen.add(wt)

    const linked = attr(wt, 'linked') === '1'
    // If linked, find the partner (next sibling wavetrack) and skip it
    if (linked) {
      const next = wt.nextElementSibling
      if (next && next.tagName === 'wavetrack') seen.add(next)
    }

    const trackId = nanoid()
    const name = attr(wt, 'name') || `Track ${order + 1}`
    const volume = Math.min(numAttr(wt, 'gain', 1), 2)
    const muted = attr(wt, 'mute') === '1'
    const solo = attr(wt, 'solo') === '1'
    const rate = numAttr(wt, 'rate', projectRate)
    const toSec = (samples: number): number => samples / rate

    tracks.push({ id: trackId, name, color: pickTrackColor(order), volume, muted, solo, order })
    order++

    // Each <waveclip> within the wavetrack is one clip on the timeline
    const waveclips = Array.from(wt.querySelectorAll('waveclip'))
    if (waveclips.length === 0) {
      // Older AUP: clips may be directly in the wavetrack via <sequence>/<import>
      const importEl = wt.querySelector('sequence > import')
      const filePath = importEl ? attr(importEl, 'filename') : ''
      const clipOffset = numAttr(wt, 'offset', 0)
      const lenSamples = importEl ? numAttr(importEl, 'len') : 0

      if (!filePath) {
        warnings.push(
          `Track "${name}" has no original file path — audio is stored in Audacity block format and cannot be imported directly.`
        )
        return { tracks, clips, warnings }
      }

      const duration = lenSamples > 0 ? toSec(lenSamples) : 0
      const fileName = (filePath.split('/').pop() ?? name).replace(/\.[^.]+$/, '')
      clips.push({
        id: nanoid(),
        trackId,
        filePath,
        fileName,
        startTime: clipOffset,
        duration,
        trimStart: 0,
        trimEnd: 0,
        fadeIn: 0,
        fadeOut: 0,
        fadeInCurve: 0.5,
        fadeOutCurve: 0.5,
        crossfadeIn: 0,
        crossfadeOut: 0,
        volume: 1,
        automation: [],
      })
      continue
    }

    for (const waveclip of waveclips) {
      const clipOffset = numAttr(waveclip, 'offset', 0)
      const trimLeft = numAttr(waveclip, 'trimLeft', 0)
      const trimRight = numAttr(waveclip, 'trimRight', 0)

      // Look for an <import> inside this waveclip's <sequence>
      const importEl = waveclip.querySelector('sequence > import')
      const filePath = importEl ? attr(importEl, 'filename') : ''
      const lenSamples = importEl ? numAttr(importEl, 'len') : 0

      if (!filePath) {
        warnings.push(
          `A clip in track "${name}" has no original file path. ` +
            'Re-import the project with "Read directly from original files" in Audacity preferences, or re-link manually.'
        )
        continue
      }

      const duration = lenSamples > 0 ? toSec(lenSamples) : 0
      const fileName = (filePath.split('/').pop() ?? name).replace(/\.[^.]+$/, '')

      clips.push({
        id: nanoid(),
        trackId,
        filePath,
        fileName,
        startTime: clipOffset + trimLeft,
        duration: duration - trimRight,
        trimStart: trimLeft,
        trimEnd: trimRight,
        fadeIn: 0,
        fadeOut: 0,
        fadeInCurve: 0.5,
        fadeOutCurve: 0.5,
        crossfadeIn: 0,
        crossfadeOut: 0,
        volume: 1,
        automation: [],
      })
    }
  }

  return { tracks, clips, warnings }
}
