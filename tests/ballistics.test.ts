import { describe, expect, it } from 'vitest'
import { circleAabb, clipToWalls, reflect } from '../src/sim/geometry'
import { stepBall, type Ball, type BallisticsOpts } from '../src/sim/ballistics'

const opts: BallisticsOpts = {
  radius: 6,
  maxSpeed: 600,
  maxBounces: 3,
  bounds: { x: 0, y: 0, w: 400, h: 300 },
  ownerGraceMs: 0,
}

function ball(partial: Partial<Ball> = {}): Ball {
  return {
    x: 40,
    y: 40,
    vx: 200,
    vy: 0,
    age: 0,
    bounces: 0,
    alive: true,
    ownerId: 'shooter',
    ...partial,
  }
}

describe('geometry', () => {
  it('reports an outward normal when a circle overlaps a wall', () => {
    const hit = circleAabb(10, 50, 6, { x: 14, y: 0, w: 20, h: 100 })
    expect(hit).not.toBeNull()
    expect(hit!.nx).toBeLessThan(0)
    expect(hit!.pen).toBeGreaterThan(0)
  })

  it('reverses the component of velocity into the wall', () => {
    expect(reflect(120, 40, -1, 0)).toEqual({ vx: -120, vy: 40 })
  })

  it('stops an aim line on the near side of a wall', () => {
    const clipped = clipToWalls(0, 50, 100, 50, [{ x: 40, y: 0, w: 20, h: 100 }])
    expect(clipped.x).toBeCloseTo(40)
    expect(clipped.y).toBeCloseTo(50)
    const clear = clipToWalls(0, 50, 30, 50, [{ x: 40, y: 0, w: 20, h: 100 }])
    expect(clear).toEqual({ x: 30, y: 50 })
  })
})

describe('stepBall', () => {
  it('bounces off a solid wall', () => {
    let current = ball({ x: 20, y: 50, vx: 220, vy: 0 })
    let bounced = false
    for (let i = 0; i < 40 && current.alive; i++) {
      const step = stepBall(current, 16, [{ x: 80, y: 0, w: 24, h: 120 }], [], [], opts)
      current = step.ball
      bounced = bounced || step.bounced
    }
    expect(bounced).toBe(true)
    expect(current.vx).toBeLessThan(0)
  })

  it('pushes a shot along the fan', () => {
    let current = ball({ x: 40, y: 80, vx: 180, vy: 0 })
    let pushed = false
    for (let i = 0; i < 30 && current.alive; i++) {
      const step = stepBall(
        current,
        16,
        [],
        [{ x: 100, y: 80, radius: 70, angle: Math.PI / 2, force: 900 }],
        [],
        opts,
      )
      current = step.ball
      pushed = pushed || step.pushed
    }
    expect(pushed).toBe(true)
    expect(current.vy).toBeGreaterThan(80)
  })

  it('registers a hit on a cannon', () => {
    let current = ball({ x: 30, y: 40, vx: 250, vy: 0, ownerId: 'p1' })
    let hitId: string | null = null
    for (let i = 0; i < 40 && current.alive && !hitId; i++) {
      const step = stepBall(current, 16, [], [], [{ id: 'n1', x: 160, y: 40, radius: 20 }], opts)
      current = step.ball
      hitId = step.hitId
    }
    expect(hitId).toBe('n1')
  })
})
