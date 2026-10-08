import type { CannonKind } from '../types'

/**
 * One pop voice. The same short "pop" sample plays for everything; only the
 * loudness and pitch differ.
 * - volume: 0..1, before the player's master volume and the attenuation below.
 * - rate: playback rate (1 = as recorded; below 1 is lower and slightly longer).
 * - jitterCents: each play is detuned by a random amount in ±jitterCents
 *   (100 cents = one semitone), so repeats don't sound robotic.
 */
export interface PopSpec {
  volume: number
  rate: number
  jitterCents: number
}

export type FiringKind = Exclude<CannonKind, 'shield'>
export type PopKind = FiringKind | 'capture' | 'shieldBreak'

/** Sound effects: tune by ear here. */
export const SFX = {
  /** The pop sample (Pixabay "Pop Cartoon" by CreatorsHome), trimmed to ~120 ms. */
  key: 'pop',
  files: ['sfx/pop.ogg', 'sfx/pop.mp3'],
  /** Length of the trimmed sample at rate 1 (ms), for voice counting. */
  sampleMs: 120,
  /** Master volume slider default (0..1); the player's choice is saved on the device. */
  defaultVolume: 0.7,

  /** Shots, per tower type (the Shield doesn't shoot). */
  shot: {
    normal: { volume: 0.5, rate: 1, jitterCents: 40 },
    // Slightly louder and deeper: rate 0.84 is about 3 semitones down.
    sniper: { volume: 0.62, rate: 0.84, jitterCents: 25 },
    // About a third as loud as Normal, a bit higher, and a wide random detune per shot.
    machinegun: { volume: 0.18, rate: 1.15, jitterCents: 120 },
  } satisfies Record<FiringKind, PopSpec>,
  /** A cannon flips side: a bigger, deeper pop. */
  capture: { volume: 0.5, rate: 0.66, jitterCents: 0 } satisfies PopSpec,
  /** A barrier breaks: lowest pop. */
  shieldBreak: { volume: 0.45, rate: 0.55, jitterCents: 30 } satisfies PopSpec,

  /** The pre-round countdown: a crisp tick on 3, 2 and 1, and a brighter pop on Go. */
  countdown: {
    tick: { volume: 0.4, rate: 1.3, jitterCents: 0 },
    go: { volume: 0.55, rate: 1.75, jitterCents: 0 },
  } satisfies Record<'tick' | 'go', PopSpec>,

  /** At most this many pops at once. Past that, a new pop replaces the quietest one only if it is clearly louder. */
  maxVoices: 6,
  /** A louder pop replaces the quietest playing one only when it is at least this much louder. */
  stealRatio: 1.3,
  /** One cannon pops at most this often (ms); machine guns shoot every 200 ms. */
  sourceGapMs: 150,
  /** All pops of one kind at least this far apart (ms): many machine guns merge into a steady patter. */
  kindGapMs: { normal: 25, sniper: 0, machinegun: 50, capture: 0, shieldBreak: 0 } satisfies Record<PopKind, number>,
  /**
   * Burst cap: at most `perKind` pops of one kind and `total` pops overall in
   * any `windowMs`. Many shots landing in one frame (a slow frame, the online
   * view catching up) can never become a wall of sound.
   */
  burst: { windowMs: 250, perKind: 3, total: 6 },
  /** After coming back to the tab, no pops for this long (ms): anything due then is catch-up, not news. */
  quietAfterReturnMs: 400,
  /** Shots from the other sides (pink, and gold's AI opponent) are quieter than yours. */
  otherSideGain: 0.6,
  /** Off-screen pops fade from full at the view's edge down to `gain` at `fadePx` world px beyond it. */
  offscreen: { gain: 0.3, fadePx: 400 },
  /** Zoomed out on a big map (more cannons in view), everything is a bit quieter: gain = min + (1 - min) * zoom. */
  zoomedOutMin: 0.7,
  /** Each pop already playing lowers a new one by this fraction (1 / (1 + crowd * playing)). */
  crowd: 0.08,
  /** Left/right pan by position in the view (0 = none, 1 = hard left/right at the edges). */
  pan: 0.5,
}
