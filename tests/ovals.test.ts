import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning'
import { shotRangeFor, shotSpeedFor } from '../src/config/kinds'
import { aimShot, stepBall, type Ball, type BallisticsOpts } from '../src/sim/ballistics'
import { circlePillar, clipToPillars, closestOnEllipse, pillarReach } from '../src/sim/geometry'
import { SIM_STEP_MS } from '../src/sim/fixedStep'
import { levelLanes, shotOpts } from '../src/sim/solver'
import { decodeShare, encodeShare, sanitizeLevel } from '../src/editor/maps'
import { SKIRMISH } from '../src/levels'
import type { LevelDef, PillarDef, WallDef } from '../src/types'

const open: BallisticsOpts = { ...shotOpts({ size: 'huge' }), bounds: { x: -1e5, y: -1e5, w: 2e5, h: 2e5 } }

function ball(x: number, y: number, angle: number): Ball {
  const b = aimShot({ x, y }, { x: x + Math.cos(angle), y: y + Math.sin(angle) }, 0, shotSpeedFor('normal'), 'a')
  b.range = shotRangeFor('normal')
  return b
}

/** Fly until the first bounce; returns the velocity before and after and where it was. */
function firstBounce(b: Ball, pillars: PillarDef[]) {
  let s = b
  for (let t = 0; t < 10_000 && s.alive; t += SIM_STEP_MS) {
    const before = { vx: s.vx, vy: s.vy }
    const r = stepBall(s, SIM_STEP_MS, [], [], [], open, undefined, pillars, [])
    if (r.bounced) return { before, after: { vx: r.ball.vx, vy: r.ball.vy }, at: { x: r.ball.x, y: r.ball.y } }
    s = r.ball
  }
  return null
}

/** Brute force: the closest of 20000 points round the ellipse. */
function bruteClosest(px: number, py: number, a: number, b: number) {
  let best = { x: 0, y: 0, d: Infinity }
  for (let i = 0; i < 20000; i++) {
    const t = (i / 20000) * Math.PI * 2
    const x = a * Math.cos(t)
    const y = b * Math.sin(t)
    const d = Math.hypot(px - x, py - y)
    if (d < best.d) best = { x, y, d }
  }
  return best
}

describe('oval pillars: true ellipse reflection', () => {
  it('finds the closest point on an ellipse (inside and outside)', () => {
    let seed = 3
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 300; i++) {
      const a = 12 + rnd() * 100
      const b = 12 + rnd() * 100
      const px = (rnd() - 0.5) * 3 * a
      const py = (rnd() - 0.5) * 3 * b
      const q = closestOnEllipse(px, py, a, b)
      const want = bruteClosest(px, py, a, b)
      expect((q.x * q.x) / (a * a) + (q.y * q.y) / (b * b)).toBeCloseTo(1, 6)
      expect(Math.hypot(px - q.x, py - q.y)).toBeLessThan(want.d + 0.05)
    }
  })

  it('the hit normal is the ellipse’s surface normal where the shot touches', () => {
    const p: PillarDef = { x: 0, y: 0, r: 60, ry: 20 }
    for (const t of [0, 0.3, 0.9, 1.5707963, 2.2, 3.5, 4.4, 5.9]) {
      // A point 4 px out from the surface along its normal.
      const qx = 60 * Math.cos(t)
      const qy = 20 * Math.sin(t)
      const g = Math.hypot(qx / 3600, qy / 400)
      const nx = qx / 3600 / g
      const ny = qy / 400 / g
      const hit = circlePillar(qx + nx * 4, qy + ny * 4, TUNING.shotRadius, p)!
      expect(hit).toBeTruthy()
      expect(hit.nx).toBeCloseTo(nx, 5)
      expect(hit.ny).toBeCloseTo(ny, 5)
      expect(hit.pen).toBeCloseTo(TUNING.shotRadius - 4, 4)
      // Just inside the surface, it still pushes out along the same normal.
      const inside = circlePillar(qx - nx * 2, qy - ny * 2, TUNING.shotRadius, p)!
      expect(inside.nx).toBeCloseTo(nx, 4)
      expect(inside.pen).toBeCloseTo(TUNING.shotRadius + 2, 3)
    }
    // Clear of it: no hit (beyond the reach of a circle of the long radius too).
    expect(circlePillar(0, 30, TUNING.shotRadius, p)).toBeNull()
    expect(circlePillar(70, 0, TUNING.shotRadius, p)).toBeNull()
  })

  it('a shot reflects about that normal, keeping its speed', () => {
    const p: PillarDef = { x: 300, y: 0, r: 30, ry: 70 }
    for (const off of [-50, -20, 0, 25, 55]) {
      const r = firstBounce(ball(0, off, 0), [p])!
      const q = closestOnEllipse(r.at.x - 300, r.at.y, 30, 70)
      let nx = q.x / 900
      let ny = q.y / 4900
      const n = Math.hypot(nx, ny)
      nx /= n
      ny /= n
      const dot = r.before.vx * nx + r.before.vy * ny
      expect(r.after.vx).toBeCloseTo(r.before.vx - 2 * dot * nx, 1)
      expect(r.after.vy).toBeCloseTo(r.before.vy - 2 * dot * ny, 1)
      expect(Math.hypot(r.after.vx, r.after.vy)).toBeCloseTo(Math.hypot(r.before.vx, r.before.vy), 6)
    }
    // A tall oval's flat face sends a centred shot straight back; an off-centre one glances off its curve.
    const centred = firstBounce(ball(0, 0, 0), [p])!
    expect(centred.after.vx).toBeCloseTo(-centred.before.vx, 6)
    expect(Math.abs(centred.after.vy)).toBeLessThan(1e-6)
  })

  it('turning the oval turns the bounce with it (rotation invariant)', () => {
    const base = firstBounce(ball(0, 18, 0), [{ x: 300, y: 0, r: 30, ry: 70 }])!
    const t = 0.7
    const rot = (x: number, y: number) => ({ x: x * Math.cos(t) - y * Math.sin(t), y: x * Math.sin(t) + y * Math.cos(t) })
    const from = rot(0, 18)
    const c = rot(300, 0)
    const turned = firstBounce(ball(from.x, from.y, t), [{ x: c.x, y: c.y, r: 30, ry: 70, angle: t }])!
    const want = rot(base.after.vx, base.after.vy)
    expect(turned.after.vx).toBeCloseTo(want.x, 0)
    expect(turned.after.vy).toBeCloseTo(want.y, 0)
  })

  it('a circle written as an oval (ry = r) bounces exactly like a plain circle', () => {
    const a = firstBounce(ball(0, 17, 0), [{ x: 300, y: 0, r: 28 }])!
    const b = firstBounce(ball(0, 17, 0), [{ x: 300, y: 0, r: 28, ry: 28, angle: 1.2 }])!
    expect(b.after).toEqual(a.after)
  })

  it('the aim preview stops at an oval’s edge, and its reach covers the long side', () => {
    const p: PillarDef = { x: 300, y: 0, r: 20, ry: 60, angle: Math.PI / 2 }
    // Turned a quarter: now 120 wide and 40 tall.
    expect(clipToPillars(0, 0, 600, 0, [p]).x).toBeCloseTo(240, 6)
    expect(clipToPillars(300, -100, 300, 100, [p]).y).toBeCloseTo(-20, 6)
    expect(pillarReach(p)).toBe(60)
  })
})

describe('oval pillars: maps and the AI', () => {
  it('old maps load unchanged; ovals survive share codes; ry = r collapses to a circle', () => {
    const old = sanitizeLevel({ ...SKIRMISH, pillars: [{ x: 300, y: 300, r: 28 }] })
    expect(old.pillars).toEqual([{ x: 300, y: 300, r: 28 }])
    const oval = sanitizeLevel({ ...SKIRMISH, pillars: [{ x: 300, y: 300, r: 40, ry: 24, angle: 0.5 }, { x: 600, y: 300, r: 30, ry: 30, angle: 1 }] })
    expect(oval.pillars).toEqual([{ x: 300, y: 300, r: 40, ry: 24, angle: 0.5 }, { x: 600, y: 300, r: 30 }])
    expect(decodeShare(encodeShare(oval)).pillars).toEqual(oval.pillars)
    // A long oval is kept on the board by its long side.
    const edge = sanitizeLevel({ ...SKIRMISH, pillars: [{ x: 30, y: 300, r: 20, ry: 80 }] })
    expect(edge.pillars![0].x).toBe(24 + 80)
  })

  it('the AI banks off an oval to reach a cannon hidden behind a void wall', () => {
    const blocker: WallDef = { x: 538, y: 370, w: 24, h: 44, kind: 'void' }
    const level: LevelDef = {
      id: 'oval-bank', name: 'Oval', kind: 'battle', fans: [], walls: [blocker],
      // A wide, flat oval above the void: almost a mirror, so a forgiving lane.
      pillars: [{ x: 550, y: 270, r: 70, ry: 24 }],
      cannons: [
        { id: 'p1', name: 'P1', x: 400, y: 392, side: 'player' },
        { id: 'n1', name: 'N1', x: 700, y: 392, side: 'neutral' },
        { id: 'e1', name: 'E1', x: 1120, y: 120, side: 'enemy' },
      ],
    }
    const lane = levelLanes(level).get('p1')?.get('n1')
    expect(lane).toBeTruthy()
    expect(lane!.tricks).toBe(1)
    expect(lane!.widthDeg).toBeGreaterThanOrEqual(2)
  })
})
