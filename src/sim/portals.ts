import { PORTAL } from '../config/obstacles'
import type { PortalDef } from '../types'

/** A portal mouth, ready for the physics: where it is and where it leads. */
export interface PortalMouth {
  x: number
  y: number
  angle: number
  /** Index into level.portals. */
  pair: number
  /** Index (into the mouths list) of the mouth it leads to. */
  to: number
  /** The turn from this mouth to the other (other angle − this angle) as cos/sin. */
  cos: number
  sin: number
}

/** Both mouths of each pair, in order [pair 0 a, pair 0 b, pair 1 a, ...]. */
export function portalMouths(portals: readonly PortalDef[] | undefined): PortalMouth[] {
  const out: PortalMouth[] = []
  ;(portals ?? []).slice(0, PORTAL.maxPairs).forEach((p, pair) => {
    const turn = p.b.angle - p.a.angle
    const i = out.length
    out.push({ x: p.a.x, y: p.a.y, angle: p.a.angle, pair, to: i + 1, cos: Math.cos(turn), sin: Math.sin(turn) })
    out.push({ x: p.b.x, y: p.b.y, angle: p.b.angle, pair, to: i, cos: Math.cos(-turn), sin: Math.sin(-turn) })
  })
  return out
}

/**
 * Where a shot at (x, y) heading (vx, vy) comes out after falling into
 * `from`: the heading turned by the mouths' angle difference (speed kept),
 * and the same offset from the exit's centre, turned the same way, but on
 * the side it is heading for (so it flies straight out, never back in).
 */
export function portalExit(from: PortalMouth, to: PortalMouth, x: number, y: number, vx: number, vy: number): { x: number; y: number; vx: number; vy: number } {
  const c = from.cos
  const s = from.sin
  const nvx = vx * c - vy * s
  const nvy = vx * s + vy * c
  const dx = x - from.x
  const dy = y - from.y
  let ox = dx * c - dy * s
  let oy = dx * s + dy * c
  const speed = Math.hypot(nvx, nvy)
  if (speed > 1e-9) {
    const ux = nvx / speed
    const uy = nvy / speed
    const along = ox * ux + oy * uy
    if (along < 0) {
      ox -= 2 * along * ux
      oy -= 2 * along * uy
    }
  }
  return { x: to.x + ox, y: to.y + oy, vx: nvx, vy: nvy }
}

/** The mouth a shot at (x, y) falls into, or -1. `skip`: the mouth it is leaving. */
export function mouthAt(mouths: readonly PortalMouth[], x: number, y: number, skip = -1): number {
  const r2 = PORTAL.trigger * PORTAL.trigger
  for (let i = 0; i < mouths.length; i++) {
    if (i === skip) continue
    const dx = x - mouths[i].x
    const dy = y - mouths[i].y
    if (dx * dx + dy * dy <= r2) return i
  }
  return -1
}

/**
 * The first mouth a straight path from (x1, y1) to (x2, y2) falls into, and
 * where (aim previews): `t` is the share of the way along. Mouths the start
 * already sits in are skipped.
 */
export function mouthOnSegment(mouths: readonly PortalMouth[], x1: number, y1: number, x2: number, y2: number): { k: number; t: number; x: number; y: number } | null {
  const dx = x2 - x1
  const dy = y2 - y1
  const a = dx * dx + dy * dy
  if (a < 1e-9) return null
  const r2 = PORTAL.trigger * PORTAL.trigger
  let best: { k: number; t: number; x: number; y: number } | null = null
  mouths.forEach((m, k) => {
    const fx = x1 - m.x
    const fy = y1 - m.y
    const c = fx * fx + fy * fy - r2
    if (c <= 0) return
    const b = 2 * (fx * dx + fy * dy)
    const disc = b * b - 4 * a * c
    if (disc < 0) return
    const t = (-b - Math.sqrt(disc)) / (2 * a)
    if (t < 0 || t > 1 || (best && t >= best.t)) return
    best = { k, t, x: x1 + dx * t, y: y1 + dy * t }
  })
  return best
}
