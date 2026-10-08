import type { Rect, WallDef } from '../types'

export interface CircleHit {
  nx: number
  ny: number
  pen: number
}

/** Circle versus axis-aligned box. Normal points out of the box. */
export function circleAabb(cx: number, cy: number, radius: number, box: Rect): CircleHit | null {
  const closestX = Math.max(box.x, Math.min(cx, box.x + box.w))
  const closestY = Math.max(box.y, Math.min(cy, box.y + box.h))
  const dx = cx - closestX
  const dy = cy - closestY
  const distSq = dx * dx + dy * dy
  if (distSq > radius * radius) return null

  if (distSq === 0) {
    const left = cx - box.x
    const right = box.x + box.w - cx
    const top = cy - box.y
    const bottom = box.y + box.h - cy
    const min = Math.min(left, right, top, bottom)
    if (min === left) return { nx: -1, ny: 0, pen: radius + left }
    if (min === right) return { nx: 1, ny: 0, pen: radius + right }
    if (min === top) return { nx: 0, ny: -1, pen: radius + top }
    return { nx: 0, ny: 1, pen: radius + bottom }
  }

  const dist = Math.sqrt(distSq)
  return { nx: dx / dist, ny: dy / dist, pen: radius - dist }
}

/** Circle versus a wall that may be rotated about its centre. Normal points out of the wall. */
export function circleWall(cx: number, cy: number, radius: number, wall: WallDef): CircleHit | null {
  if (!wall.angle) return circleAabb(cx, cy, radius, wall)
  const mx = wall.x + wall.w / 2
  const my = wall.y + wall.h / 2
  const cos = Math.cos(wall.angle)
  const sin = Math.sin(wall.angle)
  // Into the wall's own frame (rotate by -angle).
  const lx = (cx - mx) * cos + (cy - my) * sin
  const ly = -(cx - mx) * sin + (cy - my) * cos
  const hit = circleAabb(lx, ly, radius, { x: -wall.w / 2, y: -wall.h / 2, w: wall.w, h: wall.h })
  if (!hit) return null
  return { nx: hit.nx * cos - hit.ny * sin, ny: hit.nx * sin + hit.ny * cos, pen: hit.pen }
}

/** Distance from a point to the nearest edge of a (possibly rotated) wall; 0 inside. */
export function distToWall(px: number, py: number, wall: WallDef): number {
  const mx = wall.x + wall.w / 2
  const my = wall.y + wall.h / 2
  const cos = Math.cos(wall.angle ?? 0)
  const sin = Math.sin(wall.angle ?? 0)
  const lx = (px - mx) * cos + (py - my) * sin
  const ly = -(px - mx) * sin + (py - my) * cos
  const dx = Math.max(Math.abs(lx) - wall.w / 2, 0)
  const dy = Math.max(Math.abs(ly) - wall.h / 2, 0)
  return Math.hypot(dx, dy)
}

/** First point where the segment enters a wall, or the original end if it does not. */
export function clipToWalls(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  walls: WallDef[],
): { x: number; y: number } {
  const dx = x2 - x1
  const dy = y2 - y1
  let best = 1
  for (const wall of walls) {
    let t: number | null
    if (!wall.angle) {
      t = segmentEntersAabb(x1, y1, dx, dy, wall)
    } else {
      const mx = wall.x + wall.w / 2
      const my = wall.y + wall.h / 2
      const cos = Math.cos(wall.angle)
      const sin = Math.sin(wall.angle)
      const lx = (x1 - mx) * cos + (y1 - my) * sin
      const ly = -(x1 - mx) * sin + (y1 - my) * cos
      const ldx = dx * cos + dy * sin
      const ldy = -dx * sin + dy * cos
      t = segmentEntersAabb(lx, ly, ldx, ldy, { x: -wall.w / 2, y: -wall.h / 2, w: wall.w, h: wall.h })
    }
    if (t !== null && t < best) best = t
  }
  return { x: x1 + dx * best, y: y1 + dy * best }
}

function segmentEntersAabb(ox: number, oy: number, dx: number, dy: number, box: Rect): number | null {
  let t0 = 0
  let t1 = 1
  const checks: [number, number][] = [
    [-dx, ox - box.x],
    [dx, box.x + box.w - ox],
    [-dy, oy - box.y],
    [dy, box.y + box.h - oy],
  ]
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return null
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return null
      if (r > t0) t0 = r
    } else {
      if (r < t0) return null
      if (r < t1) t1 = r
    }
  }
  if (t0 <= 0 || t0 >= 1 || t0 >= t1) return null
  return t0
}

export function reflect(
  vx: number,
  vy: number,
  nx: number,
  ny: number,
): { vx: number; vy: number } {
  const dot = vx * nx + vy * ny
  if (dot >= 0) return { vx, vy }
  return {
    vx: vx - 2 * dot * nx,
    vy: vy - 2 * dot * ny,
  }
}

type PillarShape = { x: number; y: number; r: number; ry?: number; angle?: number }

/** The furthest any part of a pillar reaches from its centre. */
export function pillarReach(p: PillarShape): number {
  return Math.max(p.r, p.ry ?? p.r)
}

const isOval = (p: PillarShape): boolean => p.ry !== undefined && Math.abs(p.ry - p.r) > 1e-6

/**
 * Closest point on the ellipse x²/a² + y²/b² = 1 to (px, py), for a point
 * inside or outside it (a few fixed-point steps; exact enough for play).
 */
export function closestOnEllipse(px: number, py: number, a: number, b: number): { x: number; y: number } {
  const x = Math.abs(px)
  const y = Math.abs(py)
  let tx = Math.SQRT1_2
  let ty = Math.SQRT1_2
  for (let i = 0; i < 4; i++) {
    const ex = ((a * a - b * b) * tx ** 3) / a
    const ey = ((b * b - a * a) * ty ** 3) / b
    const rx = a * tx - ex
    const ry = b * ty - ey
    const qx = x - ex
    const qy = y - ey
    const r = Math.hypot(rx, ry)
    const q = Math.hypot(qx, qy) || 1e-9
    tx = Math.min(1, Math.max(0, ((qx * r) / q + ex) / a))
    ty = Math.min(1, Math.max(0, ((qy * r) / q + ey) / b))
    const t = Math.hypot(tx, ty) || 1
    tx /= t
    ty /= t
  }
  return { x: Math.sign(px || 1) * a * tx, y: Math.sign(py || 1) * b * ty }
}

/**
 * Circle versus a pillar (round or oval). The normal is the pillar's
 * surface normal at the point the circle touches, pointing out.
 */
export function circlePillar(cx: number, cy: number, radius: number, p: PillarShape): CircleHit | null {
  const dx = cx - p.x
  const dy = cy - p.y
  if (!isOval(p)) {
    const reach = radius + p.r
    const distSq = dx * dx + dy * dy
    if (distSq >= reach * reach) return null
    if (distSq < 1e-9) return { nx: 1, ny: 0, pen: reach }
    const dist = Math.sqrt(distSq)
    return { nx: dx / dist, ny: dy / dist, pen: reach - dist }
  }
  const a = p.r
  const b = p.ry!
  const far = radius + Math.max(a, b)
  if (dx * dx + dy * dy >= far * far) return null
  const cos = Math.cos(p.angle ?? 0)
  const sin = Math.sin(p.angle ?? 0)
  // Into the oval's own frame.
  const lx = dx * cos + dy * sin
  const ly = -dx * sin + dy * cos
  const inside = (lx * lx) / (a * a) + (ly * ly) / (b * b) < 1
  const q = closestOnEllipse(lx, ly, a, b)
  const ox = lx - q.x
  const oy = ly - q.y
  const d = Math.hypot(ox, oy)
  if (!inside && d >= radius) return null
  // The surface normal at the closest point (the gradient), out of the oval.
  let nx = q.x / (a * a)
  let ny = q.y / (b * b)
  const n = Math.hypot(nx, ny) || 1
  nx /= n
  ny /= n
  return { nx: nx * cos - ny * sin, ny: nx * sin + ny * cos, pen: inside ? radius + d : radius - d }
}

export interface GlassHit {
  /** Outward normal of the solid side. */
  nx: number
  ny: number
  /** How far the circle sits past the segment, along the normal. */
  pen: number
  /** True when the circle's centre is on the solid side (it should bounce). */
  solid: boolean
}

/**
 * Circle versus a one-way glass segment. `flip` swaps the solid side.
 * The solid side is the normal's side (left of the segment's direction).
 */
export function circleGlass(
  cx: number,
  cy: number,
  radius: number,
  g: { x: number; y: number; x2: number; y2: number; flip?: boolean },
): GlassHit | null {
  const dx = g.x2 - g.x
  const dy = g.y2 - g.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return null
  const ux = dx / len
  const uy = dy / len
  const nx = g.flip ? uy : -uy
  const ny = g.flip ? -ux : ux
  const relX = cx - g.x
  const relY = cy - g.y
  const along = relX * ux + relY * uy
  if (along < -radius || along > len + radius) return null
  const side = relX * nx + relY * ny
  if (Math.abs(side) >= radius) return null
  return { nx, ny, pen: radius - Math.abs(side), solid: side >= 0 }
}

/** First point where a segment enters a pillar (round or oval), or the original end if it does not. */
export function clipToPillars(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  pillars: readonly PillarShape[],
): { x: number; y: number } {
  let best = 1
  for (const p of pillars) {
    // In the pillar's frame, scaled so it is the unit circle.
    const cos = Math.cos(p.angle ?? 0)
    const sin = Math.sin(p.angle ?? 0)
    const a = p.r
    const b = p.ry ?? p.r
    const loc = (x: number, y: number) => {
      const dx = x - p.x
      const dy = y - p.y
      return { x: (dx * cos + dy * sin) / a, y: (-dx * sin + dy * cos) / b }
    }
    const s0 = loc(x1, y1)
    const s1 = loc(x2, y2)
    const dx = s1.x - s0.x
    const dy = s1.y - s0.y
    const qa = dx * dx + dy * dy
    if (qa < 1e-12) continue
    const qb = 2 * (s0.x * dx + s0.y * dy)
    const qc = s0.x * s0.x + s0.y * s0.y - 1
    const disc = qb * qb - 4 * qa * qc
    if (disc < 0) continue
    const t = (-qb - Math.sqrt(disc)) / (2 * qa)
    if (t > 0 && t < best) best = t
  }
  return { x: x1 + (x2 - x1) * best, y: y1 + (y2 - y1) * best }
}

/** First point where a segment hits the solid side of a glass pane, or the original end. */
export function clipToGlass(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  panes: readonly { x: number; y: number; x2: number; y2: number; flip?: boolean }[],
): { x: number; y: number } {
  const dx = x2 - x1
  const dy = y2 - y1
  let best = 1
  for (const g of panes) {
    const gx = g.x2 - g.x
    const gy = g.y2 - g.y
    const len = Math.hypot(gx, gy)
    if (len < 1e-6) continue
    const nx = g.flip ? gy / len : -gy / len
    const ny = g.flip ? -gx / len : gx / len
    // Only a segment coming from the solid side is stopped.
    const from = (x1 - g.x) * nx + (y1 - g.y) * ny
    if (from <= 1e-6) continue
    const denom = dx * nx + dy * ny
    if (denom >= -1e-9) continue
    const t = -from / denom
    if (t <= 0 || t >= best) continue
    const px = x1 + dx * t - g.x
    const py = y1 + dy * t - g.y
    const along = (px * gx + py * gy) / len
    if (along < 0 || along > len) continue
    best = t
  }
  return { x: x1 + dx * best, y: y1 + dy * best }
}
