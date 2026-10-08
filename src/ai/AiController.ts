import { BOARD } from '../config/layout'
import type { Rect } from '../types'
import { TUNING } from '../config/tuning'
import { pickAiTarget } from '../sim/targeting'
import { MIN_LANE_DEG, lanesOf, type Lane, type LaneTable } from '../sim/solver'
import { KIND_IDS, laneKey } from '../config/kinds'
import type { Cannon } from '../entities/Cannon'
import type { CannonKind, Point, Side } from '../types'
import { SwapGovernor, canReach, type SwapPolicy } from './towerChoice'

/**
 * Periodically aims every cannon of one side at the nearest weak foe it can
 * actually hit, and fits each cannon with the tower type that suits its job
 * (see towerChoice.ts). It knows the level's lanes (including bank shots and
 * fan curves), so it aims at a point when a straight shot would be blocked.
 * Its cannons obey the same turn speed and swap rules as yours.
 */
export class AiController {
  private elapsed = 0
  private lanes: LaneTable = new Map()
  private retargetMs: number = TUNING.aiRetargetMs
  private readonly picks = new Map<string, string>()
  private board: Rect = BOARD
  readonly swaps = new SwapGovernor()

  constructor(readonly side: Side = 'enemy') {}

  reset(lanes: LaneTable = new Map(), retargetMs: number = TUNING.aiRetargetMs, board: Rect = BOARD, policy?: SwapPolicy): void {
    this.board = board
    // Keep the level's opening targets for one full retarget interval.
    this.elapsed = 0
    this.lanes = lanes
    this.retargetMs = retargetMs
    this.picks.clear()
    this.swaps.reset(policy)
  }

  update(dt: number, cannons: Cannon[]): void {
    this.swaps.tick(dt)
    this.elapsed += dt
    if (this.elapsed < this.retargetMs) return
    this.elapsed = 0
    this.retarget(cannons)
  }

  retarget(cannons: Cannon[]): void {
    const prey = cannons.filter((cannon) => cannon.side !== this.side)
    const busy = this.assignHealers(cannons)
    // A foe nobody can reach as fitted gets one cannon that can, after a swap.
    const cover = new Map<Cannon, Cannon>()
    for (const o of planCover(this.side, cannons, this.lanes, busy)) cover.set(o.cannon, o.foe)
    for (const cannon of cannons) {
      if (cannon.side !== this.side || busy.has(cannon)) continue
      const lanes = lanesOf(this.lanes, cannon)
      // Prefer foes it can hit as it is; otherwise any it could hit after a swap.
      const now = prey.filter((other) => (lanes?.get(other.id)?.widthDeg ?? 0) >= MIN_LANE_DEG)
      const later = now.length ? now : prey.filter((other) => canReach(cannon, other, this.lanes))
      const pool = later.length ? later : prey
      const currentId = this.picks.get(cannon.id) ?? cannon.target?.id ?? null
      let target = cover.get(cannon) ?? null
      if (!target) {
        const choice = pickAiTarget(
          cannon,
          pool.map((other) => ({
            id: other.id,
            x: other.x,
            y: other.y,
            attacker: other.captureAttacker === this.side ? 'enemy' : null,
            progress: other.captureProgress,
          })),
          TUNING.aiFinishBias,
          currentId,
          TUNING.aiRetargetSlack,
        )
        target = choice ? (cannons.find((other) => other.id === choice.id) ?? null) : null
      }
      if (!target) continue
      const swapped = this.swaps.consider(cannon, target, this.lanes, (c, kind) => c.setKind(kind))
      if (!swapped && target.id === currentId && cannon.aim()) continue
      aimViaLane(cannon, target, lanesOf(this.lanes, cannon)?.get(target.id), this.board)
      this.picks.set(cannon.id, target.id)
    }
  }

  /** Send helpers to cannons close to flipping; returns every cannon busy healing. */
  private assignHealers(cannons: Cannon[]): Set<Cannon> {
    for (const { helper, friend } of planHeals(this.side, cannons, this.lanes)) {
      this.swaps.consider(helper, friend, this.lanes, (c, kind) => c.setKind(kind))
      healViaLane(helper, friend, lanesOf(this.lanes, helper)?.get(friend.id), this.board)
      this.picks.delete(helper.id)
    }
    const busy = new Set<Cannon>()
    for (const c of cannons) {
      if (c.side !== this.side || !c.healing || !c.healing.damaged) continue
      busy.add(c)
      // Already healing: switch to a better type for the job if it is worth it (re-aim on the new lane).
      const friend = c.healing
      if (this.swaps.consider(c, friend, this.lanes, (h, kind) => h.setKind(kind))) {
        healViaLane(c, friend, lanesOf(this.lanes, c)?.get(friend.id), this.board)
      }
    }
    return busy
  }
}

export interface CoverOrder {
  cannon: Cannon
  kind: CannonKind
  foe: Cannon
}

/**
 * A foe that none of the side's cannons can reach as they are fitted, but one
 * could after a swap (a sniper through a headwind, say): pick the cannon with
 * the widest such lane to go after it. A machine gun counts as covering what
 * it could hit as a normal cannon (it is only a gun because something is close).
 */
export function planCover(side: Side, cannons: Cannon[], lanes: LaneTable, skip: Set<Cannon> = new Set()): CoverOrder[] {
  const mine = cannons.filter((c) => c.side === side && !skip.has(c) && !c.swapping)
  const prey = cannons.filter((c) => c.side !== side)
  const width = (c: Cannon, kind: CannonKind, foe: Cannon): number => lanes.get(laneKey(c.id, kind))?.get(foe.id)?.widthDeg ?? 0
  const hits = (c: Cannon, kind: CannonKind, foe: Cannon): boolean => width(c, kind, foe) >= MIN_LANE_DEG
  const orders: CoverOrder[] = []
  const taken = new Set<Cannon>()
  const fitted = cannons.filter((c) => c.side === side)
  for (const foe of prey) {
    if (fitted.some((c) => hits(c, c.kind, foe) || (c.kind === 'machinegun' && hits(c, 'normal', foe)))) continue
    let best: CoverOrder | null = null
    let bestW = 0
    for (const c of mine) {
      if (taken.has(c)) continue
      for (const kind of KIND_IDS) {
        if (kind === c.kind) continue
        const w = width(c, kind, foe)
        if (hits(c, kind, foe) && w > bestW) {
          best = { cannon: c, kind, foe }
          bestW = w
        }
      }
    }
    if (best) {
      orders.push(best)
      taken.add(best.cannon)
    }
  }
  return orders
}

/** Older name for planCover (the swap each cover order implies). */
export function planSwaps(side: Side, cannons: Cannon[], lanes: LaneTable, skip: Set<Cannon> = new Set()): CoverOrder[] {
  return planCover(side, cannons, lanes, skip)
}

export interface HealOrder {
  helper: Cannon
  friend: Cannon
}

/**
 * Healing: each own cannon that is close to flipping (at least
 * TUNING.aiHealAtProgress of the meter gone) gets one helper, the nearest
 * other own cannon with a clear lane to it as some tower type (it swaps if
 * that pays off). Helpers that are about to finish their own capture are
 * left alone.
 */
export function planHeals(side: Side, cannons: Cannon[], lanes: LaneTable): HealOrder[] {
  const mine = cannons.filter((c) => c.side === side)
  if (mine.length < 2) return []
  const busy = new Set<Cannon>()
  const orders: HealOrder[] = []
  for (const c of mine) if (c.healing && c.healing.side === side && c.healing.damaged) busy.add(c)
  const hurt = mine
    .filter((c) => c.damaged && c.captureProgress >= TUNING.aiHealAtProgress)
    .sort((a, b) => b.captureProgress - a.captureProgress)
  for (const friend of hurt) {
    if (mine.some((c) => c.healing === friend)) continue
    let helper: Cannon | null = null
    let best = Infinity
    for (const c of mine) {
      if (c === friend || busy.has(c)) continue
      if (!canReach(c, friend, lanes)) continue
      const prey = c.target
      if (prey && prey.side !== side && prey.captureAttacker === side && prey.captureProgress >= TUNING.captureThreshold - 2) continue
      const d = Math.hypot(c.x - friend.x, c.y - friend.y)
      if (d < best) {
        best = d
        helper = c
      }
    }
    if (!helper) continue
    busy.add(helper)
    orders.push({ helper, friend })
  }
  return orders
}

/** Start a heal along the helper's lane (straight if that lands). */
export function healViaLane(helper: Cannon, friend: Cannon, lane: Lane | undefined, board: Rect = BOARD): void {
  if (!lane || lane.direct) helper.startHeal(friend)
  else helper.startHeal(friend, pointAlong(helper, lane.angle, board))
}

/** Aim straight at the target if that lands, otherwise at a point along the lane. */
export function aimViaLane(cannon: Cannon, target: Cannon, lane: Lane | undefined, board: Rect = BOARD): void {
  if (!lane || lane.direct) cannon.setTarget(target)
  else cannon.setAimPoint(pointAlong(cannon, lane.angle, board))
}

/** A point on the board in direction `angle` from `origin`. */
export function pointAlong(origin: Point, angle: number, board: Rect = BOARD, preferred = 160): Point {
  const BOARD_ = board
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  let t = preferred
  const margin = 8
  if (dx > 1e-6) t = Math.min(t, (BOARD_.x + BOARD_.w - margin - origin.x) / dx)
  if (dx < -1e-6) t = Math.min(t, (BOARD_.x + margin - origin.x) / dx)
  if (dy > 1e-6) t = Math.min(t, (BOARD_.y + BOARD_.h - margin - origin.y) / dy)
  if (dy < -1e-6) t = Math.min(t, (BOARD_.y + margin - origin.y) / dy)
  t = Math.max(t, 40)
  return { x: origin.x + dx * t, y: origin.y + dy * t }
}
