import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning'
import { BattleSim } from '../src/sim/BattleSim'
import { levelLanes } from '../src/sim/solver'
import { withDifficulty } from '../src/editor/maps'
import type { LevelDef } from '../src/types'
import { mirrored } from './helpers/arena'

const FRAME = 1000 / 60

/** Steps for up to `ms`, or until `done()` says so (or the round ends). */
function run(sim: BattleSim, ms: number, done?: () => boolean): void {
  const end = sim.clock + ms
  while (sim.clock < end - 1e-6 && !sim.ended) {
    sim.step(FRAME)
    if (done?.()) return
  }
}

/**
 * P1 shoots a neutral (N1) close by and captures it. P2 sits idle. Gold is
 * far off and its AI is held still, so only your side's automation moves.
 */
function level(kind: 'battle' | 'puzzle' = 'battle'): LevelDef {
  return {
    id: `auto-${kind}`,
    name: 'Auto',
    kind,
    walls: [],
    fans: [],
    cannons: [
      { id: 'p1', name: 'P1', x: 200, y: 400, side: 'player', aimAt: 'n1' },
      { id: 'p2', name: 'P2', x: 200, y: 600, side: 'player', aimPoint: { x: 400, y: 650 } },
      { id: 'n1', name: 'N1', x: 420, y: 400, side: 'neutral' },
      { id: 'e1', name: 'E1', x: 1000, y: 300, side: 'enemy' },
      { id: 'e2', name: 'E2', x: 1000, y: 500, side: 'enemy' },
    ],
  }
}

function sim(kind: 'battle' | 'puzzle' = 'battle'): BattleSim {
  const s = new BattleSim(level(kind))
  ;(s as unknown as { aiOff: boolean }).aiOff = true
  return s
}

/** Runs until P1 has captured N1, then 3 s more. Returns P1's shots in those 3 s. */
function untilCaptured(s: BattleSim): number {
  const n1 = s.byId('n1')!
  const p1 = s.byId('p1')!
  let at = -1
  let shotsAfter = 0
  const update = p1.update.bind(p1)
  p1.update = (dt, frozen, ms) => {
    const ball = update(dt, frozen, ms)
    if (ball && at >= 0) shotsAfter += 1
    return ball
  }
  run(s, 15_000, () => {
    if (at < 0 && n1.side === 'player') at = s.clock
    return at >= 0 && s.clock - at > 3000
  })
  return shotsAfter
}

describe('auto-target toggles', () => {
  it('both start on: the global setting at the start of every round, and each cannon', () => {
    const s = sim()
    expect(s.autoTarget).toBe(true)
    for (const c of s.cannons) expect(c.autoTarget).toBe(true)
    expect(s.autoTargets(s.byId('p1')!)).toBe(true)
    s.setAutoTarget(false)
    // A new round (restart, next level) is a new sim: on again.
    expect(sim().autoTarget).toBe(true)
  })

  it('on (default): when its target is captured, a cannon picks the nearest foe, and the captured cannon aims at one too', () => {
    const s = sim()
    const p1 = s.byId('p1')!
    const n1 = s.byId('n1')!
    run(s, 15_000)
    expect(n1.side).toBe('player')
    expect(p1.target?.side).toBe('enemy')
    expect(n1.aim()).not.toBe(null)
  })

  it('one cannon off: it keeps its barrel where it was and holds fire; the newly captured cannon still auto-aims', () => {
    const s = sim()
    const p1 = s.byId('p1')!
    const n1 = s.byId('n1')!
    expect(s.toggleCannonAuto(p1)).toBe(false)
    expect(s.autoTargets(p1)).toBe(false)
    const angle = p1.angle
    const shots = untilCaptured(s)
    expect(n1.side).toBe('player')
    expect(p1.target).toBe(null)
    expect(p1.aim()).toBe(null)
    expect(p1.angle).toBeCloseTo(angle, 9)
    expect(shots).toBe(0)
    // N1 just became yours: it follows the global setting (on).
    expect(n1.autoTarget).toBe(true)
    expect(n1.aim()).not.toBe(null)
  })

  it('global off: no cannon of yours picks targets, newly captured ones included; own toggles are kept', () => {
    const s = sim()
    const p1 = s.byId('p1')!
    const p2 = s.byId('p2')!
    const n1 = s.byId('n1')!
    s.toggleCannonAuto(p2) // P2 individually off
    s.setAutoTarget(false)
    expect(s.autoTargets(p1)).toBe(false)
    const shots = untilCaptured(s)
    expect(n1.side).toBe('player')
    expect(p1.aim()).toBe(null)
    expect(shots).toBe(0)
    expect(n1.aim()).toBe(null)
    // Its own toggle is on (it follows the global one), and individual toggles are remembered.
    expect([p1.autoTarget, p2.autoTarget, n1.autoTarget]).toEqual([true, false, true])
    s.setAutoTarget(true)
    expect([s.autoTargets(p1), s.autoTargets(p2), s.autoTargets(n1)]).toEqual([true, false, true])
  })

  it('a free aim point is never changed by anything, auto-target on or off', () => {
    for (const on of [true, false]) {
      const s = sim()
      s.setAutoTarget(on)
      run(s, 15_000)
      expect(s.byId('p2')!.aimPoint).toEqual({ x: 400, y: 650 })
    }
  })

  it("healing still goes back to your previous aim when the friend is whole (that's your order, not auto-target)", () => {
    const s = sim()
    s.setAutoTarget(false)
    const p1 = s.byId('p1')!
    const p2 = s.byId('p2')!
    p2.receiveHit('enemy', 2)
    s.playerAim(p1, p2)
    expect(p1.healing).toBe(p2)
    run(s, 4000)
    expect(p2.damaged).toBe(false)
    expect(p1.target?.id).toBe('n1')
  })

  it('a cannon you lose and take back starts with its own toggle on again', () => {
    const s = sim()
    const p2 = s.byId('p2')!
    s.toggleCannonAuto(p2)
    expect(p2.autoTarget).toBe(false)
    for (let i = 0; i < TUNING.captureThreshold; i++) p2.receiveHit('enemy', 1)
    expect(p2.side).toBe('enemy')
    expect(s.toggleCannonAuto(p2)).toBe(null) // not yours: nothing to toggle
    // Retake it with a real shot so the capture goes through the sim.
    const p1 = s.byId('p1')!
    p1.setTarget(p2)
    p1.snapToAim()
    run(s, 12_000, () => p2.side === 'player')
    expect(p2.side).toBe('player')
    expect(p2.autoTarget).toBe(true)
  })

  it('puzzles never auto-target, whatever the toggles say', () => {
    const s = sim('puzzle')
    expect(s.autoTargets(s.byId('p1')!)).toBe(false)
    run(s, 15_000)
    const n1 = s.byId('n1')!
    expect(n1.side).toBe('player')
    expect(n1.aim()).toBe(null)
    expect(s.byId('p1')!.aim()).toBe(null)
  })

  it("Impossible's look-ahead copies see your toggles", () => {
    const s = sim()
    s.toggleCannonAuto(s.byId('p1')!)
    s.setAutoTarget(false)
    const f = s.fork()
    expect(f.autoTarget).toBe(false)
    expect(f.byId('p1')!.autoTarget).toBe(false)
    expect(f.autoTargets(f.byId('p2')!)).toBe(false)
    // Gold's cannons in a copy keep re-aiming (they stand in for the AI).
    expect(f.autoTargets(f.byId('e1')!)).toBe(true)
  })

  it('the AI is unaffected: an AI-vs-AI round plays out the same with the setting on or off', () => {
    const play = (on: boolean) => {
      const lv = withDifficulty({ ...mirrored(3), kind: 'battle' }, 'hard')
      const s = new BattleSim(lv, null, {}, levelLanes(lv))
      s.addAi('player', 'hard')
      s.setAutoTarget(on)
      for (const c of s.cannons) if (c.side === 'player') s.toggleCannonAuto(c)
      run(s, 60_000)
      return { ended: s.ended, clock: Math.round(s.clock), sides: s.cannons.map((c) => c.side).join() }
    }
    expect(play(false)).toEqual(play(true))
  })
})

