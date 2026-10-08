import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning'
import { laneKey, shotLifetimeFor, shotSpeedFor } from '../src/config/kinds'
import { Cannon } from '../src/entities/Cannon'
import { BattleSim } from '../src/sim/BattleSim'
import { decodeShare, encodeShare, sanitizeLevel } from '../src/editor/maps'
import { levelLanes, planPuzzle, MIN_LANE_DEG } from '../src/sim/solver'
import { planSwaps } from '../src/ai/AiController'
import { CAMPAIGN } from '../src/levels'
import type { LevelDef } from '../src/types'

/** A CC1 share code made by the build before tower types existed. */
const OLD_CODE = 'CC1:eyJpZCI6ImN1c3RvbS1vbGQiLCJuYW1lIjoiT2xkIFdhbGxzIiwia2luZCI6ImJhdHRsZSIsInNpemUiOiJzbWFsbCIsImNhbm5vbnMiOlt7ImlkIjoicDEiLCJuYW1lIjoiUDEiLCJ4IjoxNzAsInkiOjIyMCwic2lkZSI6InBsYXllciIsImFpbUF0IjoibjEifSx7ImlkIjoicDIiLCJuYW1lIjoiUDIiLCJ4IjoxNzAsInkiOjU4MCwic2lkZSI6InBsYXllciIsImFpbUF0IjoibjIifSx7ImlkIjoibjEiLCJuYW1lIjoiTjEiLCJ4Ijo2MDAsInkiOjE3MCwic2lkZSI6Im5ldXRyYWwifSx7ImlkIjoibjIiLCJuYW1lIjoiTjIiLCJ4Ijo2MDAsInkiOjYzMCwic2lkZSI6Im5ldXRyYWwifSx7ImlkIjoiZTEiLCJuYW1lIjoiRTEiLCJ4IjoxMDMwLCJ5IjozMDAsInNpZGUiOiJlbmVteSIsImFpbUF0IjoibjEifSx7ImlkIjoiZTIiLCJuYW1lIjoiRTIiLCJ4IjoxMDMwLCJ5Ijo1MDAsInNpZGUiOiJlbmVteSIsImFpbUF0IjoibjIifV0sIndhbGxzIjpbeyJ4Ijo1ODgsInkiOjI3MCwidyI6MjQsImgiOjI2MH0seyJ4Ijo4NjAsInkiOjM4OCwidyI6MTIwLCJoIjoyNH1dLCJmYW5zIjpbXSwiaGludCI6IlRoZSBtaWRkbGUgaXMgd2FsbGVkIG9mZi4gVGFrZSB0aGUgY29ybmVycywgdGhlbiBiYW5rIGFyb3VuZC4iLCJwYXIiOjYwLCJhaSI6eyJyZXRhcmdldE1zIjoyMDAwLCJmaXJlTXMiOjEyMDB9fQ'

const duel: LevelDef = {
  id: 'sniper-test',
  name: 'Sniper test',
  kind: 'puzzle',
  cannons: [
    { id: 'p1', name: 'P1', x: 200, y: 400, side: 'player', kind: 'sniper' },
    { id: 'p2', name: 'P2', x: 200, y: 600, side: 'player', kind: 'sniper', delay: 2 }, // legacy delay: ignored
    { id: 'p3', name: 'P3', x: 200, y: 200, side: 'player' },
    { id: 'n1', name: 'N1', x: 1000, y: 400, side: 'neutral' },
    { id: 'n2', name: 'N2', x: 1000, y: 600, side: 'neutral' },
    { id: 'n3', name: 'N3', x: 1000, y: 200, side: 'neutral' },
  ],
  walls: [],
  fans: [],
}

/** Run until the predicate holds; returns game ms elapsed. */
function runUntil(sim: BattleSim, done: () => boolean, maxMs = 20000, dt = 1000 / 60): number {
  const start = sim.clock
  while (!done() && sim.clock - start < maxMs) sim.step(dt)
  return sim.clock - start
}

function shotLog(sim: BattleSim) {
  const log: { id: string; t: number; damage: number; speed: number; range: number }[] = []
  for (const c of sim.cannons) {
    const orig = c.update.bind(c)
    c.update = (dt, frozen, ms) => {
      const ball = orig(dt, frozen, ms)
      if (ball) log.push({ id: c.id, t: sim.clock, damage: c.damage, speed: Math.hypot(ball.vx, ball.vy), range: ball.range ?? 0 })
      return ball
    }
  }
  return log
}

describe('sniper cannons', () => {
  it('fire every 3 s for 2 damage (one variant, old delays ignored), with shots twice as fast and twice as far', () => {
    const sim = new BattleSim(duel)
    const [p1, p2, p3] = ['p1', 'p2', 'p3'].map((id) => sim.byId(id)!)
    p1.setTarget(sim.byId('n1')!)
    p2.setTarget(sim.byId('n2')!)
    p3.setTarget(sim.byId('n3')!)
    for (const c of [p1, p2, p3]) c.snapToAim()
    const log = shotLog(sim)
    runUntil(sim, () => false, 9000)
    const gaps = (id: string) => log.filter((s) => s.id === id).map((s, i, a) => (i ? s.t - a[i - 1].t : null)).filter((g): g is number => g !== null)
    expect(gaps('p1').length).toBeGreaterThan(0)
    for (const g of gaps('p1')) expect(Math.abs(g - 3000)).toBeLessThan(20)
    for (const g of gaps('p2')) expect(Math.abs(g - 3000)).toBeLessThan(20)
    for (const g of gaps('p3')) expect(Math.abs(g - 1000)).toBeLessThan(20)
    const first = (id: string) => log.find((s) => s.id === id)!
    expect(first('p1').damage).toBe(2)
    expect(first('p2').damage).toBe(2)
    expect(first('p3').damage).toBe(1)
    expect(first('p1').speed).toBeCloseTo(first('p3').speed * 2, 5)
    // Twice the range (path length, bounces included).
    expect(first('p1').range).toBeCloseTo(first('p3').range * 2, 5)
    expect(first('p3').range).toBeCloseTo((TUNING.shotSpeed * TUNING.shotLifetimeMs) / 1000, 5)
    expect(shotSpeedFor('sniper')).toBe(TUNING.shotSpeed * 2)
    expect(shotLifetimeFor('normal')).toBe(TUNING.shotLifetimeMs)
  })

  it('a sniper captures in 4 hits', () => {
    const sim = new BattleSim(duel)
    const n1 = sim.byId('n1')!
    const dmg = sim.byId('p1')!.damage
    for (let i = 0; i < 3; i++) expect(n1.receiveHit('player', dmg).flipped).toBe(false)
    expect(n1.receiveHit('player', dmg).flipped).toBe(true)
  })

  it('a captured sniper stays a sniper for its new owner', () => {
    const level: LevelDef = { ...duel, kind: 'battle', cannons: [...duel.cannons.slice(0, 3), { id: 'e1', name: 'E1', x: 1000, y: 400, side: 'enemy', kind: 'sniper' }] }
    const sim = new BattleSim(level)
    const e1 = sim.byId('e1')!
    for (let i = 0; i < 8 && e1.side === 'enemy'; i++) e1.receiveHit('player')
    expect(e1.side).toBe('player')
    expect(e1.kind).toBe('sniper')
    expect(e1.damage).toBe(2)
  })

  it('a sniper heal takes 2 progress off (never past full health)', () => {
    const sim = new BattleSim(duel)
    const p3 = sim.byId('p3')!
    p3.captureAttacker = 'enemy'
    p3.captureProgress = 3
    expect(p3.receiveHit('player', sim.byId('p1')!.damage).healed).toBe(2)
    expect(p3.receiveHit('player', sim.byId('p1')!.damage).healed).toBe(1)
    expect(p3.damaged).toBe(false)
  })

  it('swapping type in play reloads for the full new interval (1 s into Normal, 3 s into Sniper)', () => {
    const c = new Cannon(null, 'x', 'X', 0, 0, 'player', 0, 'sniper')
    c.setAimPoint({ x: 100, y: 0 })
    c.snapToAim()
    expect(c.setKind('normal')).toBe(true)
    expect(c.swapping).toBe(true)
    let t = 0
    while (!c.update(1000 / 60, false, 1000) && t < 5000) t += 1000 / 60
    expect(t).toBeGreaterThanOrEqual(TUNING.swapLockMs - 20)
    expect(t).toBeLessThan(TUNING.swapLockMs + 40)
    expect(c.setKind('sniper')).toBe(true)
    t = 0
    while (!c.update(1000 / 60, false, 1000) && t < 6000) t += 1000 / 60
    expect(t).toBeGreaterThanOrEqual(3000 - 20)
    expect(t).toBeLessThan(3000 + 40)
    expect(c.setKind('sniper')).toBe(false) // nothing changes, no reload
  })

  it('playerSwap is free in puzzles (no aim spent) and only works on your own cannons', () => {
    const sim = new BattleSim({ ...duel, aims: 1 })
    expect(sim.playerSwap(sim.byId('p3')!, 'sniper')).toBe(true)
    expect(sim.aimsUsed).toBe(0)
    expect(sim.byId('p3')!.kind).toBe('sniper')
    expect(sim.playerSwap(sim.byId('n1')!, 'sniper')).toBe(false)
  })
})

describe('sniper lanes, AI and campaign', () => {
  it('builds separate lanes per tower type', () => {
    const lanes = levelLanes(duel)
    for (const c of duel.cannons) {
      expect(lanes.has(laneKey(c.id, 'normal'))).toBe(true)
      expect(lanes.has(laneKey(c.id, 'sniper'))).toBe(true)
    }
  })

  it('Long Shot: N1 sits behind a headwind only a sniper punches through, and N3 needs a swap', () => {
    const level = CAMPAIGN.find((l) => l.id === 'long-shot')!
    const lanes = levelLanes(level)
    const reaches = (from: string, kind: 'normal' | 'sniper', to: string) => (lanes.get(laneKey(from, kind))?.get(to)?.widthDeg ?? 0) >= MIN_LANE_DEG
    expect(reaches('p1', 'sniper', 'n1')).toBe(true)
    // Nothing you hold before N1 can reach it as a normal cannon (P1 included).
    for (const id of ['p1', 'p2', 'n2']) expect(reaches(id, 'normal', 'n1'), id).toBe(false)
    const plan = planPuzzle(level, lanes)
    expect(plan.solved).toBe(true)
    expect(plan.steps.some((s) => s.kind === 'sniper' && s.from !== 'p1')).toBe(true)
  })

  it('the AI swaps a cannon to sniper when that is the only way to reach a foe', () => {
    const level = CAMPAIGN.find((l) => l.id === 'sniper-duel')!
    const sim = new BattleSim(level)
    for (const c of sim.cannons) if (c.side !== 'enemy') c.side = 'player'
    const orders = planSwaps('player', sim.cannons, sim.lanes)
    // E1 hides behind the wind; something must become a sniper to reach it.
    expect(orders.some((o) => o.kind === 'sniper')).toBe(true)
  })
})

describe('share codes with tower types', () => {
  it('round-trips the type (and drops the old sniper delay)', () => {
    const back = decodeShare(encodeShare(duel))
    expect(back.cannons.map((c) => [c.id, c.kind ?? 'normal', c.delay])).toEqual([
      ['p1', 'sniper', undefined],
      ['p2', 'sniper', undefined],
      ['p3', 'normal', undefined],
      ['n1', 'normal', undefined],
      ['n2', 'normal', undefined],
      ['n3', 'normal', undefined],
    ])
  })

  it('still imports an old CC1 code from before tower types (everything normal)', () => {
    const old = decodeShare(OLD_CODE)
    expect(old.name).toBe('Old Walls')
    expect(old.cannons.length).toBe(6)
    for (const c of old.cannons) {
      expect(c.kind).toBeUndefined()
      expect(c.delay).toBeUndefined()
    }
    const sim = new BattleSim(old)
    expect(sim.cannons.every((c) => c.kind === 'normal' && c.damage === 1)).toBe(true)
  })

  it('cleans up unknown types, and maps any old sniper delay to the single sniper', () => {
    const level = sanitizeLevel({
      cannons: [
        { id: 'p1', side: 'player', x: 200, y: 300, kind: 'laser' },
        { id: 'p2', side: 'player', x: 200, y: 500, kind: 'sniper', delay: 7 },
        { id: 'e1', side: 'enemy', x: 900, y: 400, kind: 'normal', delay: 3 },
        { id: 'e2', side: 'enemy', x: 900, y: 600, kind: 'sniper', delay: 3 },
      ],
      walls: [],
      fans: [],
    })
    expect(level.cannons.map((c) => [c.kind, c.delay])).toEqual([
      [undefined, undefined],
      ['sniper', undefined],
      [undefined, undefined],
      ['sniper', undefined],
    ])
    const sim = new BattleSim({ ...level, kind: 'battle' })
    expect(sim.byId('e2')!.damage).toBe(2)
    expect(sim.byId('e2')!.fireMs()).toBe(3000)
  })
})
