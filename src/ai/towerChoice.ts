import { KIND_IDS, damageFor, laneKey, spreadDegFor } from '../config/kinds'
import { TUNING } from '../config/tuning'
import type { Cannon } from '../entities/Cannon'
import { MIN_LANE_DEG, type LaneTable } from '../sim/solver'
import type { CannonKind, LevelDef } from '../types'
import { levelDifficulty, type AiLevel } from './difficulty'

/**
 * Tower type choice for the AI and the test bots: pick the type that finishes
 * a cannon's current job (capturing a foe or healing a friend) soonest. Same
 * swap rules as the player (Cannon.setKind: a full reload), plus the AI's own
 * restraint (a cooldown and a required gain) so it never flip-flops.
 */

export type AiDifficulty = AiLevel

export interface SwapPolicy {
  /** Minimum time between two swaps of the same cannon (ms). */
  cooldownMs: number
  /** The best type must finish the job at least this many times faster. */
  gain: number
}

/** The map's difficulty (see levelDifficulty). */
export function aiDifficulty(level: Pick<LevelDef, 'ai'>): AiDifficulty {
  return levelDifficulty(level)
}

/** Swap restraint: the same at every difficulty (difficulty is intelligence only). */
export function swapPolicy(_level?: Pick<LevelDef, 'ai'>): SwapPolicy {
  return { cooldownMs: TUNING.aiSwap.cooldownMs, gain: TUNING.aiSwap.gain }
}

/** Share of shots that land on a lane `widthDeg` wide, aimed at its middle. */
export function hitShare(kind: CannonKind, widthDeg: number): number {
  const spread = spreadDegFor(kind)
  return spread > 0 ? Math.min(1, widthDeg / (2 * spread)) : 1
}

/**
 * Expected capture progress (or heal) per millisecond that `cannon`, fitted
 * as `kind`, puts on `target`. 0 when it has no usable lane (or the lanes for
 * that type are not built yet).
 */
export function kindRate(cannon: Cannon, kind: CannonKind, target: Cannon, lanes: LaneTable): number {
  const lane = lanes.get(laneKey(cannon.id, kind))?.get(target.id)
  if (!lane || lane.widthDeg < MIN_LANE_DEG) return 0
  return (damageFor(kind) * hitShare(kind, lane.widthDeg)) / cannon.fireMsAs(kind)
}

/** True when some tower type gives `cannon` a usable lane to `target`. */
export function canReach(cannon: Cannon, target: Cannon, lanes: LaneTable): boolean {
  return KIND_IDS.some((kind) => kindRate(cannon, kind, target, lanes) > 0)
}

/** Damage still needed to finish the job: capture `target`, or heal it when it is a friend. */
export function workLeft(cannon: Cannon, target: Cannon): number {
  const t = TUNING.captureThreshold
  if (target.side === cannon.side) return target.captureProgress
  if (target.captureAttacker === cannon.side) return t - target.captureProgress
  if (target.captureAttacker) return t + target.captureProgress // push theirs back first
  return t
}

/** Estimated ms to finish the job fitted as `kind` (a different type pays its swap reload first). */
export function jobTime(cannon: Cannon, kind: CannonKind, target: Cannon, lanes: LaneTable): number {
  const rate = kindRate(cannon, kind, target, lanes)
  if (rate <= 0) return Infinity
  const left = Math.max(workLeft(cannon, target), damageFor(kind))
  const reload = kind === cannon.kind ? 0 : Math.max(TUNING.swapLockMs, cannon.fireMsAs(kind))
  return reload + left / rate
}

/**
 * The type `cannon` should be for this job. Keeps its current type unless
 * another finishes the job `gain` times sooner (or the current type can't hit
 * it at all).
 */
export function bestKind(cannon: Cannon, target: Cannon, lanes: LaneTable, gain = 1): CannonKind {
  const current = jobTime(cannon, cannon.kind, target, lanes)
  let best = cannon.kind
  let bestTime = current
  for (const kind of KIND_IDS) {
    if (kind === cannon.kind) continue
    const t = jobTime(cannon, kind, target, lanes)
    if (t < bestTime) {
      best = kind
      bestTime = t
    }
  }
  if (best === cannon.kind) return best
  if (current === Infinity || bestTime * gain < current) return best
  return cannon.kind
}

/**
 * Remembers when each cannon last swapped, so one side's swaps respect the
 * policy's cooldown (half of it for a heal). Swaps that are the only way to
 * hit the job skip the wait.
 */
export class SwapGovernor {
  private now = 0
  private readonly last = new Map<string, number>()

  constructor(public policy: SwapPolicy = swapPolicy()) {}

  tick(dt: number): void {
    this.now += dt
  }

  reset(policy: SwapPolicy = this.policy): void {
    this.policy = policy
    this.now = 0
    this.last.clear()
  }

  /**
   * The type `cannon` would be fitted as for this job right now: the best
   * type if that beats the current one by the policy's gain and the cooldown
   * allows a swap (or the current type can't hit the job at all), else its
   * current type.
   */
  preview(cannon: Cannon, target: Cannon, lanes: LaneTable): CannonKind {
    if (cannon.swapping) return cannon.kind
    const kind = bestKind(cannon, target, lanes, this.policy.gain)
    if (kind === cannon.kind) return kind
    const stuck = kindRate(cannon, cannon.kind, target, lanes) <= 0
    const since = this.now - (this.last.get(cannon.id) ?? -Infinity)
    // Healing a friend under attack is urgent: half the wait.
    const wait = target.side === cannon.side ? this.policy.cooldownMs / 2 : this.policy.cooldownMs
    return stuck || since >= wait ? kind : cannon.kind
  }

  /**
   * Decide (and, through `swap`, make) a type change for `cannon`'s job.
   * Returns true when it swapped.
   */
  consider(cannon: Cannon, target: Cannon, lanes: LaneTable, swap: (c: Cannon, kind: CannonKind) => boolean): boolean {
    const kind = this.preview(cannon, target, lanes)
    if (kind === cannon.kind) return false
    if (!swap(cannon, kind)) return false
    this.last.set(cannon.id, this.now)
    return true
  }
}
