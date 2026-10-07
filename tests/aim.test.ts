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
