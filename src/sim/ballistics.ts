import type { Rect } from '../types'
import { circleAabb, reflect } from './geometry'

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  bounces: number
  alive: boolean
  ownerId: string
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
  walls: Rect[],
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
    capSpeed(next, opts.maxSpeed)

    next.x += next.vx * h
    next.y += next.vy * h
    next.age += h * 1000

    for (const wall of walls) {
      const hit = circleAabb(next.x, next.y, opts.radius, wall)
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
  walls: Rect[],
  fans: FanField[],
  bodies: Body[],
  opts: BallisticsOpts,
  maxMs = 5000,
): TraceResult {
  let ball = start
  let bounced = false
  let pushed = false
  let hitId: string | null = null
  let maxVy = ball.vy

  for (let elapsed = 0; elapsed < maxMs && ball.alive && hitId === null; elapsed += 16) {
    const step = stepBall(ball, 16, walls, fans, bodies, opts)
    ball = step.ball
    if (step.bounced) bounced = true
    if (step.pushed) pushed = true
    if (ball.vy > maxVy) maxVy = ball.vy
    if (step.hitId) hitId = step.hitId
  }

  return { hitId, bounced, pushed, maxVy, end: ball }
}
