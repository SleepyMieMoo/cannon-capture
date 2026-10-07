import { BOARD } from '../config/layout'
import { TUNING } from '../config/tuning'
import { pickAiTarget } from '../sim/targeting'
import { MIN_LANE_DEG, type Lane, type LaneTable } from '../sim/solver'
import type { Cannon } from '../entities/Cannon'
import type { Point, Side } from '../types'

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

  constructor(readonly side: Side = 'enemy') {}

  reset(lanes: LaneTable = new Map(), retargetMs: number = TUNING.aiRetargetMs): void {
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
    for (const cannon of cannons) {
      if (cannon.side !== this.side) continue
      const lanes = this.lanes.get(cannon.id)
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
      aimViaLane(cannon, target, lanes?.get(target.id))
      this.picks.set(cannon.id, target.id)
    }
  }
}

/** Aim straight at the target if that lands, otherwise at a point along the lane. */
export function aimViaLane(cannon: Cannon, target: Cannon, lane: Lane | undefined): void {
  if (!lane || lane.direct) cannon.setTarget(target)
  else cannon.setAimPoint(pointAlong(cannon, lane.angle))
}

/** A point on the board in direction `angle` from `origin`. */
export function pointAlong(origin: Point, angle: number, preferred = 160): Point {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  let t = preferred
  const margin = 8
  if (dx > 1e-6) t = Math.min(t, (BOARD.x + BOARD.w - margin - origin.x) / dx)
  if (dx < -1e-6) t = Math.min(t, (BOARD.x + margin - origin.x) / dx)
  if (dy > 1e-6) t = Math.min(t, (BOARD.y + BOARD.h - margin - origin.y) / dy)
  if (dy < -1e-6) t = Math.min(t, (BOARD.y + margin - origin.y) / dy)
  t = Math.max(t, 40)
  return { x: origin.x + dx * t, y: origin.y + dy * t }
}
