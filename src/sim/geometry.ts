import type { Rect } from '../types'

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

/** First point where the segment enters a wall, or the original end if it does not. */
export function clipToWalls(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  walls: Rect[],
): { x: number; y: number } {
  const dx = x2 - x1
  const dy = y2 - y1
  let best = 1
  for (const wall of walls) {
    const t = segmentEntersAabb(x1, y1, dx, dy, wall)
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
