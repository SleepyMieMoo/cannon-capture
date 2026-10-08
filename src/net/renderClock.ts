/**
 * When to draw an online round. Snapshots arrive with network delay that
 * wobbles (jitter); drawing a little in the past, between two snapshots we
 * already have, hides that. How far in the past adapts to the connection:
 * about one snapshot gap plus the jitter we've seen, clamped.
 *
 * Times here are the server's round time in ms (snapshot tick × step) and the
 * local clock in ms. The draw time moves at real speed, nudged at most a few
 * percent faster or slower to stay on target, never backwards; it may run a
 * little past the newest snapshot (shots then fly on by their speed) when one
 * is late, and it holds at the newest one while the round is paused or over.
 */

export const RENDER_CLOCK = {
  /** Shortest and longest delay behind the server's newest picture (ms). */
  minDelayMs: 45,
  maxDelayMs: 450,
  /** Safety added on top of gap + jitter (ms). */
  marginMs: 12,
  /** Arrivals remembered for the estimate (ms of local time). */
  windowMs: 4000,
  /** Jitter is this share of arrivals (0.95: one late snapshot in twenty can still stall a little; extrapolation covers it). */
  percentile: 0.95,
  /** The longest we draw past the newest snapshot (ms). */
  maxAheadMs: 120,
  /** Off by more than this (a hidden tab, a long stall): jump instead of easing (forward only). */
  jumpMs: 600,
  /** How hard the speed leans toward the target: speed = 1 + error × gain, within ±maxLean. */
  gain: 0.0015,
  maxLean: 0.08,
  /** Delay changes ease in at this share per snapshot (so the buffer doesn't twitch). */
  delayEase: 0.1,
} as const

export interface RenderClockStats {
  /** Current delay behind the newest picture (ms). */
  delayMs: number
  /** Jitter estimate (ms). */
  jitterMs: number
  /** Gap between snapshots (ms). */
  gapMs: number
  /** Times the draw time had to run past the newest snapshot, and stood still waiting. */
  aheadFrames: number
  heldFrames: number
}

export class RenderClock {
  private arrivals: { at: number; ms: number }[] = []
  private renderMs = -1
  private delay: number
  private jitter = 0
  private gap = 50
  private wasHeld = false
  aheadFrames = 0
  heldFrames = 0

  constructor(
    private readonly opts: typeof RENDER_CLOCK = RENDER_CLOCK,
    initialDelayMs = 100,
  ) {
    this.delay = initialDelayMs
  }

  /**
   * A snapshot for server time `ms` arrived at local time `at`. `running`:
   * the round's clock moves (not paused or over); a pause breaks the link
   * between the two clocks, so the estimate starts over.
   */
  arrive(at: number, ms: number, running: boolean): void {
    if (!running) {
      this.arrivals.length = 0
      this.wasHeld = true
      return
    }
    if (this.wasHeld) {
      this.wasHeld = false
      this.arrivals.length = 0
    }
    const prev = this.arrivals[this.arrivals.length - 1]
    if (prev && ms < prev.ms) return
    this.arrivals.push({ at, ms })
    while (this.arrivals.length > 2 && at - this.arrivals[0].at > this.opts.windowMs) this.arrivals.shift()
    this.estimate()
  }

  private estimate(): void {
    const a = this.arrivals
    if (a.length < 4) return
    let base = Infinity
    for (const p of a) base = Math.min(base, p.at - p.ms)
    const late = a.map((p) => p.at - p.ms - base).sort((x, y) => x - y)
    this.jitter = late[Math.min(late.length - 1, Math.floor(late.length * this.opts.percentile))]
    const gaps: number[] = []
    for (let i = 1; i < a.length; i++) if (a[i].ms > a[i - 1].ms) gaps.push(a[i].ms - a[i - 1].ms)
    gaps.sort((x, y) => x - y)
    if (gaps.length) this.gap = gaps[gaps.length >> 1]
    const want = clamp(this.gap + this.jitter + this.opts.marginMs, this.opts.minDelayMs, this.opts.maxDelayMs)
    this.delay += (want - this.delay) * this.opts.delayEase
  }

  /** Where the draw time should be at local time `now` (server ms). */
  private target(now: number, latestMs: number, latestAt: number): number {
    const a = this.arrivals
    let base: number
    if (a.length >= 4) {
      base = Infinity
      for (const p of a) base = Math.min(base, p.at - p.ms)
    } else base = latestAt - latestMs
    return now - base - this.delay
  }

  /**
   * One frame: move the draw time on by `frameMs` (give or take the lean) and
   * return it. `latestMs` / `latestAt`: the newest snapshot's server time and
   * when it arrived. `held`: paused or over (draw up to the newest, no further).
   */
  frame(now: number, frameMs: number, latestMs: number, latestAt: number, held: boolean): number {
    const target = held ? latestMs : this.target(now, latestMs, latestAt)
    const old = this.renderMs
    let next: number
    if (old < 0) next = Math.min(target, latestMs)
    else if (target - old > this.opts.jumpMs) next = Math.min(target, latestMs) // far behind: jump (forward only)
    else {
      const err = target - old
      // Far ahead (the line got slower): slow down hard, but never go back.
      const lean = err < -this.opts.jumpMs ? -0.5 : clamp(err * this.opts.gain, -this.opts.maxLean, this.opts.maxLean)
      next = old + Math.max(0, frameMs) * (1 + lean)
    }
    const cap = held ? latestMs : latestMs + this.opts.maxAheadMs
    if (next > cap) {
      // Out of pictures: stand still (never backwards) until the next one comes.
      next = Math.max(old, cap)
      if (!held && next === old) this.heldFrames++
    }
    if (!held && next > latestMs) this.aheadFrames++
    this.renderMs = Math.max(old, next)
    return this.renderMs
  }

  /** Start over (back from a hidden tab: jump to now instead of easing). */
  reset(): void {
    this.renderMs = -1
    this.arrivals.length = 0
  }

  get stats(): RenderClockStats {
    return { delayMs: Math.round(this.delay), jitterMs: Math.round(this.jitter), gapMs: Math.round(this.gap), aheadFrames: this.aheadFrames, heldFrames: this.heldFrames }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
