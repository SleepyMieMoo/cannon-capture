import { describe, expect, it } from 'vitest'
import { BattleSim } from '../src/sim/BattleSim'
import { planHeals } from '../src/ai/AiController'
import type { LevelDef } from '../src/types'
import { HOWTO } from '../src/menu/art'

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

describe('after a heal (what the How to play card promises)', () => {
  const lvl: LevelDef = {
    id: 'heal-after', name: 'Heal after', kind: 'battle', walls: [], fans: [],
    cannons: [
      { id: 'p1', name: 'P1', x: 200, y: 250, side: 'player' },
      { id: 'p2', name: 'P2', x: 200, y: 550, side: 'player' },
      { id: 'e1', name: 'E1', x: 1000, y: 250, side: 'enemy' },
      { id: 'e2', name: 'E2', x: 1000, y: 550, side: 'enemy' },
    ],
  }
  type Auto = 'on' | 'global-off' | 'cannon-off'
  /** P1 heals P2 (from `before`'s aim); E1 is P1's nearest foe, E2 the next. */
  const heal = (auto: Auto, before: (sim: BattleSim) => void, during?: (sim: BattleSim) => void) => {
    const sim = new BattleSim(lvl)
    sim.ai.update = () => {}
    for (const c of sim.cannons) if (c.side === 'enemy') c.clearAim()
    const p1 = sim.byId('p1')!
    const p2 = sim.byId('p2')!
    p1.autoTarget = auto !== 'cannon-off'
    sim.setAutoTarget(auto !== 'global-off')
    before(sim)
    p2.captureAttacker = 'enemy'
    p2.captureProgress = 3
    sim.playerAim(p1, p2)
    expect(p1.healing).toBe(p2)
    during?.(sim)
    run(sim, 15000, () => !p2.damaged)
    expect(p2.damaged).toBe(false)
    run(sim, 100)
    expect(p1.healing).toBe(null)
    return { sim, p1, e1: sim.byId('e1')!, e2: sim.byId('e2')! }
  }
  const captureE1 = (sim: BattleSim) => {
    // Another gold cannon finishes E1 while P1 is healing.
    const e1 = sim.byId('e1')!
    const hits = sim as unknown as { onCaptured(c: unknown): void }
    while (e1.side !== 'player') if (e1.receiveHit('player', 1).flipped) hits.onCaptured(e1)
  }

  it('auto-target on: picks the nearest foe whatever it aimed at before (the saved aim is ignored)', () => {
    // Old target E2: switches to the nearer E1.
    let r = heal('on', (sim) => sim.playerAim(sim.byId('p1')!, sim.byId('e2')!))
    expect(r.p1.target).toBe(r.e1)
    // Old free aim point: replaced.
    r = heal('on', (sim) => sim.playerAim(sim.byId('p1')!, { x: 700, y: 120 }))
    expect(r.p1.target).toBe(r.e1)
    expect(r.p1.aimPoint).toBe(null)
    // No aim before: it still gets one.
    r = heal('on', () => {})
    expect(r.p1.target).toBe(r.e1)
    // Old target captured by us mid-heal: the next foe.
    r = heal('on', (sim) => sim.playerAim(sim.byId('p1')!, sim.byId('e1')!), captureE1)
    expect(r.p1.target).toBe(r.e2)
    // And it keeps shooting.
    r.sim.shots.length = 0
    run(r.sim, 2500, () => r.sim.shots.some((s) => s.ball.ownerId === 'p1'))
    expect(r.sim.shots.some((s) => s.ball.ownerId === 'p1')).toBe(true)
  })

  for (const auto of ['global-off', 'cannon-off'] as const) {
    it(`auto-target off (${auto}): back to its old target or aim point; idle with no old aim or when that target became yours`, () => {
      let r = heal(auto, (sim) => sim.playerAim(sim.byId('p1')!, sim.byId('e2')!))
      expect(r.p1.target).toBe(r.e2)

      r = heal(auto, (sim) => sim.playerAim(sim.byId('p1')!, { x: 700, y: 120 }))
      expect(r.p1.target).toBe(null)
      expect(r.p1.aimPoint).toEqual({ x: 700, y: 120 })

      r = heal(auto, () => {})
      expect(r.p1.aim()).toBe(null)

      r = heal(auto, (sim) => sim.playerAim(sim.byId('p1')!, sim.byId('e1')!), captureE1)
      expect(r.p1.aim()).toBe(null)
    })
  }

  it('puzzles never auto-target: back to the old aim', () => {
    const sim = new BattleSim({ ...lvl, kind: 'puzzle' })
    const [p1, p2, , e2] = sim.cannons
    sim.playerAim(p1, e2)
    p2.captureAttacker = 'enemy'
    p2.captureProgress = 2
    sim.playerAim(p1, p2)
    run(sim, 15000, () => !p2.damaged)
    run(sim, 100)
    expect(p1.target).toBe(e2)
  })

  it('player vs player: the same rule for pink, with pink\'s own switches', () => {
    for (const on of [true, false]) {
      const sim = new BattleSim(lvl)
      sim.makePvp()
      sim.setAutoTarget(on, 'enemy')
      for (const c of sim.cannons) if (c.side === 'player') c.clearAim()
      const [p1, , e1, e2] = sim.cannons
      // E1's nearest foe is P1; it was on P2 (by a free point near it, so P2 isn't its target object).
      sim.playerAim(e1, { x: 200, y: 600 }, 'enemy')
      e2.captureAttacker = 'player'
      e2.captureProgress = 3
      sim.playerAim(e1, e2, 'enemy')
      expect(e1.healing).toBe(e2)
      run(sim, 15000, () => !e2.damaged)
      run(sim, 100)
      if (on) expect(e1.target).toBe(p1)
      else expect(e1.aimPoint).toEqual({ x: 200, y: 600 })
    }
  })

  it('the AI\'s cannons keep their own after-heal rule (back to the planned attack)', () => {
    const sim = new BattleSim(lvl)
    sim.ai.update = () => {}
    const [, p2, e1, e2] = sim.cannons
    // E1 was on P2 (not its nearest foe, P1); after the heal it is on P2 again.
    e1.setTarget(p2)
    e2.captureAttacker = 'player'
    e2.captureProgress = 3
    e1.startHeal(e2)
    run(sim, 15000, () => !e2.damaged)
    run(sim, 100)
    expect(e1.healing).toBe(null)
    expect(e1.target).toBe(p2)
  })

  it('look-ahead copies follow the same rule as the real round', () => {
    const sim = new BattleSim(lvl)
    const f = sim.fork()
    for (const c of f.cannons) expect(c.healHook).toBe(f)
    for (const c of sim.cannons) expect(c.healHook).toBe(sim)
  })
})

it('How to play has a Heal friends card that says what happens after the heal', () => {
  const card = HOWTO.find((t) => t.title === 'Heal friends')
  expect(card).toBeTruthy()
  expect(card!.text).toMatch(/auto-target on, the healer aims at the nearest foe/)
  expect(card!.text).toMatch(/With it off .*earlier aim/)
  expect(card!.text).toMatch(/waits for you to aim it/)
  expect(card!.art).toContain('<svg')
})
