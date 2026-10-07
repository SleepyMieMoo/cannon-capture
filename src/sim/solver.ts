import { TUNING } from '../config/tuning'
import { boardFor } from '../levels/board'
import type { LevelDef } from '../types'
import { Broadphase, aimShot, traceShot, type BallisticsOpts, type Body, type FanField } from './ballistics'

/**
 * Lane finder: fires a test shot from a cannon at every angle (1° apart) and
 * records which cannon it hits. Cannons never move and shots pass through
 * nothing but walls and cannons, so a level's lanes can be computed once.
 * Used by the enemy AI, the level-solvability tests and the debug bot.
 */

/** Shot physics settings for a level (its board size sets the bounds). */
export function shotOpts(level: Pick<LevelDef, 'size'>): BallisticsOpts {
  return {
    radius: TUNING.shotRadius,
    maxSpeed: TUNING.shotSpeed * TUNING.shotSpeedCap,
    maxBounces: TUNING.maxBounces,
    bounds: boardFor(level),
    ownerGraceMs: TUNING.ownerGraceMs,
  }
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

interface TraceCtx {
  level: LevelDef
  fans: FanField[]
  bodies: Body[]
  opts: BallisticsOpts
  near: Broadphase
}

function traceCtx(level: LevelDef): TraceCtx {
  const bodies = levelBodies(level)
  return {
    level,
    fans: levelFans(level),
    bodies,
    opts: shotOpts(level),
    near: new Broadphase(level.walls, bodies, TUNING.shotRadius),
  }
}

function traceWith(ctx: TraceCtx, fromId: string, angle: number): string | null {
  const from = ctx.level.cannons.find((c) => c.id === fromId)
  if (!from) return null
  const shot = aimShot(
    from,
    { x: from.x + Math.cos(angle) * 100, y: from.y + Math.sin(angle) * 100 },
    TUNING.cannonRadius + 12,
    TUNING.shotSpeed,
    fromId,
  )
  return traceShot(shot, ctx.level.walls, ctx.fans, ctx.bodies, ctx.opts, TUNING.shotLifetimeMs, ctx.near).hitId
}

export function traceAngle(level: LevelDef, fromId: string, angle: number): string | null {
  return traceWith(traceCtx(level), fromId, angle)
}

export function sweep(level: LevelDef, fromId: string, stepDeg = 1): (string | null)[] {
  const ctx = traceCtx(level)
  const out: (string | null)[] = []
  for (let deg = 0; deg < 360; deg += stepDeg) out.push(traceWith(ctx, fromId, (deg * Math.PI) / 180))
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

function lanesFor(ctx: TraceCtx, fromId: string, hits: (string | null)[], stepDeg: number): Map<string, Lane> {
  const from = ctx.level.cannons.find((c) => c.id === fromId)!
  const lanes = new Map<string, Lane>()
  for (const [targetId, lane] of lanesFromSweep(hits, stepDeg)) {
    if (targetId === fromId) continue
    const target = ctx.level.cannons.find((c) => c.id === targetId)!
    const directAngle = Math.atan2(target.y - from.y, target.x - from.x)
    lanes.set(targetId, { targetId, ...lane, direct: traceWith(ctx, fromId, directAngle) === targetId })
  }
  return lanes
}

/**
 * Builds a level's lane table a slice at a time so big maps with many
 * cannons never stall a frame. Enemy cannons go first (the AI needs them),
 * then neutrals, then yours. Until a cannon's lanes exist, the AI simply
 * aims straight at its target.
 */
export class LaneBuilder {
  readonly table: LaneTable = new Map()
  private readonly ctx: TraceCtx
  private readonly queue: string[]
  private current: string | null = null
  private hits: (string | null)[] = []
  private readonly stepDeg: number

  constructor(level: LevelDef, stepDeg?: number) {
    this.ctx = traceCtx(level)
    // Many cannons: a coarser sweep keeps the total cost in check.
    this.stepDeg = stepDeg ?? (level.cannons.length > 24 ? 2 : 1)
    const rank = { enemy: 0, neutral: 1, player: 2 } as const
    this.queue = [...level.cannons].sort((a, b) => rank[a.side] - rank[b.side]).map((c) => c.id)
  }

  get done(): boolean {
    return this.current === null && this.queue.length === 0
  }

  /** Work for up to `budgetMs`. Returns true when everything is built. */
  pump(budgetMs: number): boolean {
    const start = now()
    while (!this.done) {
      if (this.current === null) {
        this.current = this.queue.shift() ?? null
        this.hits = []
        if (this.current === null) break
      }
      const deg = this.hits.length * this.stepDeg
      if (deg < 360) {
        this.hits.push(traceWith(this.ctx, this.current, (deg * Math.PI) / 180))
      } else {
        this.table.set(this.current, lanesFor(this.ctx, this.current, this.hits, this.stepDeg))
        this.current = null
      }
      if (now() - start >= budgetMs) break
    }
    return this.done
  }

  runAll(): LaneTable {
    this.pump(Infinity)
    return this.table
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function levelLanes(level: LevelDef, stepDeg = 1): LaneTable {
  return new LaneBuilder(level, stepDeg).runAll()
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
