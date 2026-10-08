import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning'
import { maxShotSpeedFor, shotRangeFor, shotSpeedFor } from '../src/config/kinds'
import { Shot } from '../src/entities/Shot'
import { BattleSim } from '../src/sim/BattleSim'
import { DEFAULT_RANGE, aimShot, stepBall, type Ball, type BallisticsOpts, type FanField } from '../src/sim/ballistics'
import { SIM_STEP_MS } from '../src/sim/fixedStep'
import { shotOpts, traceAngle } from '../src/sim/solver'
import type { CannonKind, LevelDef, WallDef } from '../src/types'

/** Open space, so only range (or a hit) ends a shot. */
const open: BallisticsOpts = { ...shotOpts({ size: 'huge' }), bounds: { x: -1e5, y: -1e5, w: 2e5, h: 2e5 } }

function shot(kind: CannonKind, x: number, y: number, angle: number): Shot {
  const ball = aimShot({ x, y }, { x: x + Math.cos(angle), y: y + Math.sin(angle) }, 0, shotSpeedFor(kind), 'a')
  if (kind !== 'normal') ball.maxSpeed = maxShotSpeedFor(kind)
  ball.range = shotRangeFor(kind)
  return new Shot(ball, 'player', 1, kind)
}

/** Fly to the end; returns the path length (summed step by step) and the bounces. */
function fly(s: Shot, walls: WallDef[], fans: FanField[] = [], opts = open): { path: number; bounces: number; ms: number } {
  let path = 0
  let ms = 0
  while (s.ball.alive && ms < 60_000) {
    const { x, y } = s.ball
    s.step(SIM_STEP_MS, walls, fans, [], opts)
    path += Math.hypot(s.ball.x - x, s.ball.y - y)
    ms += SIM_STEP_MS
  }
  return { path, bounces: s.ball.bounces, ms }
}

/** Two walls `gap` apart, long enough for exactly `k` bounces of a 45° shot from the middle. */
function zigzag(k: number, gap = 200): WallDef[] {
  if (k === 0) return []
  return [
    { x: 0, y: -gap / 2 - 40, w: gap * k, h: 40 },
    { x: 0, y: gap / 2, w: gap * k, h: 40 },
  ]
}

describe('shot range is path length', () => {
  it('a normal shot travels its full range with 0, 1, 2, 3 or more bounces', () => {
    for (const k of [0, 1, 2, 3, 4, 6]) {
      const s = shot('normal', 0, 0, -Math.PI / 4)
      const r = fly(s, zigzag(k))
      expect(r.bounces).toBe(k)
      expect(s.ball.travelled).toBeCloseTo(DEFAULT_RANGE, 3)
      // Measured independently (bounce push-outs shave a pixel or so off each bank).
      expect(r.path).toBeGreaterThan(DEFAULT_RANGE - 2 * (k + 1))
      expect(r.path).toBeLessThan(DEFAULT_RANGE + 2)
    }
  })

  it('a sniper keeps twice the range, however much it banks', () => {
    expect(shotRangeFor('sniper')).toBe(2 * shotRangeFor('normal'))
    expect(shotRangeFor('machinegun')).toBe(shotRangeFor('normal') / 2)
    for (const k of [0, 1, 2, 3, 5, 6]) {
      const s = shot('sniper', 0, 0, -Math.PI / 4)
      const r = fly(s, zigzag(k))
      expect(r.bounces).toBe(k)
      expect(s.ball.travelled).toBeCloseTo(shotRangeFor('sniper'), 3)
      expect(r.path).toBeGreaterThan(shotRangeFor('sniper') - 2 * (k + 1))
    }
  })

  it('a bounce costs nothing: the same distance with and without walls', () => {
    const a = shot('normal', 0, 0, -Math.PI / 4)
    const b = shot('normal', 0, 0, -Math.PI / 4)
    fly(a, [])
    fly(b, zigzag(3))
    expect(b.ball.age).toBeCloseTo(a.ball.age, 0)
  })

  it('a corner (two walls touched at once) counts as one bounce', () => {
    const corner: WallDef[] = [
      { x: 300, y: -200, w: 40, h: 240 },
      { x: 60, y: 0, w: 280, h: 40 },
    ]
    const s = shot('normal', 0, -300, Math.atan2(300, 300))
    fly(s, corner)
    expect(s.ball.bounces).toBe(1)
  })

  it('a shot a fan slows still flies its full range (it just takes longer)', () => {
    const fan: FanField[] = [{ x: 400, y: 0, radius: 200, angle: Math.PI, force: 540 }]
    const s = shot('normal', 0, 0, 0)
    const r = fly(s, [], fan)
    expect(s.ball.travelled).toBeCloseTo(DEFAULT_RANGE, 3)
    expect(r.ms).toBeGreaterThan(TUNING.shotLifetimeMs)
    expect(r.ms).toBeLessThan(TUNING.shotMaxFlightMs)
  })

  it('the bounce cap is only a safety net for a shot rattling in a tight slot', () => {
    expect(TUNING.maxBounces).toBeGreaterThanOrEqual(10)
    // A 20 px slot: a shot bouncing straight across it would hit a wall every ~25 px.
    const slot: WallDef[] = [
      { x: -500, y: -50, w: 1000, h: 40 },
      { x: -500, y: 30, w: 1000, h: 40 },
    ]
    const s = shot('normal', 0, 0, Math.PI / 2 - 0.05)
    const r = fly(s, slot)
    expect(r.bounces).toBe(TUNING.maxBounces + 1)
    expect(s.ball.travelled!).toBeLessThan(DEFAULT_RANGE / 2)
  })

  it('stepBall without a range uses the normal one', () => {
    let b: Ball = { x: 0, y: 0, vx: 340, vy: 0, age: 0, bounces: 0, alive: true, ownerId: 'a' }
    let n = 0
    while (b.alive && n++ < 1000) b = stepBall(b, 16, [], [], [], open).ball
    expect(b.travelled).toBeCloseTo(DEFAULT_RANGE, 3)
  })
})

describe('planner and play agree on long bank shots', () => {
  // A long corridor on a Large board: a 45° shot from P1 banks five times before it leaves.
  const walls: WallDef[] = [
    { x: 60, y: 240, w: 1260, h: 40 },
    { x: 60, y: 520, w: 1260, h: 40 },
  ]
  const p1 = { x: 110, y: 400 }
  const angle = -Math.PI / 4
  // Where that shot is after its fifth bounce, well clear of the corridor: N1 goes there.
  function landing(): { x: number; y: number; vx: number; vy: number; bounces: number } {
    const opts = shotOpts({ size: 'large' })
    let b = aimShot(p1, { x: p1.x + Math.cos(angle), y: p1.y + Math.sin(angle) }, TUNING.cannonRadius + 12, shotSpeedFor('sniper'), 'p1')
    b.maxSpeed = maxShotSpeedFor('sniper')
    b.range = shotRangeFor('sniper')
    while (b.alive && !(b.bounces >= 5 && b.x > 1500)) b = stepBall(b, 16, walls, [], [], opts).ball
    return { x: b.x, y: b.y, vx: b.vx, vy: b.vy, bounces: b.bounces }
  }

  it('finds a five-bounce sniper lane and the shot lands in play', () => {
    const at = landing()
    expect(at.bounces).toBeGreaterThanOrEqual(5)
    const level: LevelDef = {
      id: 'long-bank',
      name: 'Long bank',
      kind: 'puzzle',
      size: 'large',
      cannons: [
        { id: 'p1', name: 'P1', x: p1.x, y: p1.y, side: 'player', kind: 'sniper' },
        { id: 'n1', name: 'N1', x: Math.round(at.x + (at.vx / Math.hypot(at.vx, at.vy)) * 80), y: Math.round(at.y + (at.vy / Math.hypot(at.vx, at.vy)) * 80), side: 'neutral' },
      ],
      walls,
      fans: [],
    }
    expect(traceAngle(level, 'p1', angle, 'sniper')).toBe('n1')
    const sim = new BattleSim(level)
    const shooter = sim.byId('p1')!
    shooter.setAimPoint({ x: p1.x + Math.cos(angle) * 300, y: p1.y + Math.sin(angle) * 300 })
    shooter.snapToAim()
    const n1 = sim.byId('n1')!
    const start = sim.clock
    while (n1.side === 'neutral' && n1.captureProgress === 0 && sim.clock - start < 6000) sim.step(SIM_STEP_MS)
    expect(n1.side !== 'neutral' || n1.captureProgress > 0).toBe(true)
  })
})
