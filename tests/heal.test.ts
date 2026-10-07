import { describe, expect, it } from 'vitest'
import { BattleSim } from '../src/sim/BattleSim'
import { planHeals } from '../src/ai/AiController'
import type { LevelDef } from '../src/types'

const level: LevelDef = {
  id: 'heal-test',
  name: 'Heal test',
  cannons: [
    { id: 'p1', name: 'P1', x: 200, y: 250, side: 'player', aimAt: 'e1' },
    { id: 'p2', name: 'P2', x: 200, y: 550, side: 'player' },
    { id: 'e1', name: 'E1', x: 1000, y: 250, side: 'enemy' },
    { id: 'e2', name: 'E2', x: 1000, y: 550, side: 'enemy' },
  ],
  walls: [],
  fans: [],
}

function run(sim: BattleSim, ms: number, until?: () => boolean) {
  for (let t = 0; t < ms && !(until && until()); t += 1000 / 60) sim.step(1000 / 60)
}

describe('healing', () => {
  it('a gold cannon heals a damaged gold cannon, then goes back to its old aim', () => {
    const sim = new BattleSim({ ...level, kind: 'puzzle' }) // no AI interference
    const p1 = sim.byId('p1')!
    const p2 = sim.byId('p2')!
    const e1 = sim.byId('e1')!
    p2.captureAttacker = 'enemy'
    p2.captureProgress = 5
    expect(sim.playerAim(p1, p2)).toBe(true)
    expect(p1.healing).toBe(p2)
    run(sim, 3000, () => p2.captureProgress < 5)
    expect(p2.captureProgress).toBe(4)
    run(sim, 8000, () => !p2.damaged)
    expect(p2.damaged).toBe(false)
    expect(p2.captureAttacker).toBe(null)
    run(sim, 50)
    expect(p1.healing).toBe(null)
    expect(p1.target).toBe(e1)
  })

  it('friendly fire on a healthy cannon changes nothing', () => {
    const sim = new BattleSim({ ...level, kind: 'puzzle' })
    const p2 = sim.byId('p2')!
    expect(p2.receiveHit('player', 3)).toEqual({ flipped: false, healed: 0 })
    expect(p2.captureProgress).toBe(0)
    expect(p2.captureAttacker).toBe(null)
  })

  it('the AI sends one helper to a cannon close to flipping', () => {
    const sim = new BattleSim(level)
    const e2 = sim.byId('e2')!
    e2.captureAttacker = 'player'
    e2.captureProgress = 3
    expect(planHeals('enemy', sim.cannons, sim.lanes)).toEqual([])
    e2.captureProgress = 5
    const orders = planHeals('enemy', sim.cannons, sim.lanes)
    expect(orders.map((o) => [o.helper.id, o.friend.id])).toEqual([['e1', 'e2']])
    sim.ai.retarget(sim.cannons)
    expect(sim.byId('e1')!.healing).toBe(e2)
  })
})
