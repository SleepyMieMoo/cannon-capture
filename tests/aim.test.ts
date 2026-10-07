import { describe, expect, it } from 'vitest'
import { angleDelta, clampPoint, turnToward } from '../src/sim/aim'

const deg = (d: number) => (d * Math.PI) / 180

describe('turning', () => {
  it('takes the short way round across the ±180° seam', () => {
    expect(angleDelta(deg(170), deg(-170))).toBeCloseTo(deg(20))
    expect(angleDelta(deg(-170), deg(170))).toBeCloseTo(deg(-20))
  })

  it('never turns more than the step', () => {
    expect(turnToward(0, deg(90), deg(30))).toBeCloseTo(deg(30))
    expect(turnToward(0, deg(-90), deg(30))).toBeCloseTo(deg(-30))
  })

  it('lands exactly on the target when close enough', () => {
    expect(turnToward(deg(10), deg(15), deg(30))).toBe(deg(15))
  })

  it('reaches a 180° turn in the expected number of steps', () => {
    let angle = 0
    let steps = 0
    while (Math.abs(angleDelta(angle, Math.PI)) > 1e-9 && steps < 100) {
      angle = turnToward(angle, Math.PI, deg(45))
      steps += 1
    }
    expect(steps).toBe(4)
  })
})

describe('aim point clamp', () => {
  it('keeps points inside the board', () => {
    const box = { x: 10, y: 20, w: 100, h: 50 }
    expect(clampPoint(0, 0, box, 5)).toEqual({ x: 15, y: 25 })
    expect(clampPoint(500, 500, box, 5)).toEqual({ x: 105, y: 65 })
    expect(clampPoint(50, 40, box)).toEqual({ x: 50, y: 40 })
  })
})

describe('firing only after the turn finishes', () => {
  // Imported lazily so the rest of this file stays pure-math.
  const make = async () => {
    const { Cannon } = await import('../src/entities/Cannon')
    const { TUNING } = await import('../src/config/tuning')
    return { Cannon, TUNING }
  }
  const run = (cannon: { update: (dt: number, frozen: boolean, fireMs?: number) => unknown }, ms: number, fireMs?: number) => {
    const shots: number[] = []
    for (let t = 0; t < ms; t += 16) if (cannon.update(16, false, fireMs)) shots.push(t + 16)
    return shots
  }

  it('holds fire during a long turn, then fires the moment it lines up', async () => {
    const { Cannon, TUNING } = await make()
    const c = new Cannon(null, 'p1', 'P1', 300, 300, 'player', 0)
    c.setAimPoint({ x: 100, y: 300 }) // straight behind: a 180° turn
    const turnMs = (180 / TUNING.turnSpeedDeg) * 1000
    const shots = run(c, 4000)
    expect(shots[0]).toBeGreaterThanOrEqual(turnMs - 20) // 0.5° tolerance is ~5ms of turning
    expect(shots[0]).toBeLessThan(turnMs + 40) // timer was already ready: no extra wait
    expect(shots[1] - shots[0]).toBeCloseTo(TUNING.fireIntervalMs, -2)
    expect(c.aimErrorDeg()).toBeLessThanOrEqual(TUNING.aimToleranceDeg)
  })

  it('a short turn still waits for the fire timer', async () => {
    const { Cannon, TUNING } = await make()
    const c = new Cannon(null, 'p1', 'P1', 300, 300, 'player', 0)
    c.setAimPoint({ x: 500, y: 300 }) // already lined up
    const first = run(c, 100)
    expect(first).toEqual([16])
    c.setAimPoint({ x: 500, y: 400 }) // ~27° turn, done in ~0.25s
    const next = run(c, 2000)
    // Lined up again after ~250ms, but the next shot still comes a full interval after the first.
    const sinceFirst = next[0] + 96
    expect(sinceFirst).toBeGreaterThanOrEqual(TUNING.fireIntervalMs - 16)
    expect(sinceFirst).toBeLessThanOrEqual(TUNING.fireIntervalMs + 32)
  })

  it('enemy fire intervals still apply', async () => {
    const { Cannon } = await make()
    const c = new Cannon(null, 'e1', 'E1', 300, 300, 'enemy', 0)
    c.setAimPoint({ x: 100, y: 300 }) // enemies start facing left: lined up
    const shots = run(c, 4000, 1300)
    expect(shots[1] - shots[0]).toBeCloseTo(1300, -2)
  })
})
