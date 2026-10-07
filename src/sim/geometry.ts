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
