import { describe, expect, it } from 'vitest'
import { CAMPAIGN } from '../src/levels'
import { levelLanes, planPuzzle } from '../src/sim/solver'
import { BattleSim, PUZZLE_STALL_MS } from '../src/sim/BattleSim'
import { pointAlong } from '../src/ai/AiController'
import type { LevelDef } from '../src/types'

const DT = 1000 / 60
const LIMITED = CAMPAIGN.filter((l) => l.kind === 'puzzle' && l.aims !== undefined)

/**
 * Play a puzzle's intended solution like a person: wait for each capture,
 * then think for `thinkMs` before the next order, and give a step's swap
 * before or after its aim.
 */
function playLikeAPerson(level: LevelDef, thinkMs: number, swapAfterAim: boolean) {
  const lanes = levelLanes(level)
  const plan = planPuzzle(level, lanes)
  const sim = new BattleSim(level, null, {}, lanes)
  let step = 0
  let readyAt = thinkMs
  let waitingFor: string | null = null
  while (!sim.ended && sim.clock < 240_000) {
    if (waitingFor && sim.byId(waitingFor)!.side === 'player') {
      waitingFor = null
      readyAt = sim.clock + thinkMs
    }
    if (!waitingFor && step < plan.steps.length && sim.clock >= readyAt) {
      const s = plan.steps[step]
      const from = sim.byId(s.from)!
      const to = sim.byId(s.to)!
      if (from.side === 'player') {
        const aim = s.lane.direct ? to : pointAlong(from, s.lane.angle, sim.board)
        if (!swapAfterAim && from.kind !== s.kind) sim.playerSwap(from, s.kind)
        expect(sim.playerAim(from, aim)).toBe(true)
        if (swapAfterAim && from.kind !== s.kind) sim.playerSwap(from, s.kind)
        waitingFor = s.to
        step += 1
      }
    }
    sim.step(DT)
  }
  return { result: sim.ended, aimsUsed: sim.aimsUsed, reason: sim.endReason, seconds: Math.round(sim.clock / 1000) }
}

describe('every puzzle with an aim limit can be won within it, played like a person', () => {
  it('there are limited puzzles (Long Shot among them)', () => {
    expect(LIMITED.map((l) => l.id)).toContain('long-shot')
  })
  for (const level of LIMITED) {
    it(level.id, () => {
      for (const think of [0, 2000, 4000, 8000]) {
        for (const swapAfterAim of [false, true]) {
          const r = playLikeAPerson(level, think, swapAfterAim)
          expect(r.result, `${level.id} think ${think}ms swapAfterAim ${swapAfterAim}: ${JSON.stringify(r)}`).toBe('win')
          expect(r.aimsUsed).toBeLessThanOrEqual(level.aims!)
        }
      }
    })
  }
})

describe('out of aims', () => {
  const longShot = CAMPAIGN.find((l) => l.id === 'long-shot')!

  it('is not judged the moment the last aim is spent: the slow sniper shot after a swap gets its chance', () => {
    const sim = new BattleSim(longShot, null, {}, levelLanes(longShot))
    const [p1, n1, n2, n3] = ['p1', 'n1', 'n2', 'n3'].map((id) => sim.byId(id)!)
    sim.playerAim(p1, n2)
    while (n2.side !== 'player') sim.step(DT)
    sim.playerAim(p1, n1)
    while (n1.side !== 'player') sim.step(DT)
    // Think well past the quiet window, then swap N1 to a sniper and spend the last aim.
    for (let t = 0; t < PUZZLE_STALL_MS + 3000; t += DT) sim.step(DT)
    expect(sim.ended).toBeNull()
    sim.playerSwap(n1, 'sniper')
    expect(sim.playerAim(n1, n3)).toBe(true)
    expect(sim.aimsLeft).toBe(0)
    sim.step(DT)
    expect(sim.ended).toBeNull()
    while (!sim.ended && sim.clock < 120_000) sim.step(DT)
    expect(sim.ended).toBe('win')
  })

  it('still ends the puzzle once nothing can change (the last aim at a wall)', () => {
    const sim = new BattleSim(longShot, null, {}, levelLanes(longShot))
    const p1 = sim.byId('p1')!
    const p2 = sim.byId('p2')!
    // Three aims at nothing useful: straight into the bottom-left corner.
    sim.playerAim(p1, { x: 40, y: 760 })
    sim.playerAim(p2, { x: 40, y: 700 })
    sim.playerAim(p1, { x: 60, y: 760 })
    expect(sim.aimsLeft).toBe(0)
    while (!sim.ended && sim.clock < 60_000) sim.step(DT)
    expect(sim.ended).toBe('lose')
    expect(sim.endReason).toMatch(/out of aims/i)
    expect(sim.clock).toBeLessThan(25_000)
  })

  it('re-aiming at what a cannon already aims at, and Stop aiming, spend nothing', () => {
    const sim = new BattleSim(longShot, null, {}, levelLanes(longShot))
    const p1 = sim.byId('p1')!
    const n2 = sim.byId('n2')!
    expect(sim.playerAim(p1, n2)).toBe(true)
    expect(sim.aimsUsed).toBe(1)
    expect(sim.playerAim(p1, n2)).toBe(true)
    expect(sim.aimsUsed).toBe(1)
    expect(sim.playerAim(p1, { x: 300, y: 300 })).toBe(true)
    expect(sim.playerAim(p1, { x: 300, y: 300 })).toBe(true)
    expect(sim.aimsUsed).toBe(2)
    expect(sim.playerStop(p1)).toBe(true)
    expect(sim.aimsUsed).toBe(2)
    // Paused: queuing where it already aims is free too.
    sim.playerAim(p1, n2)
    expect(sim.aimsUsed).toBe(3)
    sim.pause()
    expect(sim.playerAim(p1, n2)).toBe(true)
    expect(sim.aimsLeft).toBe(0)
    sim.resume()
    expect(sim.aimsUsed).toBe(3)
  })
})
