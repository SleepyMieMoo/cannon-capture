import { TUNING } from '../config/tuning'
import { boardFor } from '../levels/board'
import { FIRING_KINDS, laneKey, maxShotSpeedFor, shotRangeFor, shotSpeedFor } from '../config/kinds'
import type { CannonKind, LevelDef } from '../types'
import { Broadphase, aimShot, stepBall, type BallisticsOpts, type Body, type FanField } from './ballistics'

/**
 * Lane finder: fires a test shot from a cannon at every angle (1° apart) and
 * records which cannon it hits. Cannons never move and shots meet nothing
 * but walls (void walls swallow them), pillars, glass, fans and cannons, so
 * a level's lanes can be computed once. Banks off pillars and glass count as
 * trick shots like wall banks.
 * Used by the enemy AI, the level-solvability tests and the debug bot.
 */

/** Shot physics settings for a level (its board size sets the bounds). */
export function shotOpts(level: Pick<LevelDef, 'size'>): BallisticsOpts {
  return {
    radius: TUNING.shotRadius,
    maxSpeed: TUNING.shotSpeed * TUNING.shotSpeedCap,
    maxBounces: TUNING.maxBounces,
    range: shotRangeFor('normal'),
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
  /**
   * Trick shots on the lane's middle angle: wall bounces plus one if a fan
   * pushes it (0 for a straight line). Aiming straight (direct) needs none.
   */
  tricks?: number
  /**
   * Where a shot down the middle of the lane flies, as a polyline
   * [x0, y0, x1, y1, ...]: the muzzle, each bounce, points along fan curves,
   * and where it hits. The AI checks it against enemy barriers.
   */
  path?: number[]
  /** Other, narrower runs of angles to the same target (best first), to get round a barrier. */
  alts?: Lane[]
}

/** Most extra lanes kept per target (see Lane.alts). */
export const MAX_ALTS = 2

/** Trick shots needed to use this lane as the AI would aim it (0 when it can aim straight). */
export function laneTricks(lane: Lane): number {
  return lane.direct ? 0 : (lane.tricks ?? 0)
}

/**
 * laneKey(cannonId, kind) -> targetId -> best lane. Normal lanes use the bare
 * cannon id; other tower types have their own entry (shots fly differently).
 */
export type LaneTable = Map<string, Map<string, Lane>>

/** The lanes for a cannon as it is fitted right now. */
export function lanesOf(table: LaneTable, cannon: { id: string; kind?: CannonKind }): Map<string, Lane> | undefined {
  return table.get(laneKey(cannon.id, cannon.kind ?? 'normal'))
}

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
    near: new Broadphase(level.walls, bodies, TUNING.shotRadius, 24, 128, level.pillars ?? [], level.glass ?? []),
  }
}

function traceWith(ctx: TraceCtx, fromId: string, angle: number, kind: CannonKind = 'normal'): string | null {
  return traceFull(ctx, fromId, angle, kind)?.hitId ?? null
}

interface FullTrace {
  hitId: string | null
  bounces: number
  pushed: boolean
  path: number[]
}

/**
 * Fly a test shot (same steps as traceShot). With `withPath`, also record
 * its route: the muzzle, each bounce, a point every ~24 px while a fan
 * bends it, and the end.
 */
function traceFull(ctx: TraceCtx, fromId: string, angle: number, kind: CannonKind = 'normal', withPath = false): FullTrace | null {
  const from = ctx.level.cannons.find((c) => c.id === fromId)
  if (!from) return null
  let ball = aimShot(
    from,
    { x: from.x + Math.cos(angle) * 100, y: from.y + Math.sin(angle) * 100 },
    TUNING.cannonRadius + 12,
    shotSpeedFor(kind),
    fromId,
  )
  if (kind !== 'normal') ball.maxSpeed = maxShotSpeedFor(kind)
  ball.range = shotRangeFor(kind)
  const path = withPath ? [Math.round(ball.x), Math.round(ball.y)] : []
  // Range (path length) ends the flight, as in play; the time limit is only a safety net.
  const maxMs = TUNING.shotMaxFlightMs
  let pushed = false
  let hitId: string | null = null
  for (let elapsed = 0; elapsed < maxMs && ball.alive && hitId === null; elapsed += 16) {
    const cell = ctx.near.at(ball.x, ball.y)
    const step = stepBall(ball, 16, cell.walls, ctx.fans, cell.bodies, ctx.opts, undefined, cell.pillars, cell.glass)
    ball = step.ball
    if (step.pushed) pushed = true
    if (step.hitId) hitId = step.hitId
    if (withPath && (step.bounced || step.pushed)) {
      const n = path.length
      if (step.bounced || Math.hypot(ball.x - path[n - 2], ball.y - path[n - 1]) >= 24) path.push(Math.round(ball.x), Math.round(ball.y))
    }
  }
  if (withPath) path.push(Math.round(ball.x), Math.round(ball.y))
  return { hitId, bounces: ball.bounces, pushed, path }
}

export function traceAngle(level: LevelDef, fromId: string, angle: number, kind: CannonKind = 'normal'): string | null {
  return traceWith(traceCtx(level), fromId, angle, kind)
}

export function sweep(level: LevelDef, fromId: string, stepDeg = 1, kind: CannonKind = 'normal'): (string | null)[] {
  const ctx = traceCtx(level)
  const out: (string | null)[] = []
  for (let deg = 0; deg < 360; deg += stepDeg) out.push(traceWith(ctx, fromId, (deg * Math.PI) / 180, kind))
  return out
}

type Run = { angle: number; widthDeg: number }

/** Every contiguous run of angles per target, widest first (wrapping round 360°). */
export function runsFromSweep(hits: (string | null)[], stepDeg = 1): Map<string, Run[]> {
  const n = hits.length
  const runs = new Map<string, Run[]>()
  if (n === 0) return runs
  // Start scanning at a boundary so wrapped runs are seen whole.
  let start = 0
  while (start < n && hits[start] === hits[(start - 1 + n) % n]) start++
  if (start === n) {
    const id = hits[0]
    if (id) runs.set(id, [{ angle: Math.PI, widthDeg: 360 }])
    return runs
  }
  let i = 0
  while (i < n) {
    const id = hits[(start + i) % n]
    let len = 1
    while (i + len < n && hits[(start + i + len) % n] === id) len++
    if (id) {
      const mid = ((start + i + (len - 1) / 2) % n) * stepDeg
      const list = runs.get(id) ?? []
      list.push({ angle: (mid * Math.PI) / 180, widthDeg: len * stepDeg })
      runs.set(id, list)
    }
    i += len
  }
  // Widest first; ties keep scan order (the earlier run wins, as before).
  for (const list of runs.values()) list.sort((a, b) => b.widthDeg - a.widthDeg)
  return runs
}

/** Widest contiguous run of angles per target (wrapping round 360°). */
export function lanesFromSweep(hits: (string | null)[], stepDeg = 1): Map<string, Run> {
  const best = new Map<string, Run>()
  for (const [id, list] of runsFromSweep(hits, stepDeg)) best.set(id, list[0])
  return best
}

function lanesFor(ctx: TraceCtx, fromId: string, hits: (string | null)[], stepDeg: number, kind: CannonKind): Map<string, Lane> {
  const from = ctx.level.cannons.find((c) => c.id === fromId)!
  const lanes = new Map<string, Lane>()
  const laneOf = (targetId: string, run: Run, direct: boolean): Lane => {
    const mid = traceFull(ctx, fromId, run.angle, kind, true)
    const tricks = (mid?.bounces ?? 0) + (mid?.pushed ? 1 : 0)
    return { targetId, ...run, direct, tricks, path: mid?.path }
  }
  for (const [targetId, runs] of runsFromSweep(hits, stepDeg)) {
    if (targetId === fromId) continue
    const target = ctx.level.cannons.find((c) => c.id === targetId)!
    const directAngle = Math.atan2(target.y - from.y, target.x - from.x)
    const lane = laneOf(targetId, runs[0], traceWith(ctx, fromId, directAngle, kind) === targetId)
    const alts = runs
      .slice(1)
      .filter((r) => r.widthDeg >= MIN_LANE_DEG)
      .slice(0, MAX_ALTS)
      .map((r) => laneOf(targetId, r, false))
    // Aiming straight works, but the widest run lies elsewhere (a bank shot,
    // say): keep that run as a way round a barrier across the straight line.
    const off = Math.abs(Math.atan2(Math.sin(directAngle - lane.angle), Math.cos(directAngle - lane.angle))) * (180 / Math.PI)
    if (lane.direct && off > lane.widthDeg / 2 + stepDeg && lane.widthDeg >= MIN_LANE_DEG) {
      alts.unshift({ ...lane, direct: false })
      alts.length = Math.min(alts.length, MAX_ALTS)
    }
    if (alts.length) lane.alts = alts
    lanes.set(targetId, lane)
  }
  return lanes
}

interface LaneJob {
  id: string
  kind: CannonKind
}

/**
 * Builds a level's lane table a slice at a time so big maps with many
 * cannons never stall a frame. Every cannon gets lanes for its starting type
 * first (enemy cannons first, since the AI needs them, then neutrals, then
 * yours), then lanes for the other tower types it could be swapped to. Until
 * a cannon's lanes exist, the AI simply aims straight at its target.
 */
export class LaneBuilder {
  readonly table: LaneTable = new Map()
  private readonly ctx: TraceCtx
  private readonly queue: LaneJob[]
  private current: LaneJob | null = null
  private hits: (string | null)[] = []
  private readonly stepDeg: number

  constructor(level: LevelDef, stepDeg?: number) {
    this.ctx = traceCtx(level)
    // Many cannons: a coarser sweep keeps the total cost in check.
    this.stepDeg = stepDeg ?? (level.cannons.length > 24 ? 2 : 1)
    const rank = { enemy: 0, neutral: 1, player: 2 } as const
    const order = [...level.cannons].sort((a, b) => rank[a.side] - rank[b.side])
    const first = order.map((c) => ({ id: c.id, kind: c.kind ?? 'normal' }))
    const rest = FIRING_KINDS.flatMap((kind) => order.filter((c) => (c.kind ?? 'normal') !== kind).map((c) => ({ id: c.id, kind })))
    // Shields don't shoot: no lanes for them.
    this.queue = [...first, ...rest].filter((job) => FIRING_KINDS.includes(job.kind))
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
        this.hits.push(traceWith(this.ctx, this.current.id, (deg * Math.PI) / 180, this.current.kind))
      } else {
        const { id, kind } = this.current
        this.table.set(laneKey(id, kind), lanesFor(this.ctx, id, this.hits, this.stepDeg, kind))
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

export interface PuzzleStep {
  from: string
  to: string
  lane: Lane
  /** Tower type `from` must be (swapping is free in puzzles). */
  kind: CannonKind
}

export interface PuzzlePlan {
  solved: boolean
  /** Aim orders in capture order. */
  steps: PuzzleStep[]
}

/**
 * Greedy puzzle check: repeatedly let any player cannon that is not yet busy
 * aim at an uncaptured neutral it has a lane to. Each aim captures one neutral
 * (the shot then stops on the now-friendly cannon), so a plan uses one aim per
 * neutral. A cannon keeps its current type when that has a lane, otherwise it
 * swaps (free) to a type that does.
 */
export function planPuzzle(level: LevelDef, lanes: LaneTable = levelLanes(level)): PuzzlePlan {
  const kinds = new Map(level.cannons.map((c) => [c.id, (c.kind ?? 'normal') as CannonKind]))
  const owned = new Set(level.cannons.filter((c) => c.side === 'player').map((c) => c.id))
  const neutral = new Set(level.cannons.filter((c) => c.side === 'neutral').map((c) => c.id))
  const steps: PuzzleStep[] = []
  const widest = (from: string, kind: CannonKind): Lane | null => {
    let pick: Lane | null = null
    for (const lane of lanes.get(laneKey(from, kind))?.values() ?? []) {
      if (!neutral.has(lane.targetId) || lane.widthDeg < MIN_LANE_DEG) continue
      if (!pick || lane.widthDeg > pick.widthDeg) pick = lane
    }
    return pick
  }
  let progress = true
  while (neutral.size && progress) {
    progress = false
    for (const from of owned) {
      const current = kinds.get(from)!
      let kind = current
      let pick = widest(from, current)
      for (const other of FIRING_KINDS) {
        if (pick) break
        if (other === current) continue
        pick = widest(from, other)
        kind = other
      }
      if (!pick) continue
      steps.push({ from, to: pick.targetId, lane: pick, kind })
      kinds.set(from, kind)
      neutral.delete(pick.targetId)
      owned.add(pick.targetId)
      progress = true
      break
    }
  }
  return { solved: neutral.size === 0, steps }
}
