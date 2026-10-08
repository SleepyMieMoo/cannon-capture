/**
 * A fixed pool of particles, stored in typed arrays: nothing is allocated
 * after it's made, however many bursts there are. `cap` limits how many can
 * be alive (it can be lowered and raised up to `capacity`), `perFrame` how
 * many may start in one frame. When it's full, a new particle takes the
 * oldest one's slot, so bursts still show in a busy moment.
 * Pure (no Phaser): Vfx.ts draws each live slot with a pooled image.
 */

/** How a particle fades over its life. */
export const FADE_OUT = 0
/** Fades in, then out (air streaks). */
export const FADE_INOUT = 1
/** Holds, then fades over the last third (debris, plus signs). */
export const FADE_LATE = 2

export interface Spawn {
  x: number
  y: number
  vx?: number
  vy?: number
  /** Velocity kept per second (1: none lost, 0.05: stops fast). */
  drag?: number
  /** Pixels per second² added to vy (debris falls a little; plus signs rise with a negative one). */
  gravity?: number
  lifeMs: number
  /** Scale at the start and at the end of its life. */
  size0: number
  size1?: number
  alpha: number
  tint: number
  /** Which texture (an index Vfx.ts maps to a texture key). */
  tex: number
  rot?: number
  spin?: number
  /** Turned along its velocity, and stretched this many times along it (sparks, streaks). */
  stretch?: number
  fade?: number
}

export class ParticlePool {
  readonly capacity: number
  /** At most this many alive at once (≤ capacity). */
  cap: number
  /** At most this many started per frame (reset by step()). */
  perFrame: number
  private started = 0
  readonly alive: Uint8Array
  readonly x: Float32Array
  readonly y: Float32Array
  readonly vx: Float32Array
  readonly vy: Float32Array
  readonly drag: Float32Array
  readonly gravity: Float32Array
  readonly age: Float32Array
  readonly life: Float32Array
  readonly size0: Float32Array
  readonly size1: Float32Array
  readonly alpha0: Float32Array
  readonly rot: Float32Array
  readonly spin: Float32Array
  readonly stretch: Float32Array
  readonly tint: Uint32Array
  readonly tex: Uint8Array
  readonly fade: Uint8Array
  /** Free slots (a stack), and how many are alive. */
  private readonly free: Int32Array
  private freeTop: number
  private live = 0
  /** Where the next "take the oldest" search starts (round robin: oldest-ish, O(1)). */
  private steal = 0
  /** Slots used since the last check (for tests and the overlay). */
  dropped = 0

  constructor(capacity: number, cap = capacity, perFrame = capacity) {
    this.capacity = capacity
    this.cap = Math.min(cap, capacity)
    this.perFrame = perFrame
    const f = () => new Float32Array(capacity)
    this.alive = new Uint8Array(capacity)
    this.x = f()
    this.y = f()
    this.vx = f()
    this.vy = f()
    this.drag = f()
    this.gravity = f()
    this.age = f()
    this.life = f()
    this.size0 = f()
    this.size1 = f()
    this.alpha0 = f()
    this.rot = f()
    this.spin = f()
    this.stretch = f()
    this.tint = new Uint32Array(capacity)
    this.tex = new Uint8Array(capacity)
    this.fade = new Uint8Array(capacity)
    this.free = new Int32Array(capacity)
    for (let i = 0; i < capacity; i++) this.free[i] = capacity - 1 - i
    this.freeTop = capacity
  }

  get count(): number {
    return this.live
  }

  /** Change the limits (quality changed). Particles over a lower cap are let go. */
  setLimits(cap: number, perFrame: number): void {
    this.cap = Math.max(0, Math.min(cap, this.capacity))
    this.perFrame = perFrame
    if (this.live <= this.cap) return
    for (let i = this.capacity - 1; i >= 0 && this.live > this.cap; i--) if (this.alive[i]) this.kill(i)
  }

  /** Start a particle; returns its slot, or -1 when the frame's budget is spent (or the cap is 0). */
  spawn(s: Spawn): number {
    if (this.cap <= 0 || this.started >= this.perFrame) return -1
    let i: number
    if (this.live < this.cap && this.freeTop > 0) {
      i = this.free[--this.freeTop]
      this.live++
    } else {
      i = this.oldest()
      if (i < 0) return -1
      this.dropped++
    }
    this.started++
    this.alive[i] = 1
    this.x[i] = s.x
    this.y[i] = s.y
    this.vx[i] = s.vx ?? 0
    this.vy[i] = s.vy ?? 0
    this.drag[i] = s.drag ?? 1
    this.gravity[i] = s.gravity ?? 0
    this.age[i] = 0
    this.life[i] = Math.max(1, s.lifeMs)
    this.size0[i] = s.size0
    this.size1[i] = s.size1 ?? s.size0
    this.alpha0[i] = s.alpha
    this.rot[i] = s.rot ?? 0
    this.spin[i] = s.spin ?? 0
    this.stretch[i] = s.stretch ?? 0
    this.tint[i] = s.tint
    this.tex[i] = s.tex
    this.fade[i] = s.fade ?? FADE_OUT
    return i
  }

  /** The slot of a live particle to reuse: the next live one after the last taken, round robin. */
  private oldest(): number {
    let best = -1
    let bestK = -1
    // Look at a few candidates from the round-robin cursor and take the one furthest through its life.
    for (let n = 0, i = this.steal; n < this.capacity && n < 64; n++, i = (i + 1) % this.capacity) {
      if (!this.alive[i]) continue
      const k = this.age[i] / this.life[i]
      if (k > bestK) {
        bestK = k
        best = i
      }
      if (n >= 8 && best >= 0) break
    }
    if (best >= 0) this.steal = (best + 1) % this.capacity
    return best
  }

  kill(i: number): void {
    if (!this.alive[i]) return
    this.alive[i] = 0
    this.free[this.freeTop++] = i
    this.live--
  }

  /** Let every particle go (a new round, effects switched off). */
  clear(): void {
    for (let i = 0; i < this.capacity; i++) if (this.alive[i]) this.kill(i)
  }

  /** How far through its life (0..1). */
  t(i: number): number {
    return Math.min(1, this.age[i] / this.life[i])
  }

  /** Current scale. */
  size(i: number): number {
    const t = this.t(i)
    // Ease out: grows (or shrinks) fast at first.
    const e = 1 - (1 - t) * (1 - t)
    return this.size0[i] + (this.size1[i] - this.size0[i]) * e
  }

  /** Current opacity. */
  opacity(i: number): number {
    const t = this.t(i)
    const a = this.alpha0[i]
    switch (this.fade[i]) {
      case FADE_INOUT:
        return a * Math.sin(Math.PI * t)
      case FADE_LATE:
        return t < 0.66 ? a : a * (1 - (t - 0.66) / 0.34)
      default:
        return a * (1 - t) * (1 - t * 0.35)
    }
  }

  /** Move everything on by `dtMs`; frees the ones whose life is over. Resets the per-frame budget. */
  step(dtMs: number): void {
    this.started = 0
    if (this.live === 0) return
    const dt = dtMs / 1000
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue
      const age = this.age[i] + dtMs
      if (age >= this.life[i]) {
        this.kill(i)
        continue
      }
      this.age[i] = age
      const d = this.drag[i]
      if (d !== 1) {
        const k = Math.pow(d, dt)
        this.vx[i] *= k
        this.vy[i] *= k
      }
      this.vy[i] += this.gravity[i] * dt
      this.x[i] += this.vx[i] * dt
      this.y[i] += this.vy[i] * dt
      this.rot[i] += this.spin[i] * dt
    }
  }
}
