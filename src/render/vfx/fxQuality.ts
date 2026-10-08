/**
 * Settings → Display → Effects quality: High, Low or Off, saved on this
 * device. Until you pick one it's chosen for you: High, or Low on a low-end
 * device (few cores or little memory, or a phone that's both), or when a
 * battle keeps running slowly at High. Pure logic plus the saved choice; the
 * effects themselves are in Vfx.ts.
 */
export type FxQuality = 'high' | 'low' | 'off'
export const FX_QUALITIES: readonly FxQuality[] = ['high', 'low', 'off']
export const FX_KEY = 'cannon-capture:fx:v1'

export interface FxPrefs {
  /** Your pick; null: automatic. */
  choice: FxQuality | null
  /** Automatic only: a battle ran slowly at High on this device, so start at Low. */
  slow: boolean
}

export const FX_DEFAULTS: FxPrefs = { choice: null, slow: false }

/** What the browser says about the device (all optional: many browsers say little). */
export interface DeviceHints {
  /** navigator.deviceMemory (GB, rounded down by the browser). */
  memoryGb?: number
  /** navigator.hardwareConcurrency. */
  cores?: number
  /** A touch screen is the main pointer (phones, tablets). */
  coarse?: boolean
}

/** A device that should start at Low. */
export function lowEndDevice(h: DeviceHints): boolean {
  const mem = h.memoryGb
  const cores = h.cores
  if (mem !== undefined && mem > 0 && mem <= 2) return true
  if (cores !== undefined && cores > 0 && cores <= 2) return true
  if (h.coarse && ((mem !== undefined && mem > 0 && mem <= 4) || (cores !== undefined && cores > 0 && cores <= 4))) return true
  return false
}

/** The quality in use, and whether it was chosen automatically. */
export function resolveQuality(p: FxPrefs, h: DeviceHints): { quality: FxQuality; auto: boolean } {
  if (p.choice) return { quality: p.choice, auto: false }
  return { quality: p.slow || lowEndDevice(h) ? 'low' : 'high', auto: true }
}

export function parseFxPrefs(raw: string | null): FxPrefs {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<FxPrefs>) : null
    return {
      choice: v && FX_QUALITIES.includes(v.choice as FxQuality) ? (v.choice as FxQuality) : null,
      slow: v?.slow === true,
    }
  } catch {
    return { ...FX_DEFAULTS }
  }
}

/** Where the effects run: a battle, or the demo battle behind the menu (never above Low there). */
export type FxScope = 'battle' | 'demo'

/** What the effects may do: from the quality, Reduce motion and where they run. */
export interface FxConfig {
  quality: FxQuality
  /** Particles alive at once, per layer (glows, smoke). 0: none. */
  particles: number
  /** New particles per frame at most (a busy frame never spikes). */
  perFrame: number
  /** How many particles a burst gets (1 at High). */
  burst: number
  /** Team-colour auras under owned cannons, and whether they breathe and turn. */
  aura: boolean
  auraMotion: boolean
  /** Shots: a glow on the head and a fading trail (at most this many shots get them). */
  shotFx: number
  shotGlow: boolean
  /** Muzzle smoke, fan air streaks, low-health sparks. */
  smoke: boolean
  fanAir: number
  /** Expanding rings (captures, Go, shield breaks) and the end-of-round sweep. */
  rings: boolean
  /** Barrel recoil, the hit shake, the low-health wobble and the eased barrel turn. */
  recoil: boolean
  wobble: boolean
  /** Small camera shakes on big moments (captures of yours). */
  shake: boolean
}

const OFF: FxConfig = {
  quality: 'off', particles: 0, perFrame: 0, burst: 0, aura: false, auraMotion: false, shotFx: 0, shotGlow: false,
  smoke: false, fanAir: 0, rings: false, recoil: false, wobble: false, shake: false,
}

export function fxConfig(quality: FxQuality, reduceMotion: boolean, scope: FxScope = 'battle'): FxConfig {
  const q: FxQuality = scope === 'demo' && quality === 'high' ? 'low' : quality
  if (q === 'off') return OFF
  const high = q === 'high'
  const moving = !reduceMotion
  return {
    quality: q,
    particles: high ? 360 : 140,
    perFrame: high ? 90 : 36,
    burst: high ? 1 : 0.45,
    aura: true,
    auraMotion: moving,
    shotFx: high ? 260 : 140,
    shotGlow: high,
    smoke: high,
    // Air streaks per fan per second.
    fanAir: moving ? (high ? 9 : 4) : 0,
    rings: moving,
    recoil: moving,
    wobble: moving && high,
    shake: moving && high && scope === 'battle',
  }
}

/**
 * Automatic quality only: watches battle frames at High and says when to
 * drop to Low, after `windowMs` of frames averaging slower than `slowMs`
 * (about 45 fps). Hidden-tab gaps and the first seconds (loading, the board
 * filling up) don't count. No allocation per frame.
 */
export class SlowWatch {
  private sum = 0
  private ms = 0
  private count = 0
  private skip: number
  constructor(
    private readonly slowMs = 1000 / 45,
    private readonly windowMs = 5000,
    private readonly warmupMs = 3000,
  ) {
    this.skip = warmupMs
  }

  /** One frame of `dtMs`. True once: the frames have been slow for a whole window. */
  push(dtMs: number): boolean {
    if (!(dtMs > 0) || dtMs > 250) return false
    if (this.skip > 0) {
      this.skip -= dtMs
      return false
    }
    this.sum += dtMs
    this.ms += dtMs
    this.count++
    if (this.ms < this.windowMs) return false
    const slow = this.sum / Math.max(1, this.count) > this.slowMs
    this.reset(0)
    return slow
  }

  /** Start over (after a pause, a hidden tab, a quality change). */
  reset(warmupMs = this.warmupMs): void {
    this.sum = 0
    this.ms = 0
    this.count = 0
    this.skip = warmupMs
  }
}
