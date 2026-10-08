import { loadMusicSettings, saveMusicSettings, type MusicSettings } from './musicSettings'
import { stepTrack, trackById, type MusicTrack, type TrackId } from './musicTracks'

/**
 * The jukebox: one music player for the whole game, so a song keeps going
 * from the menu into a battle and back without restarting.
 *
 * - Its own Web Audio context and volume, separate from the sound effects
 *   (Phaser's), so the SFX mute (N) and volume never touch the music, and
 *   clicking outside a Discord frame (a window blur) doesn't stop it.
 * - Songs loop on an AudioBufferSourceNode, between loop points that skip
 *   the encoder's silent padding, so there is no gap at the seam.
 * - Only the playing song is downloaded and decoded; the others are fetched
 *   when picked. Nothing loads until boot() (after the first menu paint).
 * - Browsers (and Discord) keep audio locked until the first click, tap or
 *   key: the player waits for that gesture and then starts.
 * - By default the music keeps playing while the tab is hidden; with
 *   "Keep music playing when tabbed out" off it pauses and carries on when
 *   the tab is back.
 * - A file that can't be downloaded or decoded marks that song as missing;
 *   the game never breaks over it.
 */

export type MusicStatus = 'off' | 'loading' | 'playing' | 'locked' | 'missing' | 'no-audio'

type Store = Pick<Storage, 'getItem' | 'setItem'>
type Listenable = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

/** What the player needs from the browser (tests pass fakes). */
export interface MusicEnv {
  createContext(): AudioContext | null
  fetchBytes(url: string): Promise<ArrayBuffer>
  store?: Store | null
  /** Where the first click / tap / key is heard (window). */
  events?: Listenable
  /** document: hidden and visibilitychange. */
  doc?: Listenable & { readonly hidden: boolean }
  /** Run fn later, when the page is idle. */
  later?(fn: () => void): void
}

/** Crossfade when switching songs, and the short fades for play / pause (s). */
const XFADE = 0.45
const FADE_IN = 0.12
const FADE_OUT = 0.25
/** How often the audio clock is tied to the page clock again (ms). */
const CLOCK_REFRESH_MS = 250
/** Events that count as a user gesture for audio, in every browser we care about. */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const

/**
 * Where a decoded song should loop: from its first to its last sound, so an
 * MP3's silent encoder padding at either end never makes a gap. Only near-
 * silence (below `threshold`) is skipped, at most half a second at the start
 * and two at the end; a fade in or out stays part of the song.
 */
export function loopPoints(channels: readonly ArrayLike<number>[], sampleRate: number, threshold = 1e-4): { start: number; end: number } {
  const len = channels[0]?.length ?? 0
  const full = { start: 0, end: len / sampleRate }
  if (!len || sampleRate <= 0) return full
  const loud = (i: number): boolean => channels.some((c) => Math.abs(c[i]) > threshold)
  let first = 0
  const headMax = Math.min(len, Math.round(sampleRate * 0.5))
  while (first < headMax && !loud(first)) first++
  if (first >= headMax) first = 0
  let last = len - 1
  const tailMin = Math.max(0, len - Math.round(sampleRate * 2))
  while (last > tailMin && !loud(last)) last--
  if (last <= tailMin) last = len - 1
  if (last - first < sampleRate) return full
  return { start: first / sampleRate, end: (last + 1) / sampleRate }
}

interface Voice {
  src: AudioBufferSourceNode
  fade: GainNode
  track: TrackId
  /** Context time when it started, and where in the song (s). */
  startedAt: number
  offset: number
  loop: { start: number; end: number }
}

export class MusicPlayer {
  settings: MusicSettings
  /** The song playing (or paused) right now; settings.track is only the default. */
  current: TrackId
  /** undefined: not made yet; null: this browser has no Web Audio. */
  private ctx: AudioContext | null | undefined
  private out: GainNode | null = null
  private voice: Voice | null = null
  private readonly buffers = new Map<TrackId, Promise<AudioBuffer | null>>()
  private readonly loops = new WeakMap<AudioBuffer, { start: number; end: number }>()
  private readonly missing = new Set<TrackId>()
  private loading: TrackId | null = null
  /** Where the current song carries on from after a pause (s). */
  private offset = 0
  /** Bumped by every start / pause, so a slow download can't start an old song. */
  private token = 0
  private booted = false
  private unlocking = false
  private suspendTimer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<() => void>()
  /** The audio clock against the page clock: the context time being heard at a page time (refreshed now and then). */
  private heardCtx = 0
  private heardAt = -Infinity

  constructor(private readonly env: MusicEnv) {
    this.settings = loadMusicSettings(env.store)
    this.current = this.settings.track
  }

  /** Start up (once): listen for tab switches and, if music is on, load and play the default song. */
  boot(): void {
    if (this.booted) return
    this.booted = true
    this.env.doc?.addEventListener('visibilitychange', this.onVisibility)
    if (this.settings.on) this.start()
    else this.emit()
  }

  /** boot(), when the page is idle (after the first menu paint). */
  bootLater(): void {
    const later = this.env.later ?? ((fn: () => void) => setTimeout(fn, 600))
    later(() => this.boot())
  }

  get track(): MusicTrack {
    return trackById(this.current)
  }

  get playing(): boolean {
    return this.settings.on
  }

  get status(): MusicStatus {
    if (this.ctx === null) return 'no-audio'
    if (this.missing.has(this.current)) return 'missing'
    if (!this.settings.on) return 'off'
    if (this.ctx && this.ctx.state !== 'running' && !this.hidden() && this.booted) return 'locked'
    if (!this.voice || this.voice.track !== this.current || this.loading === this.current) return 'loading'
    return 'playing'
  }

  isMissing(id: TrackId): boolean {
    return this.missing.has(id)
  }

  /** Where the current song is (s), for the tests and the debug view. */
  position(): number {
    const v = this.voice
    if (!v || !this.ctx) return this.offset
    const p = v.offset + Math.max(0, this.ctx.currentTime - v.startedAt)
    if (p < v.loop.end) return p
    const span = v.loop.end - v.loop.start
    return span > 0 ? v.loop.start + ((p - v.loop.start) % span) : 0
  }

  /**
   * The song position being heard right now (s), from the audio clock, with
   * the output's latency taken off; NaN when nothing is audible (off, volume
   * 0, loading, locked, or the tab's music paused). No allocation per call.
   */
  audiblePosition(nowMs: number): number {
    const v = this.voice
    const ctx = this.ctx
    if (!v || !ctx || !this.settings.on || this.settings.volume <= 0 || ctx.state !== 'running') return NaN
    if (v.track !== this.current || this.loading === this.current) return NaN
    if (nowMs - this.heardAt > CLOCK_REFRESH_MS || nowMs < this.heardAt) this.syncClock(ctx, nowMs)
    const heard = this.heardCtx + (nowMs - this.heardAt) / 1000
    const p = v.offset + (heard - v.startedAt)
    if (p < v.offset) return NaN
    if (p < v.loop.end) return p
    const span = v.loop.end - v.loop.start
    return span > 0 ? v.loop.start + ((p - v.loop.start) % span) : NaN
  }

  /**
   * Tie the audio clock to the page clock. getOutputTimestamp says which
   * context time the speakers are playing at a page time (latency included);
   * without it, currentTime less the reported output and base latency.
   */
  private syncClock(ctx: AudioContext, nowMs: number): void {
    const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null
    const now = ctx.currentTime
    if (ts && ts.performanceTime && ts.contextTime !== undefined && ts.performanceTime > 0) {
      const heard = ts.contextTime + (nowMs - ts.performanceTime) / 1000
      if (heard <= now + 0.05 && heard >= now - 0.6) {
        this.heardCtx = heard
        this.heardAt = nowMs
        return
      }
    }
    this.heardCtx = now - (ctx.outputLatency || 0) - (ctx.baseLatency || 0)
    this.heardAt = nowMs
  }

  /** Settings → Music → Pulse to the music (saved). */
  setPulse(on: boolean): void {
    this.settings.pulse = on
    this.save()
    this.emit()
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  play(): void {
    this.settings.on = true
    this.save()
    this.start()
  }

  pause(): void {
    this.settings.on = false
    this.save()
    this.offset = this.voice ? this.position() : this.offset
    this.token++
    this.loading = null
    this.stopVoice(FADE_OUT)
    // Nothing to play: let the audio hardware rest after the fade.
    this.clearSuspend()
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null
      if (!this.settings.on && this.ctx?.state === 'running') void this.ctx.suspend().catch(() => {})
    }, (FADE_OUT + 0.15) * 1000)
    this.emit()
  }

  toggle(): void {
    if (this.settings.on) this.pause()
    else this.play()
  }

  /** Switch songs live (crossfade when music is on). Doesn't change the default. */
  select(id: TrackId): void {
    const busy = this.voice?.track === id || this.loading === id
    if (id === this.current && busy && !this.missing.has(id)) return
    this.current = id
    this.offset = 0
    this.missing.delete(id)
    if (this.settings.on) this.start(true)
    else this.emit()
  }

  next(): void {
    this.select(stepTrack(this.current, 1))
  }

  prev(): void {
    this.select(stepTrack(this.current, -1))
  }

  /** The song that plays when the game starts (saved). */
  setDefault(id: TrackId): void {
    this.settings.track = id
    this.save()
    this.emit()
  }

  setVolume(v: number): void {
    this.settings.volume = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
    this.applyVolume()
    this.save()
    this.emit()
  }

  /** Settings → When tabbed out: keep playing while the tab is hidden (saved). */
  setKeepHidden(on: boolean): void {
    this.settings.keepHidden = on
    this.save()
    this.onVisibility()
  }

  /** Read the saved settings again (after Profile → Reset all preferences). */
  reload(): void {
    const wasOn = this.settings.on
    this.settings = loadMusicSettings(this.env.store)
    this.applyVolume()
    if (this.settings.on && !wasOn) this.start()
    else if (!this.settings.on && wasOn) {
      this.settings.on = true
      this.pause()
      return
    }
    this.emit()
  }

  // ------------------------------------------------------------ internals

  private save(): void {
    saveMusicSettings(this.settings, this.env.store)
  }

  private emit(): void {
    for (const fn of [...this.listeners]) {
      try {
        fn()
      } catch {
        // A broken listener never stops the music.
      }
    }
  }

  private hidden(): boolean {
    return this.env.doc?.hidden === true
  }

  private clearSuspend(): void {
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer)
    this.suspendTimer = null
  }

  private context(): AudioContext | null {
    if (this.ctx === undefined) {
      let ctx: AudioContext | null = null
      try {
        ctx = this.env.createContext()
      } catch {
        ctx = null
      }
      this.ctx = ctx
      if (ctx) {
        this.out = ctx.createGain()
        this.out.gain.value = this.settings.volume
        this.out.connect(ctx.destination)
        ctx.addEventListener?.('statechange', () => {
          if (ctx.state === 'running') this.stopUnlock()
          this.emit()
        })
      }
    }
    return this.ctx
  }

  private applyVolume(): void {
    if (!this.ctx || !this.out) return
    const g = this.out.gain
    const t = this.ctx.currentTime
    g.cancelScheduledValues(t)
    g.setTargetAtTime(this.settings.volume, t, 0.03)
  }

  private start(crossfade = false): void {
    this.clearSuspend()
    const ctx = this.context()
    if (!ctx) return this.emit()
    this.unlock()
    void this.startTrack(this.current, this.offset, crossfade)
  }

  /** Resume the context now if the browser allows it, else on the first gesture. */
  private unlock(): void {
    const ctx = this.ctx
    if (!ctx || (this.hidden() && !this.settings.keepHidden) || ctx.state === 'running') return
    void ctx.resume().then(
      () => this.emit(),
      () => {},
    )
    if (!this.unlocking && this.env.events) {
      this.unlocking = true
      for (const e of GESTURES) this.env.events.addEventListener(e, this.onGesture, { capture: true, passive: true })
    }
  }

  private stopUnlock(): void {
    if (!this.unlocking || !this.env.events) return
    this.unlocking = false
    for (const e of GESTURES) this.env.events.removeEventListener(e, this.onGesture, { capture: true })
  }

  private readonly onGesture = (): void => {
    const ctx = this.ctx
    if (!ctx || ctx.state === 'running') return this.stopUnlock()
    if (!this.settings.on || (this.hidden() && !this.settings.keepHidden)) return
    void ctx.resume().then(
      () => {
        if (ctx.state === 'running') this.stopUnlock()
        this.emit()
      },
      () => {},
    )
  }

  private readonly onVisibility = (): void => {
    const ctx = this.ctx
    if (!ctx) return
    if (this.hidden() && !this.settings.keepHidden) {
      if (ctx.state === 'running') void ctx.suspend().catch(() => {})
    } else if (this.settings.on) this.unlock()
    this.emit()
  }

  private buffer(id: TrackId): Promise<AudioBuffer | null> {
    let p = this.buffers.get(id)
    if (!p) {
      const ctx = this.ctx!
      p = this.env
        .fetchBytes(trackById(id).file)
        .then((bytes) => ctx.decodeAudioData(bytes))
        .catch(() => null)
      this.buffers.set(id, p)
      // A failed download can be tried again later (picking the song again).
      void p.then((b) => {
        if (!b && this.buffers.get(id) === p) this.buffers.delete(id)
      })
    }
    return p
  }

  private loopOf(buf: AudioBuffer): { start: number; end: number } {
    let l = this.loops.get(buf)
    if (!l) {
      const ch: Float32Array[] = []
      for (let i = 0; i < buf.numberOfChannels; i++) ch.push(buf.getChannelData(i))
      l = loopPoints(ch, buf.sampleRate)
      this.loops.set(buf, l)
    }
    return l
  }

  private async startTrack(id: TrackId, offset: number, crossfade: boolean): Promise<void> {
    const token = ++this.token
    if (this.voice?.track === id && !crossfade) {
      // Already playing this one (play pressed twice, or a reload): nothing to do.
      this.emit()
      return
    }
    this.loading = id
    this.emit()
    const buf = await this.buffer(id)
    if (token !== this.token) return
    this.loading = null
    if (!buf) {
      this.missing.add(id)
      this.stopVoice(FADE_OUT)
      this.emit()
      return
    }
    const ctx = this.ctx
    if (!ctx || !this.out || !this.settings.on || id !== this.current) return this.emit()
    this.stopVoice(crossfade ? XFADE : FADE_IN)
    const loop = this.loopOf(buf)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.loopStart = loop.start
    src.loopEnd = loop.end
    const fade = ctx.createGain()
    const now = ctx.currentTime
    fade.gain.setValueAtTime(0, now)
    fade.gain.linearRampToValueAtTime(1, now + (crossfade ? XFADE : FADE_IN))
    src.connect(fade)
    fade.connect(this.out)
    const at = offset >= loop.start && offset < loop.end ? offset : loop.start
    src.start(now, at)
    this.voice = { src, fade, track: id, startedAt: now, offset: at, loop }
    // Keep only this song decoded (a decoded song is tens of MB).
    for (const k of [...this.buffers.keys()]) if (k !== id) this.buffers.delete(k)
    this.emit()
  }

  private stopVoice(fadeS: number): void {
    const v = this.voice
    if (!v || !this.ctx) return
    this.voice = null
    const t = this.ctx.currentTime
    const g = v.fade.gain
    try {
      g.cancelScheduledValues(t)
      g.setValueAtTime(g.value, t)
      g.linearRampToValueAtTime(0, t + fadeS)
      v.src.stop(t + fadeS + 0.02)
    } catch {
      // Already stopped.
    }
    v.src.onended = () => {
      v.src.disconnect()
      v.fade.disconnect()
    }
  }
}

/** The browser's pieces (none in the tests, where nothing plays). */
export function browserEnv(): MusicEnv {
  const w = typeof window !== 'undefined' ? window : undefined
  type Ctor = new (opts?: AudioContextOptions) => AudioContext
  return {
    createContext: () => {
      const C = w && ((w.AudioContext ?? (w as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext) as Ctor | undefined)
      return C ? new C({ latencyHint: 'playback' }) : null
    },
    fetchBytes: async (url) => {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.arrayBuffer()
    },
    events: w,
    doc: typeof document !== 'undefined' ? document : undefined,
    later: (fn) => {
      const ric = w && (w as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
      if (ric) ric(fn, { timeout: 1500 })
      else setTimeout(fn, 600)
    },
  }
}

/** The game's one music player. */
export const music = new MusicPlayer(browserEnv())
