import { BOARD } from '../config/layout'
import type { Rect } from '../types'
import { TUNING } from '../config/tuning'
import { pickAiTarget } from '../sim/targeting'
import { MIN_LANE_DEG, lanesOf, type Lane, type LaneTable } from '../sim/solver'
import { KIND_IDS, laneKey } from '../config/kinds'
import type { Cannon } from '../entities/Cannon'
import type { CannonKind, Point, Side } from '../types'

/**
 * Periodically aims every cannon of one side at the nearest weak foe it can
 * actually hit. It knows the level's lanes (including bank shots and fan
 * curves), so it aims at a point when a straight shot would be blocked.
 * Its cannons obey the same turn speed as yours.
 */
export class AiController {
  private elapsed = 0
  private lanes: LaneTable = new Map()
  private retargetMs: number = TUNING.aiRetargetMs
  private readonly picks = new Map<string, string>()
  private board: Rect = BOARD

  constructor(readonly side: Side = 'enemy') {}

  reset(lanes: LaneTable = new Map(), retargetMs: number = TUNING.aiRetargetMs, board: Rect = BOARD): void {
    this.board = board
    // Keep the level's opening targets for one full retarget interval.
    this.elapsed = 0
    this.lanes = lanes
    this.retargetMs = retargetMs
    this.picks.clear()
  }

  update(dt: number, cannons: Cannon[]): void {
    this.elapsed += dt
    if (this.elapsed < this.retargetMs) return
    this.elapsed = 0
    this.retarget(cannons)
  }

  retarget(cannons: Cannon[]): void {
    const prey = cannons.filter((cannon) => cannon.side !== this.side)
    const busy = this.assignHealers(cannons)
    for (const { cannon, kind } of planSwaps(this.side, cannons, this.lanes, busy)) cannon.setKind(kind)
    for (const cannon of cannons) {
      if (cannon.side !== this.side || busy.has(cannon)) continue
      const lanes = lanesOf(this.lanes, cannon)
      const reachable = prey.filter((other) => (lanes?.get(other.id)?.widthDeg ?? 0) >= MIN_LANE_DEG)
      const pool = reachable.length ? reachable : prey
      const currentId = this.picks.get(cannon.id) ?? cannon.target?.id ?? null
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
      if (!choice) continue
      if (choice.id === currentId && cannon.aim()) continue
      const target = cannons.find((other) => other.id === choice.id)
      if (!target) continue
      aimViaLane(cannon, target, lanes?.get(target.id), this.board)
      this.picks.set(cannon.id, target.id)
    }
  }

  /** Send helpers to cannons close to flipping; returns every cannon busy healing. */
  private assignHealers(cannons: Cannon[]): Set<Cannon> {
    for (const { helper, friend } of planHeals(this.side, cannons, this.lanes)) {
      healViaLane(helper, friend, lanesOf(this.lanes, helper)?.get(friend.id), this.board)
      this.picks.delete(helper.id)
    }
    const busy = new Set<Cannon>()
    for (const c of cannons) if (c.side === this.side && c.healing && c.healing.damaged) busy.add(c)
    return busy
  }
}

export interface SwapOrder {
  cannon: Cannon
  kind: CannonKind
}

/**
 * Tower swaps, kept simple (used by the AI and the test bot):
 * 1. A foe that none of the side's cannons can reach as they are fitted, but
 *    one could after a swap: swap the cannon with the widest such lane.
 * 2. A cannon that can't reach any foe as it is, but could as another type,
 *    swaps to the type that reaches the most foes.
 * Only uses lanes that are already built.
 */
export function planSwaps(side: Side, cannons: Cannon[], lanes: LaneTable, skip: Set<Cannon> = new Set()): SwapOrder[] {
  const mine = cannons.filter((c) => c.side === side && !skip.has(c) && !c.swapping)
  const prey = cannons.filter((c) => c.side !== side)
  const width = (c: Cannon, kind: CannonKind, foe: Cannon): number =>
    lanes.get(laneKey(c.id, kind))?.get(foe.id)?.widthDeg ?? 0
  const orders: SwapOrder[] = []
  const taken = new Set<Cannon>()
  const fitted = cannons.filter((c) => c.side === side)
  for (const foe of prey) {
    if (fitted.some((c) => width(c, c.kind, foe) >= MIN_LANE_DEG)) continue
    let best: SwapOrder | null = null
    let bestW = 0
    for (const c of mine) {
      if (taken.has(c)) continue
      for (const kind of KIND_IDS) {
        if (kind === c.kind) continue
        const w = width(c, kind, foe)
        if (w >= MIN_LANE_DEG && w > bestW) {
          best = { cannon: c, kind }
          bestW = w
        }
      }
    }
    if (best) {
      orders.push(best)
      taken.add(best.cannon)
    }
  }
  for (const c of mine) {
    if (taken.has(c) || !lanes.has(laneKey(c.id, c.kind))) continue
    const reach = (kind: CannonKind) => prey.filter((p) => width(c, kind, p) >= MIN_LANE_DEG).length
    if (reach(c.kind) > 0) continue
    let best = c.kind
    let bestReach = 0
    for (const kind of KIND_IDS) {
      if (!lanes.has(laneKey(c.id, kind))) continue
      const r = reach(kind)
      if (r > bestReach) {
        best = kind
        bestReach = r
      }
    }
    if (best !== c.kind) orders.push({ cannon: c, kind: best })
  }
  return orders
}

export interface HealOrder {
  helper: Cannon
  friend: Cannon
}

/**
 * Healing: each own cannon that is close to flipping (at least
 * TUNING.aiHealAtProgress of the meter gone) gets one helper, the nearest
 * other own cannon with a clear lane to it. Helpers that are about to finish
 * their own capture are left alone. Returns every cannon now busy healing.
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
      if ((lanesOf(lanes, c)?.get(friend.id)?.widthDeg ?? 0) < MIN_LANE_DEG) continue
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
