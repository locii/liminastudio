import type { LibraryFile } from '../types'
import { audioStreamUrl } from './audioStreamUrl'

/**
 * Dual-deck volume-crossfade engine for Auto-Mix.
 *
 * Ported from the Music for Breathwork "interactive analysis" shortcode. Uses
 * two plain <audio> elements and ramps their `.volume`, deliberately NOT the
 * Web Audio API: routing media through an AudioContext graph gets silenced by
 * the autoplay policy until the context is resumed inside a gesture, which is
 * fragile. Plain <audio>.volume just works.
 *
 * Differences from the web version:
 *  - Playhead-driven: a crossfade auto-starts when the playing track reaches its
 *    outro point (outroStartMs, or duration - xfade as a fallback), instead of
 *    being driven by an external scrub position.
 *  - Pull-based queue: the engine asks its host for the next track via
 *    `setQueueProvider`, so the queue can update live as tags change without
 *    disturbing the currently-playing/crossfading pair.
 *  - Streams through the local audio HTTP server (audioStreamUrl), so the
 *    Chromium decoder workarounds still apply.
 */

export interface MixEngineState {
  playing: boolean
  current: LibraryFile | null
  currentTime: number   // seconds, of the active deck
  duration: number      // seconds, of the active deck
  fading: boolean
  outgoing: LibraryFile | null  // track being faded out during a crossfade
  fadeElapsedMs: number         // ms since the crossfade ramp began
  fadeDurationMs: number        // total crossfade length (ms)
}

export type AdvanceMode = 'auto' | 'fade' | 'quick'

/** What the queue provider hands back: the next file, plus optional per-transition
 *  overrides used to reproduce a recorded session (fadeMs = crossfade length into
 *  it, startMs = file offset to start at). Omitted → engine defaults apply. */
export interface NextTrack {
  file: LibraryFile
  fadeMs?: number
  startMs?: number
  holdMs?: number   // replay: play this long before crossfading to the next (else natural outro)
}

const DEFAULT_XFADE_MS = 20000
const QUICK_XFADE_MS = 4000
const FIRST_FADE_MS = 2000
const AUDIO_SOURCE_ID = 'mix'

export class MixEngine {
  private port: number | null = null
  private decks: [HTMLAudioElement, HTMLAudioElement]
  private active: 0 | 1 = 0
  private xfadeVer = 0
  // Web Audio crossfade: each deck routes through a GainNode. Ramping gain via
  // the audio clock is sample-accurate and click-free (element.volume is not).
  private audioCtx: AudioContext | null = null
  private gains: [GainNode | null, GainNode | null] = [null, null]
  private progressRaf: number | null = null
  private listeners = new Set<(s: MixEngineState) => void>()

  private _playing = false
  private _fading = false
  private current: LibraryFile | null = null
  private _outgoing: LibraryFile | null = null
  private _fadeStart = 0
  private _fadeDurMs = 0
  /** True once the crossfade's gain ramps have actually begun (incoming buffered
   *  and playing), so a mid-fade re-time doesn't clobber the pending start. */
  private _rampsStarted = false
  /** Guards against re-triggering the outro crossfade every frame. */
  private outroArmed = false
  /** Replay: how long the current track should play before crossfading (ms), and
   *  the wall-clock time it became current. Null = advance on the natural outro. */
  private currentHoldMs: number | null = null
  private currentBecameCurrentAt = 0
  private provider: (currentId: string | null) => NextTrack | null = () => null
  /** Host predicate: true when the active timed tag-group has run its duration
   *  and the mix should crossfade to the next queue item now. */
  private groupTimerElapsed: () => boolean = () => false
  /** Resolves a per-track fade-in start point (ms into the file). */
  private startMsFor: (f: LibraryFile) => number = () => 0
  /** Start offset (seconds) of the currently-active deck, for outro timing. */
  private currentStartS = 0

  /** Default crossfade length in ms; overridable per session. */
  xfadeMs = DEFAULT_XFADE_MS

  constructor() {
    const mk = (): HTMLAudioElement => {
      const el = new Audio()
      el.preload = 'auto'
      el.volume = 0
      el.crossOrigin = 'anonymous'
      return el
    }
    this.decks = [mk(), mk()]
    this.decks.forEach((el) => el.addEventListener('ended', this.onDeckEnded))
    window.addEventListener('app:audio-start', this.onExternalAudio)
  }

  // --- public API -----------------------------------------------------------

  setPort(port: number): void { this.port = port }

  /** Host supplies the next track given the id currently playing (or null). */
  setQueueProvider(fn: (currentId: string | null) => NextTrack | null): void {
    this.provider = fn
  }

  /** Host supplies the fade-in start point (ms) for a given track. */
  setStartResolver(fn: (f: LibraryFile) => number): void {
    this.startMsFor = fn
  }

  /** Host supplies a predicate that, once the active tag-group's play-duration
   *  elapses, tells the engine to crossfade to the next queue item — separate
   *  from the current track's own outro/end. */
  setGroupTimerCheck(fn: () => boolean): void {
    this.groupTimerElapsed = fn
  }

  /**
   * Re-time an in-progress crossfade to a new total length — for when the Xfade
   * slider moves mid-fade. Both decks ramp from wherever their gains currently
   * sit to their targets over `newMs` from now (a clean linear finish, since a
   * mid-fade no longer has the 0/1 start the curve path needs). No-op unless a
   * crossfade's ramps have actually started.
   */
  retimeActiveFade(newMs: number): void {
    if (!this._fading || !this._rampsStarted || !this.audioCtx) return
    const nextIdx = this.active            // incoming (active after crossfadeTo)
    const prevIdx: 0 | 1 = nextIdx === 0 ? 1 : 0  // outgoing
    const ver = ++this.xfadeVer            // invalidate the old fade's done-callbacks
    this._fadeStart = performance.now()
    this._fadeDurMs = newMs
    this.rampGain(nextIdx, 1, newMs)
    this.rampGain(prevIdx, 0, newMs, undefined, () => {
      if (ver !== this.xfadeVer) return
      this._fading = false
      this._outgoing = null
      const g = this.gains[prevIdx]
      if (!g || g.gain.value < 0.05) this.decks[prevIdx].pause()
    })
    this.emit()
  }

  subscribe(fn: (s: MixEngineState) => void): () => void {
    this.listeners.add(fn)
    fn(this.snapshot())
    return () => { this.listeners.delete(fn) }
  }

  get playing(): boolean { return this._playing }
  get currentFile(): LibraryFile | null { return this.current }
  /** File-absolute playhead position (seconds) of the active deck. */
  get position(): number { return (this.decks[this.active].currentTime || 0) + this.currentStartS }

  play(): void {
    if (this.port === null) return
    this.ensureGraph()
    if (this.current) {
      // Resume the loaded deck.
      const el = this.decks[this.active]
      el.play().catch(() => {})
      this.rampGain(this.active, 1, 200)
      this.setPlaying(true)
    } else {
      const first = this.provider(null)
      if (!first) return
      this.load(first.file, first.fadeMs || undefined, first.startMs, first.holdMs)
      this.setPlaying(true)
    }
  }

  pause(): void {
    if (!this._playing) return
    this.decks.forEach((el) => el.pause())
    this.setPlaying(false)
  }

  toggle(): void { this._playing ? this.pause() : this.play() }

  /** Advance now with a quick crossfade. */
  next(): void { this.advance('quick') }

  /** Begin the full-length crossfade into the next track immediately. */
  fadeInNextNow(): void { this.advance('fade') }

  stop(): void {
    this.xfadeVer++
    this.decks.forEach((el, i) => { this.setGain(i as 0 | 1, 0); el.pause(); try { el.removeAttribute('src') } catch { /* noop */ } })
    this.current = null
    this._outgoing = null
    this._fading = false
    this.outroArmed = false
    this.setPlaying(false)
    this.emit()
  }

  dispose(): void {
    this.stop()
    this.decks.forEach((el) => el.removeEventListener('ended', this.onDeckEnded))
    window.removeEventListener('app:audio-start', this.onExternalAudio)
    if (this.progressRaf !== null) cancelAnimationFrame(this.progressRaf)
    this.listeners.clear()
  }

  // --- internals ------------------------------------------------------------

  private onExternalAudio = (e: Event): void => {
    if ((e as CustomEvent).detail !== AUDIO_SOURCE_ID && this._playing) this.pause()
  }

  private onDeckEnded = (e: Event): void => {
    // Only react to the active deck ending (a faded-out deck also fires ended).
    if (e.target !== this.decks[this.active] || this._fading) return
    this.advance('quick')
  }

  private setPlaying(v: boolean): void {
    if (this._playing === v) { this.emit(); return }
    this._playing = v
    if (v) {
      window.dispatchEvent(new CustomEvent('app:audio-start', { detail: AUDIO_SOURCE_ID }))
      this.startProgress()
    } else {
      this.stopProgress()
    }
    this.emit()
  }

  /**
   * Cue `file` onto deck `idx`, applying the per-track fade-in offset via the
   * audio server (`ss=`) so playback starts at the offset with NO client seek.
   * The deck is muted through the initial buffer/decode (masking any ffmpeg -ss
   * startup transient), then unmuted and faded up from 0 once playback begins.
   */
  private startDeck(idx: 0 | 1, file: LibraryFile, fadeMs: number, startMsOverride?: number): void {
    if (this.port === null) return
    this.ensureGraph()
    const el = this.decks[idx]
    const startMs = Math.max(0, startMsOverride != null ? startMsOverride : this.startMsFor(file))
    this.currentStartS = startMs / 1000
    this.setGain(idx, 0)
    el.src = audioStreamUrl(this.port, file.filePath, file.sampleRate, startMs)
    el.load()
    const ver = ++this.xfadeVer
    this.whenReady(el, ver, () => {
      if (ver !== this.xfadeVer) return
      el.play().catch(() => {})
      this._fadeStart = performance.now()
      this.rampGain(idx, 1, fadeMs, file.fadeInCurve ?? 0)
    })
  }

  /** Load `file` onto the active deck and fade it in over `fadeMs`. */
  private load(file: LibraryFile, fadeMs = FIRST_FADE_MS, startMsOverride?: number, holdMs?: number): void {
    if (this.port === null) return
    this.startDeck(this.active, file, fadeMs, startMsOverride)
    this.current = file
    this.outroArmed = false
    this.currentHoldMs = holdMs ?? null
    this.currentBecameCurrentAt = performance.now()
    this.emit()
  }

  private advance(mode: AdvanceMode): void {
    if (this.port === null) return
    const next = this.provider(this.current?.id ?? null)
    if (!next) return // nothing queued — let the current track ride out

    // A recorded transition (fadeMs) reproduces its crossfade length except on a
    // manual quick-skip; startMs reproduces where the track began in the file.
    const ms = mode === 'quick' ? QUICK_XFADE_MS : (next.fadeMs != null ? next.fadeMs : this.xfadeMs)
    this.crossfadeTo(next.file, ms, next.startMs, next.holdMs)
  }

  /**
   * Crossfade to a specific track over `ms`. Uses independent per-deck fades so
   * an interrupted crossfade composes cleanly. If the deck we're about to reuse
   * is still audible from a previous (interrupted) fade, it's declicked to
   * silence BEFORE its source is swapped — swapping src on an audible element
   * cuts its waveform mid-sample and pops, which is what happened when Fade/drag
   * was triggered during a long 20s crossfade.
   */
  private crossfadeTo(next: LibraryFile, ms: number, offsetMs?: number, holdMs?: number): void {
    if (this.port === null) return
    this.ensureGraph()

    // Interrupting an in-progress crossfade: fade from whichever deck is currently
    // LOUDER (the established track) and discard the quieter one. Without this, a
    // skip/fade taken while the incoming track is still ramping up would fade from
    // that near-silent deck — briefly dropping the audio to nothing. (User-reported:
    // hitting Fade Next again mid-crossfade cuts the music out.) Picking the louder
    // deck means an early interruption fades from the outgoing track and drops the
    // half-faded incoming one; a late interruption keeps the (now dominant) incoming.
    if (this._fading && this._outgoing) {
      const activeGain = this.gains[this.active]?.gain.value ?? 0
      const outIdx: 0 | 1 = this.active === 0 ? 1 : 0
      const outGain = this.gains[outIdx]?.gain.value ?? 0
      if (outGain > activeGain) {
        this.active = outIdx
        this.current = this._outgoing
      }
    }

    const prevIdx = this.active
    const nextIdx: 0 | 1 = prevIdx === 0 ? 1 : 0
    const incoming = this.decks[nextIdx]
    const ver = ++this.xfadeVer
    this._fading = true
    this._rampsStarted = false
    this._outgoing = this.current
    this._fadeDurMs = ms
    const startMs = Math.max(0, offsetMs != null ? offsetMs : this.startMsFor(next))
    this.currentStartS = startMs / 1000

    const swapAndStart = (): void => {
      if (this.port === null || ver !== this.xfadeVer) return
      incoming.src = audioStreamUrl(this.port, next.filePath, next.sampleRate, startMs)
      incoming.load()
      this.setGain(nextIdx, 0)
      this.whenReady(incoming, ver, () => {
        if (ver !== this.xfadeVer) return
        incoming.play().catch(() => {})
        this._fadeStart = performance.now()
        this._rampsStarted = true
        // Both decks ramp together once the incoming is buffered — a true overlap.
        this.rampGain(nextIdx, 1, ms, next.fadeInCurve ?? 0)
        this.rampGain(prevIdx, 0, ms, this._outgoing?.fadeOutCurve ?? 0, () => {
          if (ver !== this.xfadeVer) return
          this._fading = false
          this._outgoing = null
          const g = this.gains[prevIdx]
          if (!g || g.gain.value < 0.05) this.decks[prevIdx].pause()
        })
      })
    }

    // If the deck we're reusing is still audible (interrupted fade), fade its
    // gain to 0 first (click-free) before swapping its source.
    const g = this.gains[nextIdx]
    if (g && g.gain.value > 0.02) {
      this.rampGain(nextIdx, 0, 60, undefined, () => { incoming.pause(); swapAndStart() })
    } else {
      incoming.pause()
      swapAndStart()
    }

    this.active = nextIdx
    this.current = next
    this.outroArmed = false
    this.currentHoldMs = holdMs ?? null
    this.currentBecameCurrentAt = performance.now()
    this.emit()
  }

  /** Fade a specific track in now (e.g. dragged onto Now Playing, or preview). */
  fadeTo(file: LibraryFile): void {
    if (this.port === null) return
    // Respect the configured crossfade length, even when nothing's playing yet.
    if (!this.current) { this.setPlaying(true); this.load(file, this.xfadeMs); return }
    if (!this._playing) this.setPlaying(true)
    this.crossfadeTo(file, this.xfadeMs)
  }

  /** Cue the current track to a new position (seconds) and crossfade into it. */
  seekFadeTo(sec: number): void {
    if (this.port === null || !this.current) return
    if (!this._playing) this.setPlaying(true)
    this.crossfadeTo(this.current, this.xfadeMs, Math.max(0, sec * 1000))
  }

  /**
   * Fade one deck's volume to `target` over `ms` — independent per-deck RAF.
   * When `curve` is given (a full fade to 0 or 1), it applies the power-law
   * shape used by the Mix Cue editor: exp = 4^(-curve); fade-in gain = p^exp,
   * fade-out gain = (1-p)^exp (curve 0 = linear). Without `curve` it's a plain
   * linear ramp from the current volume (used for declick / resume).
   */
  /** Lazily build the Web Audio graph (deck → gain → destination). Called from a
   *  user gesture the first time so the context isn't left suspended. */
  private ensureGraph(): void {
    if (this.audioCtx) { if (this.audioCtx.state === 'suspended') void this.audioCtx.resume(); return }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctor()
    this.audioCtx = ctx
    this.decks.forEach((el, i) => {
      el.volume = 1
      const src = ctx.createMediaElementSource(el)
      const g = ctx.createGain()
      g.gain.value = 0
      src.connect(g)
      g.connect(ctx.destination)
      this.gains[i] = g
    })
  }

  /** Run `cb` exactly once the element can play — on canplay/loadeddata, or a
   *  fallback timeout (which always fires so a crossfade never gets stuck). */
  private whenReady(el: HTMLAudioElement, ver: number, cb: () => void): void {
    let called = false
    const run = (): void => {
      if (called) return
      called = true
      el.removeEventListener('canplay', run)
      el.removeEventListener('loadeddata', run)
      if (ver === this.xfadeVer) cb()
    }
    if (el.readyState >= 2) { run(); return }
    el.addEventListener('canplay', run)
    el.addEventListener('loadeddata', run)
    window.setTimeout(run, 1200)
  }

  /**
   * Schedule a click-free gain ramp on deck `i` to `target` over `ms`. A `curve`
   * (power-law) is applied via setValueCurveAtTime for clean full fades; if the
   * current gain doesn't match the curve's start (an interrupted fade) it falls
   * back to a linear ramp from the current value to avoid a discontinuity.
   */
  private rampGain(i: 0 | 1, target: number, ms: number, curve?: number, done?: () => void): void {
    const ctx = this.audioCtx, g = this.gains[i]
    if (!ctx || !g) return
    const now = ctx.currentTime
    const dur = Math.max(0.005, ms / 1000)
    const cur = g.gain.value
    g.gain.cancelScheduledValues(now)
    const isIn = target >= 0.5
    const expectedStart = isIn ? 0 : 1
    if (curve != null && Math.abs(cur - expectedStart) < 0.05) {
      const N = 48, exp = Math.pow(4, -curve), arr = new Float32Array(N + 1)
      const equalPower = Math.abs(curve) < 0.01 // default → constant-power crossfade (no mid dip / duck)
      for (let j = 0; j <= N; j++) {
        const t = j / N
        arr[j] = equalPower
          ? (isIn ? Math.sin((t * Math.PI) / 2) : Math.cos((t * Math.PI) / 2))
          : (isIn ? Math.pow(t, exp) : 1 - Math.pow(t, exp))
      }
      g.gain.setValueCurveAtTime(arr, now, dur)
    } else {
      g.gain.setValueAtTime(cur, now)
      g.gain.linearRampToValueAtTime(target, now + dur)
    }
    if (done) window.setTimeout(done, ms + 40)
  }

  private setGain(i: 0 | 1, v: number): void {
    const ctx = this.audioCtx, g = this.gains[i]
    if (!ctx || !g) return
    g.gain.cancelScheduledValues(ctx.currentTime)
    g.gain.setValueAtTime(v, ctx.currentTime)
  }

  // --- progress + outro detection -------------------------------------------

  private startProgress(): void {
    if (this.progressRaf !== null) return
    const tick = (): void => {
      this.checkHold()
      this.checkGroupTimer()
      this.checkOutro()
      this.emit()
      this.progressRaf = requestAnimationFrame(tick)
    }
    this.progressRaf = requestAnimationFrame(tick)
  }

  private stopProgress(): void {
    if (this.progressRaf !== null) { cancelAnimationFrame(this.progressRaf); this.progressRaf = null }
  }

  /** Replay: once the current track has played its recorded duration, crossfade
   *  to the next — this reproduces the session's timing (e.g. quick skips), not
   *  each track's natural outro. Cleared before advancing so it fires once. */
  private checkHold(): void {
    if (this.currentHoldMs == null || this._fading || !this.current) return
    if (performance.now() - this.currentBecameCurrentAt >= this.currentHoldMs) {
      this.currentHoldMs = null
      this.advance('auto')
    }
  }

  /** When the active tag-group's play-duration elapses, crossfade to the next
   *  queue item now — the provider then dequeues the spent group. Guarded by the
   *  fade flag so it fires once, and the group is gone before the fade ends. */
  private checkGroupTimer(): void {
    if (this._fading || !this.current) return
    if (this.groupTimerElapsed()) this.advance('fade')
  }

  private checkOutro(): void {
    if (this._fading || this.outroArmed || !this.current) return
    const el = this.decks[this.active]
    // File duration is more reliable than el.duration for offset/transcoded streams.
    const fullDur = this.current.duration || el.duration || 0
    if (!fullDur) return
    // Honour a clip-end cue as the effective end so the crossfade starts before it.
    const dur = this.current.clipEndMs != null ? Math.min(this.current.clipEndMs / 1000, fullDur) : fullDur
    // The crossfade must START at least xfadeMs before the end so the two tracks
    // actually overlap (otherwise the outgoing has already ended and it sounds
    // like a hard skip). Honour an earlier musical outro if the scan found one,
    // but never start later than that latest-safe point.
    const latestStartS = dur - this.xfadeMs / 1000
    const outroAbsS = this.current.outroStartMs != null
      ? Math.min(this.current.outroStartMs / 1000, latestStartS)
      : latestStartS
    // Absolute point → element-relative (the deck timeline starts at the offset).
    const outroElS = outroAbsS - this.currentStartS
    if (el.currentTime >= Math.max(0, outroElS)) {
      this.outroArmed = true
      this.advance('auto')
    }
  }

  private snapshot(): MixEngineState {
    const el = this.decks[this.active]
    return {
      playing: this._playing,
      current: this.current,
      // File-absolute position: the deck timeline starts at the fade-in offset.
      currentTime: (el.currentTime || 0) + this.currentStartS,
      duration: this.current?.duration || el.duration || 0,
      fading: this._fading,
      outgoing: this._fading ? this._outgoing : null,
      fadeElapsedMs: this._fading ? performance.now() - this._fadeStart : 0,
      fadeDurationMs: this._fadeDurMs,
    }
  }

  private emit(): void {
    const s = this.snapshot()
    this.listeners.forEach((fn) => fn(s))
  }
}
