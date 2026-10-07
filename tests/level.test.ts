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
  it('lets P1 hit N2 in the clear', () => {
    const result = trace('p1', 'n2')
    expect(result.hitId).toBe('n2')
    expect(result.bounced).toBe(false)
  })

  it('lets the side duels land', () => {
    expect(trace('p2', 'e2').hitId).toBe('e2')
    expect(trace('e2', 'p2').hitId).toBe('p2')
    expect(trace('p3', 'e3').hitId).toBe('e3')
    expect(trace('e3', 'p3').hitId).toBe('p3')
  })

  it('pushes E1’s shot downward through the fan', () => {
    const result = trace('e1', 'n1')
    expect(result.pushed).toBe(true)
    expect(result.maxVy).toBeGreaterThan(120)
  })

  it('blocks a straight P1 shot at E1 with the tall wall', () => {
    const result = trace('p1', 'e1')
    expect(result.bounced).toBe(true)
    expect(result.hitId).not.toBe('e1')
  })
})
