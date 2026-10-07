import { BOARD } from '../config/layout'
import { TUNING } from '../config/tuning'
import type { LevelDef } from '../types'
import { aimShot, traceShot, type BallisticsOpts, type Body, type FanField } from './ballistics'

/**
 * Lane finder: fires a test shot from a cannon at every angle (1° apart) and
 * records which cannon it hits. Cannons never move and shots pass through
 * nothing but walls and cannons, so a level's lanes can be computed once.
 * Used by the enemy AI, the level-solvability tests and the debug bot.
 */

export const SHOT_OPTS: BallisticsOpts = {
  radius: TUNING.shotRadius,
  maxSpeed: TUNING.shotSpeed * TUNING.shotSpeedCap,
  maxBounces: TUNING.maxBounces,
  bounds: BOARD,
  ownerGraceMs: TUNING.ownerGraceMs,
}

export interface Lane {
  targetId: string
  /** Radians: the middle of the widest run of angles that hit the target. */
  angle: number
  /** How forgiving the lane is, in degrees. */
  widthDeg: number
  /** True when aiming straight at the target lands the shot. */
  direct: boolean
}

/** cannonId -> targetId -> best lane */
export type LaneTable = Map<string, Map<string, Lane>>

export function levelFans(level: LevelDef): FanField[] {
  return level.fans.map((fan) => ({
    x: fan.x,
    y: fan.y,
    radius: fan.radius,
    angle: fan.angle,
    force: fan.force ?? TUNING.fanForce,
  }))
}

export function levelBodies(level: LevelDef): Body[] {
  return level.cannons.map((c) => ({ id: c.id, x: c.x, y: c.y, radius: TUNING.cannonRadius }))
}

export function traceAngle(level: LevelDef, fromId: string, angle: number): string | null {
  const from = level.cannons.find((c) => c.id === fromId)
  if (!from) return null
  const shot = aimShot(
    from,
    { x: from.x + Math.cos(angle) * 100, y: from.y + Math.sin(angle) * 100 },
    TUNING.cannonRadius + 12,
    TUNING.shotSpeed,
    fromId,
  )
  return traceShot(shot, level.walls, levelFans(level), levelBodies(level), SHOT_OPTS, TUNING.shotLifetimeMs).hitId
}

export function sweep(level: LevelDef, fromId: string, stepDeg = 1): (string | null)[] {
  const out: (string | null)[] = []
  for (let deg = 0; deg < 360; deg += stepDeg) out.push(traceAngle(level, fromId, (deg * Math.PI) / 180))
  return out
}

/** Widest contiguous run of angles per target (wrapping round 360°). */
export function lanesFromSweep(hits: (string | null)[], stepDeg = 1): Map<string, { angle: number; widthDeg: number }> {
  const n = hits.length
  const best = new Map<string, { angle: number; widthDeg: number }>()
  if (n === 0) return best
  // Start scanning at a boundary so wrapped runs are seen whole.
  let start = 0
  while (start < n && hits[start] === hits[(start - 1 + n) % n]) start++
  if (start === n) {
    const id = hits[0]
    if (id) best.set(id, { angle: Math.PI, widthDeg: 360 })
    return best
  }
  let i = 0
  while (i < n) {
    const id = hits[(start + i) % n]
    let len = 1
    while (i + len < n && hits[(start + i + len) % n] === id) len++
    if (id) {
      const mid = ((start + i + (len - 1) / 2) % n) * stepDeg
      const prev = best.get(id)
      if (!prev || len * stepDeg > prev.widthDeg) best.set(id, { angle: (mid * Math.PI) / 180, widthDeg: len * stepDeg })
    }
    i += len
  }
  return best
}

export function levelLanes(level: LevelDef, stepDeg = 1): LaneTable {
  const table: LaneTable = new Map()
  for (const from of level.cannons) {
    const lanes = new Map<string, Lane>()
    for (const [targetId, lane] of lanesFromSweep(sweep(level, from.id, stepDeg), stepDeg)) {
      if (targetId === from.id) continue
      const target = level.cannons.find((c) => c.id === targetId)!
      const directAngle = Math.atan2(target.y - from.y, target.x - from.x)
      lanes.set(targetId, {
        targetId,
        ...lane,
        direct: traceAngle(level, from.id, directAngle) === targetId,
      })
    }
    table.set(from.id, lanes)
  }
  return table
}

/** Minimum lane width we treat as reliably hittable. */
export const MIN_LANE_DEG = 2

export interface PuzzlePlan {
  solved: boolean
  /** Aim orders in capture order. */
  steps: { from: string; to: string; lane: Lane }[]
}

/**
 * Greedy puzzle check: repeatedly let any player cannon that is not yet busy
 * aim at an uncaptured neutral it has a lane to. Each aim captures one neutral
 * (the shot then stops on the now-friendly cannon), so a plan uses one aim per
 * neutral.
 */
export function planPuzzle(level: LevelDef, lanes: LaneTable = levelLanes(level)): PuzzlePlan {
  const owned = new Set(level.cannons.filter((c) => c.side === 'player').map((c) => c.id))
  const neutral = new Set(level.cannons.filter((c) => c.side === 'neutral').map((c) => c.id))
  const steps: PuzzlePlan['steps'] = []
  let progress = true
  while (neutral.size && progress) {
    progress = false
    for (const from of owned) {
      let pick: Lane | null = null
      for (const lane of lanes.get(from)?.values() ?? []) {
        if (!neutral.has(lane.targetId) || lane.widthDeg < MIN_LANE_DEG) continue
        if (!pick || lane.widthDeg > pick.widthDeg) pick = lane
      }
      if (!pick) continue
      steps.push({ from, to: pick.targetId, lane: pick })
      neutral.delete(pick.targetId)
      owned.add(pick.targetId)
      progress = true
      break
    }
  }
  return { solved: neutral.size === 0, steps }
}
