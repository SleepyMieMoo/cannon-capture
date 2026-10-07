import { describe, expect, it } from 'vitest'
import { BOARD } from '../src/config/layout'
import { TUNING } from '../src/config/tuning'
import { SKIRMISH } from '../src/levels/skirmish'
import { aimShot, traceShot, type BallisticsOpts, type Body, type FanField } from '../src/sim/ballistics'
import type { CannonDef } from '../src/types'

const opts: BallisticsOpts = {
  radius: TUNING.shotRadius,
  maxSpeed: TUNING.shotSpeed * TUNING.shotSpeedCap,
  maxBounces: TUNING.maxBounces,
  bounds: BOARD,
  ownerGraceMs: TUNING.ownerGraceMs,
}

function def(id: string): CannonDef {
  const cannon = SKIRMISH.cannons.find((entry) => entry.id === id)
  if (!cannon) throw new Error(`Missing cannon ${id}`)
  return cannon
}

function bodies(): Body[] {
  return SKIRMISH.cannons.map((cannon) => ({
    id: cannon.id,
    x: cannon.x,
    y: cannon.y,
    radius: TUNING.cannonRadius,
  }))
}

function fans(): FanField[] {
  return SKIRMISH.fans.map((fan) => ({
    x: fan.x,
    y: fan.y,
    radius: fan.radius,
    angle: fan.angle,
    force: fan.force ?? TUNING.fanForce,
  }))
}

function trace(fromId: string, toId: string) {
  const from = def(fromId)
  const to = def(toId)
  const shot = aimShot(from, to, TUNING.cannonRadius + 12, TUNING.shotSpeed, fromId)
  return traceShot(shot, SKIRMISH.walls, fans(), bodies(), opts)
}

describe('skirmish opening lanes', () => {
  it('lets the contested neutral be hit from both sides', () => {
    expect(trace('p2', 'n2').hitId).toBe('n2')
    expect(trace('p3', 'n2').hitId).toBe('n2')
    expect(trace('e2', 'n2').hitId).toBe('n2')
    expect(trace('e3', 'n2').hitId).toBe('n2')
  })

  it('bends E1’s shot down through the fan onto N2', () => {
    const result = trace('e1', 'n1')
    expect(result.pushed).toBe(true)
    expect(result.hitId).toBe('n2')
    expect(result.maxVy).toBeGreaterThan(200)
  })

  it('bounces P1 off the tall wall before it can reach N1', () => {
    const result = trace('p1', 'n1')
    expect(result.bounced).toBe(true)
    expect(result.hitId).not.toBe('n1')
  })
})
