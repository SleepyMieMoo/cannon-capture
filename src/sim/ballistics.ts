import { TUNING } from '../config/tuning'
import type { GlassDef, PillarDef, Rect, WallDef } from '../types'
import { circleGlass, circlePillar, circleWall, reflect } from './geometry'

/** What a shot can bounce off (or be swallowed by). */
export type Surface = 'wall' | 'pillar' | 'glass'

/** How far a normal shot flies (px, path length including bounces): shotSpeed for shotLifetimeMs. */
export const DEFAULT_RANGE = (TUNING.shotSpeed * TUNING.shotLifetimeMs) / 1000

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  bounces: number
  alive: boolean
  ownerId: string
  /** Fan boost cap for this shot (snipers fly faster); defaults to opts.maxSpeed. */
  maxSpeed?: number
  /**
   * How far this shot flies in px before it fades, counted along its path
   * (bounces cost nothing extra; fans that slow it don't shorten it).
   * Defaults to opts.range, then DEFAULT_RANGE.
   */
  range?: number
  /** Path length flown so far (px). */
  travelled?: number
}

export interface FanField {
  x: number
  y: number
  radius: number
  angle: number
  force: number
}

export interface Body {
  id: string
  x: number
  y: number
  radius: number
}

/**
 * A shield's barrier: an arc of radius `r` round (x, y), `half` radians
 * either side of `facing`. A shot touching it (within `band` px of the arc,
 * `pad` radians past its ends) is absorbed.
 */
export interface Barrier {
  id: string
  x: number
  y: number
  r: number
  facing: number
  half: number
  band: number
  pad: number
}

/** True when a ball centred at (x, y) touches the barrier. */
export function touchesBarrier(x: number, y: number, b: Barrier): boolean {
  const dx = x - b.x
  const dy = y - b.y
  const d2 = dx * dx + dy * dy
  const lo = b.r - b.band
  const hi = b.r + b.band
  if (d2 < lo * lo || d2 > hi * hi) return false
  let diff = Math.atan2(dy, dx) - b.facing
  diff = Math.atan2(Math.sin(diff), Math.cos(diff))
  return Math.abs(diff) <= b.half + b.pad
}

/**
 * True when a polyline [x0, y0, x1, y1, ...] crosses the barrier's arc
 * (treated as its centre line, padded by `pad` at the ends).
 */
export function pathCrossesBarrier(path: readonly number[], b: Barrier): boolean {
  for (let i = 0; i + 3 < path.length; i += 2) {
    const x0 = path[i]
    const y0 = path[i + 1]
    const dx = path[i + 2] - x0
    const dy = path[i + 3] - y0
    const fx = x0 - b.x
    const fy = y0 - b.y
    const a = dx * dx + dy * dy
    if (a < 1e-9) continue
    const bb = 2 * (fx * dx + fy * dy)
    const c = fx * fx + fy * fy - b.r * b.r
    const disc = bb * bb - 4 * a * c
    if (disc < 0) continue
    const sq = Math.sqrt(disc)
    for (const t of [(-bb - sq) / (2 * a), (-bb + sq) / (2 * a)]) {
      if (t < 0 || t > 1) continue
      let diff = Math.atan2(fy + dy * t, fx + dx * t) - b.facing
      diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      if (Math.abs(diff) <= b.half + b.pad) return true
    }
  }
  return false
}

export interface BallisticsOpts {
  radius: number
  maxSpeed: number
  /** Safety cap on wall bounces (see TUNING.maxBounces); range is what normally ends a shot. */
  maxBounces: number
  /** Range for shots that don't carry their own (px); defaults to DEFAULT_RANGE. */
  range?: number
  bounds: Rect
  ownerGraceMs: number
}

export interface StepResult {
  ball: Ball
  hitId: string | null
  bounced: boolean
  pushed: boolean
  /** The shield whose barrier absorbed the shot, if one did. */
  blockedBy?: string
  /** A void wall swallowed the shot. */
  absorbed?: boolean
  /** What it banked off last this step, when it bounced. */
  surface?: Surface
}

export function aimShot(
  from: { x: number; y: number },
  to: { x: number; y: number },
  muzzle: number,
  speed: number,
  ownerId: string,
): Ball {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  return {
    x: from.x + (dx / len) * muzzle,
    y: from.y + (dy / len) * muzzle,
    vx: (dx / len) * speed,
    vy: (dy / len) * speed,
    age: 0,
    bounces: 0,
    alive: true,
    ownerId,
    travelled: 0,
  }
}

export function aimAngle(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.atan2(to.y - from.y, to.x - from.x)
}

function capSpeed(ball: Ball, maxSpeed: number): void {
  const speed = Math.hypot(ball.vx, ball.vy)
  if (speed > maxSpeed && speed > 0) {
    ball.vx = (ball.vx / speed) * maxSpeed
    ball.vy = (ball.vy / speed) * maxSpeed
  }
}

function insideFan(ball: Ball, fan: FanField): boolean {
  const dx = ball.x - fan.x
  const dy = ball.y - fan.y
  return dx * dx + dy * dy <= fan.radius * fan.radius
}

/** Advance one frame. Does not mutate `ball`. */
export function stepBall(
  ball: Ball,
  dtMs: number,
  walls: WallDef[],
  fans: FanField[],
  bodies: Body[],
  opts: BallisticsOpts,
  barriers?: Barrier[],
  pillars?: readonly PillarDef[],
  glass?: readonly GlassDef[],
): StepResult {
  const dt = Math.max(0, dtMs) / 1000
  const speed = Math.hypot(ball.vx, ball.vy)
  const steps = Math.max(1, Math.min(8, Math.ceil((speed * dt) / 8)))
  const h = dt / steps
  const next: Ball = { ...ball }
  let bounced = false
  let pushed = false
  let hitId: string | null = null
  let surface: Surface | undefined
  const range = next.range ?? opts.range ?? DEFAULT_RANGE
  let travelled = next.travelled ?? 0

  for (let i = 0; i < steps; i++) {
    for (const fan of fans) {
      if (!insideFan(next, fan)) continue
      pushed = true
      next.vx += Math.cos(fan.angle) * fan.force * h
      next.vy += Math.sin(fan.angle) * fan.force * h
    }
    capSpeed(next, next.maxSpeed ?? opts.maxSpeed)

    // Range is path length: the last sub-step only goes as far as the range left.
    const move = Math.hypot(next.vx, next.vy) * h
    const left = range - travelled
    const k = move > left ? Math.max(0, left) / move : 1
    next.x += next.vx * h * k
    next.y += next.vy * h * k
    next.age += h * 1000 * k
    travelled += move * k
    next.travelled = travelled

    // Several surfaces touched in one sub-step (a corner) count as one bounce.
    let banked = false
    for (const wall of walls) {
      const hit = circleWall(next.x, next.y, opts.radius, wall)
      if (!hit) continue
      if (wall.kind === 'void') {
        // A void wall swallows the shot where it touches.
        next.alive = false
        return { ball: next, hitId: null, bounced, pushed, absorbed: true }
      }
      bank(next, hit.nx, hit.ny, hit.pen)
      banked = true
      surface = 'wall'
    }
    if (pillars) {
      for (const p of pillars) {
        // A true circle: the shot reflects off the surface normal where it hits.
        const hit = circlePillar(next.x, next.y, opts.radius, p)
        if (!hit) continue
        bank(next, hit.nx, hit.ny, hit.pen)
        banked = true
        surface = 'pillar'
      }
    }
    if (glass) {
      for (const g of glass) {
        const hit = circleGlass(next.x, next.y, opts.radius, g)
        // Through from the open side; a bounce only off the solid side, heading into it.
        if (!hit || !hit.solid || next.vx * hit.nx + next.vy * hit.ny >= 0) continue
        bank(next, hit.nx, hit.ny, hit.pen)
        banked = true
        surface = 'glass'
      }
    }
    if (banked) {
      next.bounces += 1
      bounced = true
      if (next.bounces > opts.maxBounces) {
        next.alive = false
        return { ball: next, hitId: null, bounced, pushed, surface }
      }
    }

    if (barriers) {
      for (const b of barriers) {
        if (!touchesBarrier(next.x, next.y, b)) continue
        next.alive = false
        return { ball: next, hitId: null, bounced, pushed, blockedBy: b.id }
      }
    }

    for (const body of bodies) {
      if (body.id === next.ownerId && next.age < opts.ownerGraceMs) continue
      const dx = next.x - body.x
      const dy = next.y - body.y
      const reach = opts.radius + body.radius
      if (dx * dx + dy * dy <= reach * reach) {
        next.alive = false
        hitId = body.id
        return { ball: next, hitId, bounced, pushed, surface }
      }
    }

    const { bounds } = opts
    if (
      next.x < bounds.x ||
      next.y < bounds.y ||
      next.x > bounds.x + bounds.w ||
      next.y > bounds.y + bounds.h
    ) {
      next.alive = false
      return { ball: next, hitId: null, bounced, pushed }
    }

    // Out of range (or, as a safety net, flying absurdly long, e.g. held up by fans).
    if (travelled >= range - 1e-6 || next.age > TUNING.shotMaxFlightMs) {
      next.alive = false
      return { ball: next, hitId: null, bounced, pushed }
    }
  }

  return { ball: next, hitId, bounced, pushed, surface }
}

/** Push the ball out along the normal and reflect it. */
function bank(ball: Ball, nx: number, ny: number, pen: number): void {
  ball.x += nx * (pen + 0.75)
  ball.y += ny * (pen + 0.75)
  const r = reflect(ball.vx, ball.vy, nx, ny)
  ball.vx = r.vx
  ball.vy = r.vy
}

export interface TraceResult {
  hitId: string | null
  bounced: boolean
  pushed: boolean
  maxVy: number
  end: Ball
}

export function traceShot(
  start: Ball,
  walls: WallDef[],
  fans: FanField[],
  bodies: Body[],
  opts: BallisticsOpts,
  maxMs: number = TUNING.shotMaxFlightMs,
  near?: Broadphase,
  extra?: { pillars?: readonly PillarDef[]; glass?: readonly GlassDef[] },
): TraceResult {
  let ball = start
  let bounced = false
  let pushed = false
  let hitId: string | null = null
  let maxVy = ball.vy

  for (let elapsed = 0; elapsed < maxMs && ball.alive && hitId === null; elapsed += 16) {
    const cell = near?.at(ball.x, ball.y)
    const step = cell
      ? stepBall(ball, 16, cell.walls, fans, cell.bodies, opts, undefined, cell.pillars, cell.glass)
      : stepBall(ball, 16, walls, fans, bodies, opts, undefined, extra?.pillars, extra?.glass)
    ball = step.ball
    if (step.bounced) bounced = true
    if (step.pushed) pushed = true
    if (ball.vy > maxVy) maxVy = ball.vy
    if (step.hitId) hitId = step.hitId
  }

  return { hitId, bounced, pushed, maxVy, end: ball }
}

/**
 * Uniform grid over walls and cannons, so a traced shot only tests what is
 * near it. A ball moves under 10px per 16ms step, so each cell lists anything
 * within a safe margin of it and the result is identical to testing everything.
 */
export class Broadphase {
  private readonly cells = new Map<number, Cell>()
  private static readonly EMPTY: Cell = { walls: [], bodies: [], pillars: [], glass: [] }
  private readonly size: number

  /** `reach`: the furthest a ball can travel in one step (px). */
  constructor(
    walls: WallDef[],
    bodies: Body[],
    shotRadius: number,
    reach = 24,
    cellSize = 128,
    pillars: readonly PillarDef[] = [],
    glass: readonly GlassDef[] = [],
  ) {
    this.size = cellSize
    const margin = shotRadius + reach
    for (const wall of walls) {
      const cos = Math.abs(Math.cos(wall.angle ?? 0))
      const sin = Math.abs(Math.sin(wall.angle ?? 0))
      const hx = (wall.w / 2) * cos + (wall.h / 2) * sin
      const hy = (wall.w / 2) * sin + (wall.h / 2) * cos
      const cx = wall.x + wall.w / 2
      const cy = wall.y + wall.h / 2
      this.add(cx - hx - margin, cy - hy - margin, cx + hx + margin, cy + hy + margin, (c) => c.walls.push(wall))
    }
    for (const body of bodies) {
      const r = body.radius + margin
      this.add(body.x - r, body.y - r, body.x + r, body.y + r, (c) => c.bodies.push(body))
    }
    for (const p of pillars) {
      const r = p.r + margin
      this.add(p.x - r, p.y - r, p.x + r, p.y + r, (c) => c.pillars.push(p))
    }
    for (const g of glass) {
      this.add(Math.min(g.x, g.x2) - margin, Math.min(g.y, g.y2) - margin, Math.max(g.x, g.x2) + margin, Math.max(g.y, g.y2) + margin, (c) => c.glass.push(g))
    }
  }

  private key(ix: number, iy: number): number {
    return (iy + 1024) * 4096 + (ix + 1024)
  }

  private add(x0: number, y0: number, x1: number, y1: number, put: (c: Cell) => void): void {
    const s = this.size
    for (let iy = Math.floor(y0 / s); iy <= Math.floor(y1 / s); iy++) {
      for (let ix = Math.floor(x0 / s); ix <= Math.floor(x1 / s); ix++) {
        const k = this.key(ix, iy)
        let cell = this.cells.get(k)
        if (!cell) this.cells.set(k, (cell = { walls: [], bodies: [], pillars: [], glass: [] }))
        put(cell)
      }
    }
  }

  at(x: number, y: number): Cell {
    return this.cells.get(this.key(Math.floor(x / this.size), Math.floor(y / this.size))) ?? Broadphase.EMPTY
  }
}

/** What is near one grid cell. */
export interface Cell {
  walls: WallDef[]
  bodies: Body[]
  pillars: PillarDef[]
  glass: GlassDef[]
}
