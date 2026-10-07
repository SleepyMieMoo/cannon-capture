import type { Rect, WallDef } from '../types'
import { circleWall, reflect } from './geometry'

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
  /** How long this shot lives in ms; defaults to TUNING.shotLifetimeMs. */
  lifeMs?: number
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

export interface BallisticsOpts {
  radius: number
  maxSpeed: number
  maxBounces: number
  bounds: Rect
  ownerGraceMs: number
}

export interface StepResult {
  ball: Ball
  hitId: string | null
  bounced: boolean
  pushed: boolean
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
): StepResult {
  const dt = Math.max(0, dtMs) / 1000
  const speed = Math.hypot(ball.vx, ball.vy)
  const steps = Math.max(1, Math.min(8, Math.ceil((speed * dt) / 8)))
  const h = dt / steps
  const next: Ball = { ...ball }
  let bounced = false
  let pushed = false
  let hitId: string | null = null

  for (let i = 0; i < steps; i++) {
    for (const fan of fans) {
      if (!insideFan(next, fan)) continue
      pushed = true
      next.vx += Math.cos(fan.angle) * fan.force * h
      next.vy += Math.sin(fan.angle) * fan.force * h
    }
    capSpeed(next, next.maxSpeed ?? opts.maxSpeed)

    next.x += next.vx * h
    next.y += next.vy * h
    next.age += h * 1000

    for (const wall of walls) {
      const hit = circleWall(next.x, next.y, opts.radius, wall)
      if (!hit) continue
      next.x += hit.nx * (hit.pen + 0.75)
      next.y += hit.ny * (hit.pen + 0.75)
      const reflected = reflect(next.vx, next.vy, hit.nx, hit.ny)
      next.vx = reflected.vx
      next.vy = reflected.vy
      next.bounces += 1
      bounced = true
      if (next.bounces > opts.maxBounces) {
        next.alive = false
        return { ball: next, hitId: null, bounced, pushed }
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
        return { ball: next, hitId, bounced, pushed }
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
  }

  return { ball: next, hitId, bounced, pushed }
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
  maxMs = 5000,
  near?: Broadphase,
): TraceResult {
  let ball = start
  let bounced = false
  let pushed = false
  let hitId: string | null = null
  let maxVy = ball.vy

  for (let elapsed = 0; elapsed < maxMs && ball.alive && hitId === null; elapsed += 16) {
    const cell = near?.at(ball.x, ball.y)
    const step = stepBall(ball, 16, cell ? cell.walls : walls, fans, cell ? cell.bodies : bodies, opts)
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
  private readonly cells = new Map<number, { walls: WallDef[]; bodies: Body[] }>()
  private static readonly EMPTY = { walls: [] as WallDef[], bodies: [] as Body[] }
  private readonly size: number

  /** `reach`: the furthest a ball can travel in one step (px). */
  constructor(walls: WallDef[], bodies: Body[], shotRadius: number, reach = 24, cellSize = 128) {
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
  }

  private key(ix: number, iy: number): number {
    return (iy + 1024) * 4096 + (ix + 1024)
  }

  private add(x0: number, y0: number, x1: number, y1: number, put: (c: { walls: WallDef[]; bodies: Body[] }) => void): void {
    const s = this.size
    for (let iy = Math.floor(y0 / s); iy <= Math.floor(y1 / s); iy++) {
      for (let ix = Math.floor(x0 / s); ix <= Math.floor(x1 / s); ix++) {
        const k = this.key(ix, iy)
        let cell = this.cells.get(k)
        if (!cell) this.cells.set(k, (cell = { walls: [], bodies: [] }))
        put(cell)
      }
    }
  }

  at(x: number, y: number): { walls: WallDef[]; bodies: Body[] } {
    return this.cells.get(this.key(Math.floor(x / this.size), Math.floor(y / this.size))) ?? Broadphase.EMPTY
  }
}
