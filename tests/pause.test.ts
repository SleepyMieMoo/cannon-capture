import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning'
import { BattleSim } from '../src/sim/BattleSim'
import { levelLanes } from '../src/sim/solver'
import { withDifficulty } from '../src/editor/maps'
import type { AiLevel, LevelDef } from '../src/types'
import type { Cannon } from '../src/entities/Cannon'
import { mirrored } from './helpers/arena'

const FRAME = 1000 / 60

function run(sim: BattleSim, ms: number): void {
  const end = sim.clock + ms
  while (sim.clock < end - 1e-6 && !sim.ended) sim.step(FRAME)
}

function battle(seed: number, ai: AiLevel): BattleSim {
  const level = withDifficulty(mirrored(seed), ai)
  return new BattleSim(level, null, {}, levelLanes(level))
}

/** Everything that moves in a round, as one comparable value. */
function snapshot(sim: BattleSim): string {
  const cannon = (c: Cannon) => {
    const x = c as unknown as Record<string, unknown>
    return [c.id, c.side, c.kind, c.angle, x.cooldown, x.swapLeft, c.captureAttacker, c.captureProgress, c.shieldHp, c.shieldDown, c.target?.id ?? null, c.aimPoint]
  }
  return JSON.stringify({
    clock: sim.clock,
    ai: sim.ais.map((ai) => [ai.clock, ...sim.cannons.map((c) => ai.nextThinkAt(c) ?? null)]),
    cannons: sim.cannons.map(cannon),
    shots: sim.shots.map((s) => [s.ball.x, s.ball.y, s.ball.vx, s.ball.vy]),
  })
}

/** P1 and P2 by a neutral; gold far off and held still. */
function small(kind: 'battle' | 'puzzle' = 'battle', aims?: number): LevelDef {
  return {
    id: 'pause-' + kind,
    name: 'Pause',
    kind,
    aims,
    walls: [],
    fans: [],
    cannons: [
      { id: 'p1', name: 'P1', x: 200, y: 300, side: 'player' },
      { id: 'p2', name: 'P2', x: 200, y: 500, side: 'player' },
      { id: 'p3', name: 'P3', x: 200, y: 640, side: 'player' },
      { id: 'n1', name: 'N1', x: 420, y: 400, side: 'neutral' },
      { id: 'e1', name: 'E1', x: 1000, y: 400, side: 'enemy' },
    ],
  }
}

function smallSim(kind: 'battle' | 'puzzle' = 'battle', aims?: number): BattleSim {
  const level = small(kind, aims)
  const sim = new BattleSim(level, null, {}, levelLanes(level))
  ;(sim as unknown as { aiOff: boolean }).aiOff = true
  return sim
}

const byId = (sim: BattleSim, id: string) => sim.cannons.find((c) => c.id === id)!

describe('tactical pause', () => {
  it('freezes the whole round: clock, shots, turning, reloads, barriers, capture meters, AI', () => {
    const sim = battle(7, 'impossible')
    sim.addAi('player', 'hard')
    run(sim, 6000)
    // A cannon mid-swap and a dented barrier, so reloads and regen are in play.
    const p = sim.cannons.find((c) => c.side === 'player')!
    p.setKind(p.kind === 'shield' ? 'sniper' : 'shield')
    p.shieldHp = TUNING.shield.hp / 2
    p.shieldCalm = 1e9
    run(sim, 200)
    expect(sim.shots.length + sim.cannons.filter((c) => c.captureProgress > 0).length).toBeGreaterThan(0)
    expect(sim.pause()).toBe(true)
    const before = snapshot(sim)
    for (let i = 0; i < 600; i++) sim.step(FRAME)
    expect(snapshot(sim)).toBe(before)
    sim.resume()
    sim.step(FRAME)
    expect(snapshot(sim)).not.toBe(before)
  })

  it('queues aims and swaps while paused and applies them all on resume', () => {
    const sim = smallSim()
    const [p1, p2, n1] = [byId(sim, 'p1'), byId(sim, 'p2'), byId(sim, 'n1')]
    run(sim, 500)
    sim.pause()
    const point = { x: 500, y: 300 }
    expect(sim.playerAim(p1, point)).toBe(true)
    expect(sim.playerAim(p2, n1)).toBe(true)
    expect(sim.playerSwap(p2, 'sniper')).toBe(true)
    // Nothing happens yet: only queued.
    expect(p1.aimPoint).toBeNull()
    expect(p2.target).toBeNull()
    expect(p2.kind).toBe('normal')
    expect(sim.queuedAim(p1)).toEqual(point)
    expect(sim.queuedAim(p2)).toBe(n1)
    expect(sim.queuedKind(p2)).toBe('sniper')
    expect(sim.queuedOrders()).toHaveLength(2)
    sim.resume()
    expect(p1.aimPoint).toEqual(point)
    expect(p2.target).toBe(n1)
    expect(p2.kind).toBe('sniper')
    expect(sim.queuedOrders()).toHaveLength(0)
    expect(sim.queuedKind(p2)).toBeNull()
  })

  it('starts a queued swap’s reload at resume, not when it was queued', () => {
    const sim = smallSim()
    const p2 = byId(sim, 'p2')
    run(sim, 500)
    sim.pause()
    sim.playerSwap(p2, 'sniper')
    for (let i = 0; i < 300; i++) sim.step(FRAME) // five paused seconds
    expect(p2.swapping).toBe(false)
    sim.resume()
    expect(p2.swapping).toBe(true)
    const lock = Math.max(TUNING.swapLockMs, p2.fireMs())
    expect((p2 as unknown as { swapLeft: number }).swapLeft).toBeCloseTo(lock, 6)
    run(sim, lock - 100)
    expect(p2.swapping).toBe(true)
    run(sim, 200)
    expect(p2.swapping).toBe(false)
  })

  it('picking the current type again cancels a queued swap', () => {
    const sim = smallSim()
    const p1 = byId(sim, 'p1')
    sim.pause()
    sim.playerSwap(p1, 'machinegun')
    sim.playerSwap(p1, 'sniper')
    expect(sim.queuedKind(p1)).toBe('sniper')
    expect(sim.playerSwap(p1, 'normal')).toBe(true)
    expect(sim.queuedKind(p1)).toBeNull()
    sim.resume()
    expect(p1.kind).toBe('normal')
    expect(p1.swapping).toBe(false)
  })

  it('puzzles: queued aims count against the aim budget; re-aiming a queued cannon is free', () => {
    const sim = smallSim('puzzle', 2)
    const [p1, p2, p3, n1] = [byId(sim, 'p1'), byId(sim, 'p2'), byId(sim, 'p3'), byId(sim, 'n1')]
    sim.pause()
    expect(sim.playerAim(p1, n1)).toBe(true)
    expect(sim.aimsLeft).toBe(1)
    expect(sim.playerAim(p1, { x: 400, y: 200 })).toBe(true)
    expect(sim.aimsLeft).toBe(1)
    expect(sim.playerAim(p2, n1)).toBe(true)
    expect(sim.aimsLeft).toBe(0)
    expect(sim.playerAim(p3, n1)).toBe(false)
    sim.resume()
    expect(sim.aimsLeft).toBe(0)
    expect(p1.aimPoint).toEqual({ x: 400, y: 200 })
    expect(p2.target).toBe(n1)
    expect(p3.target).toBeNull()
  })

  it('Impossible re-thinks every cannon the moment you resume', () => {
    const sim = battle(3, 'impossible')
    run(sim, 8000)
    sim.pause()
    sim.resume()
    const ai = sim.ai
    const mine = () => sim.cannons.filter((c) => c.side === 'enemy' && !c.healing)
    expect(mine().length).toBeGreaterThan(0)
    for (const c of mine()) expect(ai.nextThinkAt(c)).toBe(ai.clock)
    sim.step(FRAME)
    const thinkMs = ai.timing.thinkMs
    for (const c of mine()) expect(ai.nextThinkAt(c)).toBeCloseTo(ai.clock + thinkMs, 6)
  })

  it('Impossible may drop a fresh commitment after a pause (it weighs every cannon again)', () => {
    let tried = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = battle(seed, 'impossible')
      run(sim, 5000)
      const ai = sim.ai as unknown as { jobs: Map<Cannon, { since: number; kind: string }>; deliberating: { cannon: Cannon }[]; timing: { commitMs: number } }
      sim.pause()
      sim.resume()
      sim.step(FRAME)
      for (const [c, job] of ai.jobs) {
        if (job.kind !== 'attack' || sim.ai.clock - job.since >= ai.timing.commitMs) continue
        // Committed, yet it is weighing its options again.
        if (ai.deliberating.some((d) => d.cannon === c)) tried += 1
      }
    }
    expect(tried).toBeGreaterThan(0)
  })

  it('other levels keep their normal pace: no forced think on resume', () => {
    for (const level of ['easy', 'normal', 'hard'] as AiLevel[]) {
      const sim = battle(3, level)
      run(sim, 8000)
      const ai = sim.ai
      const before = sim.cannons.map((c) => ai.nextThinkAt(c))
      sim.pause()
      sim.resume()
      expect(sim.cannons.map((c) => ai.nextThinkAt(c))).toEqual(before)
    }
  })

  it('can’t pause a finished round; resume without pause is harmless', () => {
    const sim = smallSim()
    expect(sim.resume()).toBeUndefined()
    sim.ended = 'win'
    expect(sim.pause()).toBe(false)
    expect(sim.paused).toBe(false)
  })

  it('look-ahead copies never inherit a pause or queued orders', () => {
    const sim = smallSim()
    sim.pause()
    sim.playerSwap(byId(sim, 'p1'), 'sniper')
    const copy = sim.fork()
    expect(copy.paused).toBe(false)
    expect(copy.queuedOrders()).toHaveLength(0)
  })
})
