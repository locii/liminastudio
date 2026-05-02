import { useTransportStore } from '../store/transportStore'
import type { Clip, Track } from '../types'

// scale lets callers produce curves in [0, scale] rather than [0, 1] so that
// setValueCurveAtTime never jumps above the clip's intended baseGain.
function buildFadeCurve(length: number, fadeOut: boolean, curveParam: number, scale = 1): Float32Array {
  const exponent = Math.pow(4, -curveParam)
  const arr = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const t = i / (length - 1)
    arr[i] = scale * (fadeOut ? Math.pow(1 - t, exponent) : Math.pow(t, exponent))
  }
  return arr
}

class AudioEngine {
  private _ctx: AudioContext | null = null
  private masterGainNode: GainNode | null = null
  private masterLimiterNode: DynamicsCompressorNode | null = null

  private analyserL: AnalyserNode | null = null
  private analyserR: AnalyserNode | null = null
  private trackAnalysers = new Map<string, AnalyserNode>()
  private audioServerPort = 0

  // Per-clip state
  private activeElements = new Map<string, HTMLAudioElement>()
  private activeSources = new Map<string, MediaElementAudioSourceNode>()
  private activeGains = new Map<string, GainNode>()     // baseGain × automation
  private activeFadeGains = new Map<string, GainNode>() // fade curves (0–1)
  private pendingTimeouts: ReturnType<typeof setTimeout>[] = []
  private reloadTimer: ReturnType<typeof setTimeout> | null = null
  private rafId: number | null = null

  // Cached for seek-while-playing
  private lastClips: Clip[] = []
  private lastTracks: Track[] = []

  // Transport position tracking
  private playStartPosition = 0
  private playStartAudioTime = 0

  // Windowed scheduling — only schedule clips starting within this many seconds.
  // An interval advances the window as playback progresses so we never schedule
  // more than a couple of tracks worth of HTTP requests simultaneously.
  private readonly scheduleWindowSec = 60
  private schedulerInterval: ReturnType<typeof setInterval> | null = null

  // Warmup
  private warmupPool: HTMLAudioElement[] = []
  private warmupCancelled = false

  private localUrl(filePath: string): string {
    return (
      `http://127.0.0.1:${this.audioServerPort}` +
      filePath.split('/').map(encodeURIComponent).join('/')
    )
  }

  private get ctx(): AudioContext {
    if (!this._ctx) this._ctx = new AudioContext()
    return this._ctx
  }

  private getMasterLimiter(): DynamicsCompressorNode {
    if (!this.masterLimiterNode) {
      this.masterLimiterNode = this.ctx.createDynamicsCompressor()
      this.masterLimiterNode.threshold.value = -0.5  // dBFS ceiling
      this.masterLimiterNode.knee.value = 0           // hard knee
      this.masterLimiterNode.ratio.value = 20         // near-infinite = limiter
      this.masterLimiterNode.attack.value = 0.001     // 1ms
      this.masterLimiterNode.release.value = 0.05     // 50ms
      this.masterLimiterNode.connect(this.ctx.destination)
    }
    return this.masterLimiterNode
  }

  private getMasterGain(): GainNode {
    if (!this.masterGainNode) {
      this.masterGainNode = this.ctx.createGain()
      // Force stereo so the channel splitter always sees a 2-channel signal
      this.masterGainNode.channelCount = 2
      this.masterGainNode.channelCountMode = 'explicit'
      this.masterGainNode.channelInterpretation = 'speakers'
      this.masterGainNode.connect(this.getMasterLimiter())
    }
    return this.masterGainNode
  }

  getTrackAnalyser(trackId: string): AnalyserNode | null {
    return this.trackAnalysers.get(trackId) ?? null
  }

  private getOrCreateTrackAnalyser(trackId: string): AnalyserNode {
    let analyser = this.trackAnalysers.get(trackId)
    if (!analyser) {
      analyser = this.ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0
      this.trackAnalysers.set(trackId, analyser)
    }
    return analyser
  }

  getAnalysers(): [AnalyserNode, AnalyserNode] {
    if (this.analyserL && this.analyserR) return [this.analyserL, this.analyserR]
    this.analyserL = this.ctx.createAnalyser()
    this.analyserR = this.ctx.createAnalyser()
    this.analyserL.fftSize = 2048
    this.analyserR.fftSize = 2048
    this.analyserL.smoothingTimeConstant = 0
    this.analyserR.smoothingTimeConstant = 0
    const splitter = this.ctx.createChannelSplitter(2)
    this.getMasterGain().connect(splitter)
    splitter.connect(this.analyserL, 0)
    splitter.connect(this.analyserR, 1)
    return [this.analyserL, this.analyserR]
  }

  setMasterVolume(v: number): void {
    const g = this.getMasterGain()
    const target = Math.max(0, v)
    if (this.ctx.state === 'running') {
      g.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 0.04)
    } else {
      g.gain.value = target
    }
  }

  // Schedule a single clip for playback from seekPosition
  private scheduleClip(clip: Clip, track: Track, seekPosition: number): void {
    const effectiveDuration = clip.duration - clip.trimStart - clip.trimEnd
    const clipEnd = clip.startTime + effectiveDuration
    if (seekPosition >= clipEnd) return

    const posInFile = clip.trimStart + Math.max(0, seekPosition - clip.startTime)
    const delayMs = (clip.startTime - seekPosition) * 1000
    const isFuture = delayMs > 50  // clip starts more than 50 ms from now

    const fadeIn = Math.max(clip.fadeIn, clip.crossfadeIn ?? 0)
    const fadeOut = Math.max(clip.fadeOut, clip.crossfadeOut ?? 0)
    const hasFadeInFromStart = fadeIn > 0 && seekPosition <= clip.startTime
    const baseGain = track.muted ? 0 : track.volume * clip.volume

    // Two GainNodes per clip so fade curves and automation never share an
    // AudioParam — mixing setValueCurveAtTime and linearRampToValueAtTime on
    // the same param throws NotSupportedError in Chrome and corrupts the queue.
    //
    //   source → clipAutoGain (baseGain × automation)
    //          → clipFadeGain (fade curve, 0–1)
    //          → masterGain / trackAnalyser

    // Initial fade component (0–1): 0 while waiting for clip start or fade-in.
    let initialFade: number
    if (hasFadeInFromStart || isFuture) {
      initialFade = 0
    } else if (fadeIn > 0 && seekPosition < clip.startTime + fadeIn) {
      const tInFade = (seekPosition - clip.startTime) / fadeIn
      initialFade = Math.pow(tInFade, Math.pow(4, -(clip.fadeInCurve ?? 0.5)))
    } else if (fadeOut > 0 && seekPosition > clipEnd - fadeOut) {
      const tInFade = (seekPosition - (clipEnd - fadeOut)) / fadeOut
      initialFade = Math.pow(1 - tInFade, Math.pow(4, -(clip.fadeOutCurve ?? 0.5)))
    } else {
      initialFade = 1
    }

    const clipAutoGain = this.ctx.createGain()
    clipAutoGain.gain.value = baseGain

    const clipFadeGain = this.ctx.createGain()
    clipFadeGain.gain.value = initialFade

    clipAutoGain.connect(clipFadeGain)
    clipFadeGain.connect(this.getMasterGain())
    clipFadeGain.connect(this.getOrCreateTrackAnalyser(track.id))
    this.activeGains.set(clip.id, clipAutoGain)
    this.activeFadeGains.set(clip.id, clipFadeGain)

    // crossOrigin must be set BEFORE src — renderer (localhost) and local:// are different
    // origins, and a tainted element cannot be used with createMediaElementSource.
    const audio = document.createElement('audio')
    audio.crossOrigin = 'anonymous'
    audio.preload = 'auto'
    audio.src = this.localUrl(clip.filePath)
    this.activeElements.set(clip.id, audio)

    // Connect to the audio graph immediately — this starts HTTP buffering in
    // parallel with any scheduling delay so files are ready when play() fires.
    let source: MediaElementAudioSourceNode
    try {
      source = this.ctx.createMediaElementSource(audio)
    } catch (err) {
      console.error('[audioEngine] createMediaElementSource failed:', err)
      return
    }
    source.connect(clipAutoGain)
    this.activeSources.set(clip.id, source)

    // GainNode automation is AudioContext-clock based so scheduling it now is
    // correct regardless of when audio.play() is actually called.
    this.scheduleFadesAndAutomation(clip, track, clipFadeGain, clipAutoGain, seekPosition, effectiveDuration, baseGain)

    // For future clips without a fade-in: snap fadeGain to 1 at exactly the
    // clip's start time. Combined with initialFade=0 this eliminates the 50 ms
    // audio bleed that the early play() would otherwise produce.
    if (isFuture && !hasFadeInFromStart) {
      clipFadeGain.gain.setValueAtTime(1, this.ctx.currentTime + delayMs / 1000)
    }

    // Seek early so the browser buffers the target region during any delay.
    audio.currentTime = posInFile

    if (delayMs <= 0) {
      // Clip is already in progress.  For a mid-file position, audio.currentTime
      // is async — wait for the seeked event so play() starts at the right frame.
      const stopMs = (clipEnd - Math.max(seekPosition, clip.startTime)) * 1000
      const doPlay = (): void => {
        audio.play().catch(console.error)
        if (stopMs > 0) {
          const stopTid = setTimeout(() => { audio.pause() }, stopMs)
          this.pendingTimeouts.push(stopTid)
        }
      }

      if (posInFile < 0.01) {
        doPlay()
      } else {
        // Wait for seek to finish, with a 1.5 s safety fallback.
        audio.addEventListener('seeked', doPlay, { once: true })
        const fallbackTid = setTimeout(() => {
          audio.removeEventListener('seeked', doPlay)
          doPlay()
        }, 1500)
        this.pendingTimeouts.push(fallbackTid)
      }
    } else {
      // Future clip — fire 50 ms early so the element is warmed up and any
      // remaining buffering jitter is absorbed.
      const stopMs = (clipEnd - clip.startTime) * 1000
      const tid = setTimeout(() => {
        audio.play().catch(console.error)
        const stopTid = setTimeout(() => { audio.pause() }, stopMs)
        this.pendingTimeouts.push(stopTid)
      }, Math.max(0, delayMs - 50))
      this.pendingTimeouts.push(tid)
    }
  }

  private scheduleFadesAndAutomation(
    clip: Clip,
    track: Track,
    clipFadeGain: GainNode,
    clipAutoGain: GainNode,
    seekPosition: number,
    effectiveDuration: number,
    baseGain?: number
  ): void {
    const now = this.ctx.currentTime
    const clipEnd = clip.startTime + effectiveDuration
    baseGain ??= track.muted ? 0 : track.volume * clip.volume

    const fadeIn = Math.max(clip.fadeIn, clip.crossfadeIn ?? 0)
    const fadeOut = Math.max(clip.fadeOut, clip.crossfadeOut ?? 0)

    // Small lookahead: scheduling events at exactly ctx.currentTime can cause
    // them to be skipped in some Chromium versions.  All "immediate" events are
    // offset by 5 ms so they land safely in the future audio-processing block.
    const EPSILON = 0.005

    // ── Fade in (on clipFadeGain, 0–1 scale) ──────────────────────────────
    if (fadeIn > 0) {
      const fadeInEnd = clip.startTime + fadeIn
      if (seekPosition < fadeInEnd) {
        const curve = buildFadeCurve(256, false, clip.fadeInCurve ?? 0.5)
        const delay = Math.max(0, clip.startTime - seekPosition)

        if (seekPosition <= clip.startTime) {
          clipFadeGain.gain.setValueAtTime(0, now + delay)
          clipFadeGain.gain.setValueCurveAtTime(curve, now + delay + EPSILON, fadeIn - EPSILON)
        } else {
          const tInFade = Math.min(1, (seekPosition - clip.startTime) / fadeIn)
          const startIdx = Math.round(tInFade * 255)
          const partialCurve = curve.slice(startIdx)
          const remainingFade = fadeInEnd - seekPosition
          if (partialCurve.length > 1 && remainingFade > EPSILON * 2) {
            clipFadeGain.gain.setValueAtTime(curve[startIdx], now)
            clipFadeGain.gain.setValueCurveAtTime(partialCurve, now + EPSILON, remainingFade - EPSILON)
          }
        }
      }
    }

    // ── Fade out (on clipFadeGain, 0–1 scale) ─────────────────────────────
    if (fadeOut > 0) {
      const fadeOutStart = clipEnd - fadeOut
      const delayToFadeOut = fadeOutStart - seekPosition
      if (delayToFadeOut > -fadeOut) {
        const curve = buildFadeCurve(256, true, clip.fadeOutCurve ?? 0.5)

        if (delayToFadeOut >= 0) {
          const audioTime = now + delayToFadeOut
          clipFadeGain.gain.setValueCurveAtTime(curve, audioTime, fadeOut)
        } else {
          const tInFade = Math.min(1, -delayToFadeOut / fadeOut)
          const startIdx = Math.round(tInFade * 255)
          const partialCurve = curve.slice(startIdx)
          const remaining = fadeOut + delayToFadeOut
          if (partialCurve.length > 1 && remaining > EPSILON * 2) {
            clipFadeGain.gain.setValueAtTime(curve[startIdx], now)
            clipFadeGain.gain.setValueCurveAtTime(partialCurve, now + EPSILON, remaining - EPSILON)
          } else {
            clipFadeGain.gain.setValueAtTime(0, now)
          }
        }
      }
    }

    // ── Volume automation (on clipAutoGain, independent of fade curves) ────
    if (clip.automation && clip.automation.length > 0) {
      const sorted = [...clip.automation].sort((a, b) => a.time - b.time)
      const tInClip = Math.max(0, seekPosition - clip.startTime)

      let initialValue = sorted[0].value
      if (tInClip >= sorted[sorted.length - 1].time) {
        initialValue = sorted[sorted.length - 1].value
      } else if (tInClip > sorted[0].time) {
        for (let i = 0; i < sorted.length - 1; i++) {
          const a = sorted[i]
          const b = sorted[i + 1]
          if (tInClip >= a.time && tInClip <= b.time) {
            const frac = (tInClip - a.time) / (b.time - a.time)
            initialValue = a.value + frac * (b.value - a.value)
            break
          }
        }
      }

      clipAutoGain.gain.setValueAtTime(baseGain * initialValue, now)
      for (const pt of sorted) {
        const ptAudioTime = now + (clip.startTime + pt.time - seekPosition)
        if (ptAudioTime > now) {
          clipAutoGain.gain.linearRampToValueAtTime(baseGain * pt.value, ptAudioTime)
        }
      }
    }
  }

  // Schedule only clips whose start time falls within [seekPos, seekPos + window].
  // Clips already in activeElements are skipped (already scheduled).
  private scheduleWindowFrom(seekPos: number): void {
    const windowEnd = seekPos + this.scheduleWindowSec
    const trackMap = new Map(this.lastTracks.map((t) => [t.id, t]))
    const hasSolo = this.lastTracks.some((t) => t.solo && !t.muted)
    for (const clip of this.lastClips) {
      if (this.activeElements.has(clip.id)) continue
      const clipEnd = clip.startTime + clip.duration - clip.trimStart - clip.trimEnd
      if (seekPos >= clipEnd) continue           // already past
      if (clip.startTime > windowEnd) continue  // too far ahead
      const track = trackMap.get(clip.trackId)
      if (!track || track.muted) continue
      if (hasSolo && !track.solo) continue
      this.scheduleClip(clip, track, seekPos)
    }
  }

  private clearSchedulerInterval(): void {
    if (this.schedulerInterval !== null) {
      clearInterval(this.schedulerInterval)
      this.schedulerInterval = null
    }
  }

  private startSchedulerInterval(): void {
    this.clearSchedulerInterval()
    this.schedulerInterval = setInterval(() => {
      if (!useTransportStore.getState().playing) return
      this.scheduleWindowFrom(this.getCurrentPosition())
    }, 10_000)
  }

  async play(clips: Clip[], tracks: Track[]): Promise<void> {
    await this.ctx.resume()
    if (this.audioServerPort === 0) {
      this.audioServerPort = await window.electronAPI.getAudioServerPort()
    }
    this.lastClips = clips
    this.lastTracks = tracks
    this.clearActive()

    const seekPos = useTransportStore.getState().playhead
    this.playStartPosition = seekPos
    this.playStartAudioTime = this.ctx.currentTime

    this.scheduleWindowFrom(seekPos)
    this.startSchedulerInterval()

    useTransportStore.getState().setPlaying(true)
    this.startRaf()
  }

  // Debounced reschedule during playback (clip edits, mute changes, etc.)
  softReload(clips: Clip[], tracks: Track[]): void {
    this.lastClips = clips
    this.lastTracks = tracks
    if (!useTransportStore.getState().playing) return
    if (this.reloadTimer !== null) clearTimeout(this.reloadTimer)
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null
      if (!useTransportStore.getState().playing) return
      const currentPos = this.getCurrentPosition()
      this.clearSchedulerInterval()
      this.clearActive()
      this.playStartPosition = currentPos
      this.playStartAudioTime = this.ctx.currentTime
      this.scheduleWindowFrom(currentPos)
      this.startSchedulerInterval()
      useTransportStore.getState().setPlaying(true)
      this.startRaf()
    }, 250)
  }

  // Gapless volume/mute update — ramps gain nodes directly without rescheduling
  updateVolume(clips: Clip[], tracks: Track[]): void {
    if (this.activeGains.size === 0) return
    const trackMap = new Map(tracks.map((t) => [t.id, t]))
    for (const clip of clips) {
      if (clip.automation && clip.automation.length > 0) continue
      const gain = this.activeGains.get(clip.id)
      if (!gain) continue
      const track = trackMap.get(clip.trackId)
      if (!track) continue
      const target = track.muted ? 0 : track.volume * clip.volume
      if (this.ctx.state === 'running') {
        gain.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 0.04)
      } else {
        gain.gain.value = target
      }
    }
  }

  stop(): void {
    this.clearSchedulerInterval()
    this.clearActive()
    this.stopRaf()
    useTransportStore.getState().setPlaying(false)
    useTransportStore.getState().setPlayhead(0)
    this.playStartPosition = 0
    this.playStartAudioTime = 0
  }

  pause(): void {
    const pos = this.getCurrentPosition()
    this.clearSchedulerInterval()
    this.clearActive()
    this.stopRaf()
    useTransportStore.getState().setPlaying(false)
    useTransportStore.getState().setPlayhead(pos)
  }

  seek(seconds: number): void {
    const wasPlaying = useTransportStore.getState().playing
    const pos = Math.max(0, seconds)
    this.clearSchedulerInterval()
    this.clearActive()
    this.stopRaf()
    this.playStartPosition = pos
    this.playStartAudioTime = this.ctx.currentTime
    useTransportStore.getState().setPlayhead(pos)

    if (wasPlaying) {
      this.scheduleWindowFrom(pos)
      this.startSchedulerInterval()
      useTransportStore.getState().setPlaying(true)
      this.startRaf()
    }
  }

  getCurrentPosition(): number {
    if (!useTransportStore.getState().playing) {
      return useTransportStore.getState().playhead
    }
    return this.playStartPosition + (this.ctx.currentTime - this.playStartAudioTime)
  }

  private clearActive(): void {
    for (const tid of this.pendingTimeouts) clearTimeout(tid)
    this.pendingTimeouts = []
    for (const audio of this.activeElements.values()) {
      audio.pause()
      audio.src = ''
    }
    for (const source of this.activeSources.values()) {
      try { source.disconnect() } catch { /* already disconnected */ }
    }
    for (const gain of this.activeGains.values()) {
      try { gain.disconnect() } catch { /* already disconnected */ }
    }
    for (const gain of this.activeFadeGains.values()) {
      try { gain.disconnect() } catch { /* already disconnected */ }
    }
    this.activeElements.clear()
    this.activeSources.clear()
    this.activeGains.clear()
    this.activeFadeGains.clear()
  }

  private startRaf(): void {
    this.stopRaf()
    const tick = (): void => {
      useTransportStore.getState().setPlayhead(this.getCurrentPosition())
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private stopRaf(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  // ── Background warmup ────────────────────────────────────────────────────
  // Buffers each audio file one at a time so the OS page cache is primed
  // before the user presses play.  Sequential (not concurrent) to avoid
  // hammering the disk with simultaneous HTTP reads.

  async warmup(
    filePaths: string[],
    onProgress: (done: number, total: number) => void
  ): Promise<void> {
    this.cancelWarmup()
    this.warmupCancelled = false
    if (filePaths.length === 0) { onProgress(0, 0); return }

    if (this.audioServerPort === 0) {
      this.audioServerPort = await window.electronAPI.getAudioServerPort()
    }

    let done = 0
    const total = filePaths.length
    onProgress(0, total)

    for (const filePath of filePaths) {
      if (this.warmupCancelled) break

      const audio = document.createElement('audio')
      audio.preload = 'auto'
      audio.src = this.localUrl(filePath)
      this.warmupPool.push(audio)

      await new Promise<void>((resolve) => {
        const onDone = (): void => { onProgress(++done, total); resolve() }
        audio.addEventListener('canplay', onDone, { once: true })
        audio.addEventListener('error', onDone, { once: true })
      })
    }
  }

  cancelWarmup(): void {
    this.warmupCancelled = true
    for (const audio of this.warmupPool) { audio.src = '' }
    this.warmupPool = []
  }
}

export const audioEngine = new AudioEngine()
