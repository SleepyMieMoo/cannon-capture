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
