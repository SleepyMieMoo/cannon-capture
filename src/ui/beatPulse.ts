import { followBeat, NO_BEAT, BAR, beatTime, type BeatFollower, type BeatPhase } from '../audio/beatGrid'
import { music } from '../audio/music'
import { DEBUG } from '../debug'
import { motionOK, onMotionChange } from './motion'

/** Look this far ahead (s): a pulse set off now shows on the next frame. */
const LEAD = 0.012
/** How long the canvas's bar pulse fades over (ms). */
const BAR_FADE_MS = 520

/**
 * The game's one beat clock. While the music is really audible (on, not at
 * volume 0, not loading or locked, the tab showing), Pulse to the music is on
 * and motion isn't reduced, it reads the song position from the audio clock
 * every frame and, on each beat, flips a class on <html>:
 *   cc-beat-a / cc-beat-b  alternate on every beat (so CSS animations restart),
 *   cc-down                the beat starts a bar,
 *   cc-pulsing             the clock is live (CSS styles nothing without it).
 * CSS does the pulsing (transform and opacity only); canvas effects read
 * barLevel(). Nothing is allocated per frame, and nothing runs when it's off.
 */
class BeatPulse {
  private raf = 0
  private live = false
  private started = false
  private flip = false
  private readonly phase: BeatPhase = { beat: 0, frac: 0, since: 0, downbeat: false }
  private readonly follower: BeatFollower = { song: '', beat: 0 }
  /** Page time of the last bar's first beat (-Infinity: none lately). */
  private lastBar = -Infinity
  /** The previous frame's time (for the debug log: how late a frame could have been). */
  private prevTick = 0
  private readonly root = typeof document !== 'undefined' ? document.documentElement : null
  /** Debug: the last pulses (song position against the beat they were for). */
  private readonly log: { song: string; pos: number; beat: number; err: number; bar: boolean; at: number; frame: number }[] = []

  start(): void {
    if (this.started || !this.root) return
    this.started = true
    music.onChange(this.check)
    onMotionChange(this.check)
    document.addEventListener('visibilitychange', this.check)
    this.check()
    if (DEBUG.enabled) (window as unknown as { __beat: unknown }).__beat = { log: this.log, live: () => this.live, level: () => this.barLevel(performance.now()) }
  }

  /** 0..1: how strongly the last bar's first beat still shows (eases out). Cheap: call every frame. */
  barLevel(nowMs: number): number {
    const t = (nowMs - this.lastBar) / BAR_FADE_MS
    if (!(t >= 0 && t < 1)) return 0
    const u = 1 - t
    return u * u
  }

  get pulsing(): boolean {
    return this.live
  }

  private readonly check = (): void => {
    const want =
      music.settings.pulse && music.settings.on && music.settings.volume > 0 && music.status === 'playing' && motionOK() && !document.hidden
    if (want === this.live) return
    this.live = want
    const root = this.root!
    if (want) {
      root.classList.add('cc-pulsing')
      this.follower.song = ''
      if (!this.raf) this.raf = requestAnimationFrame(this.tick)
    } else {
      cancelAnimationFrame(this.raf)
      this.raf = 0
      this.lastBar = -Infinity
      root.classList.remove('cc-pulsing', 'cc-beat-a', 'cc-beat-b', 'cc-down')
    }
  }

  private readonly tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick)
    const prev = this.prevTick
    this.prevTick = now
    const pos = music.audiblePosition(now)
    if (pos !== pos) return
    const grid = music.track.beat
    const hit = followBeat(this.follower, music.current, pos + LEAD, grid, this.phase)
    if (hit === NO_BEAT) return
    const root = this.root!
    const bar = hit === BAR
    this.flip = !this.flip
    root.classList.toggle('cc-down', bar)
    root.classList.replace(this.flip ? 'cc-beat-b' : 'cc-beat-a', this.flip ? 'cc-beat-a' : 'cc-beat-b') || root.classList.add(this.flip ? 'cc-beat-a' : 'cc-beat-b')
    if (bar) this.lastBar = now
    if (DEBUG.enabled) {
      this.log.push({ song: music.current, pos, beat: this.phase.beat, err: pos - beatTime(this.phase.beat, grid), bar, at: now, frame: now - prev })
      if (this.log.length > 400) this.log.shift()
    }
  }
}

export const beatPulse = new BeatPulse()
