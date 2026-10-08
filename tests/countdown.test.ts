import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning'
import { BattleSim } from '../src/sim/BattleSim'
import { applySnap, encodeSnap } from '../src/net/snapshot'
import type { AiLevel, LevelDef } from '../src/types'

const STEP = 1000 / 60
const run = (sim: BattleSim, ms: number, each?: () => void) => {
  for (let t = 0; t < ms - 1e-6; t += STEP) {
    sim.step(STEP)
    each?.()
  }
}

/** Open board, three a side; pink's map aims point at an empty corner (the AI must decide for itself). */
const open = (difficulty: AiLevel = 'hard'): LevelDef => ({
  id: 'countdown-open',
  name: 'Countdown',
  kind: 'battle',
  ai: { difficulty },
  walls: [],
  fans: [],
  cannons: [
    { id: 'p1', name: 'P1', x: 200, y: 160, side: 'player', aimAt: 'e1' },
    { id: 'p2', name: 'P2', x: 200, y: 360, side: 'player', aimAt: 'e2' },
    { id: 'p3', name: 'P3', x: 200, y: 560, side: 'player', aimAt: 'e3' },
    { id: 'e1', name: 'E1', x: 760, y: 160, side: 'enemy', aimPoint: { x: 1150, y: 20 } },
    { id: 'e2', name: 'E2', x: 760, y: 360, side: 'enemy', aimPoint: { x: 1150, y: 20 } },
    { id: 'e3', name: 'E3', x: 760, y: 560, side: 'enemy', aimPoint: { x: 1150, y: 20 } },
  ],
})

describe('pre-round countdown', () => {
  it('headless rounds have none (tests, benchmarks): firing starts at once', () => {
    const sim = new BattleSim(open())
    expect(sim.countdown).toBe(0)
    run(sim, 100)
    expect(sim.shots.length).toBeGreaterThan(0)
  })

  it('nothing fires and the clock stands still, but barrels turn and orders apply; at Go timers start fresh, per side', () => {
    const sim = new BattleSim(open())
    sim.ai.update = () => {}
    sim.startCountdown(TUNING.countdownMs)
    const p1 = sim.byId('p1')!
    const e3 = sim.byId('e3')!
    run(sim, 1000)
    expect(sim.clock).toBe(0)
    expect(sim.shots.length).toBe(0)
    // An order during the countdown applies at once, and the barrel turns toward it.
    expect(sim.playerAim(p1, e3)).toBe(true)
    expect(p1.target).toBe(e3)
    const before = p1.aimErrorDeg()
    run(sim, 300)
    expect(p1.aimErrorDeg()).toBeLessThan(before)
    // A type swap during the countdown reloads during it.
    expect(sim.playerSwap(sim.byId('p2')!, 'machinegun')).toBe(true)
    sim.setAutoTarget(false)
    expect(sim.autoTarget).toBe(false)
    let goes = 0
    ;(sim as unknown as { events: { go: () => void } }).events.go = () => goes++
    const fired: [string, number][] = []
    run(sim, (TUNING.countdownMs / STEP - 79) * STEP)
    expect(sim.countdown).toBeGreaterThan(0)
    expect(sim.shots.length).toBe(0)
    run(sim, STEP)
    expect(sim.countdown).toBe(0)
    expect(goes).toBe(1)
    const seen = new Set<number>()
    run(sim, 400, () => {
      for (const s of sim.shots) if (!seen.has(s.id)) {
        seen.add(s.id)
        fired.push([s.ball.ownerId, Math.round(sim.clock)])
      }
    })
    // Gold: P1 at once (it had all countdown to turn), P2 (swapped early, reloaded during the countdown) at +90, P3 at +180.
    const at = (id: string) => fired.find((f) => f[0] === id)?.[1]
    expect(at('p1')).toBeLessThanOrEqual(STEP + 1)
    expect(at('p2')).toBeGreaterThan(80)
    expect(at('p2')).toBeLessThan(120)
    expect(at('p3')).toBeGreaterThan(170)
    expect(at('p3')).toBeLessThan(210)
    expect(sim.clock).toBeGreaterThan(390)
  })

  it('a late swap still finishes its reload after Go', () => {
    const sim = new BattleSim(open())
    sim.ai.update = () => {}
    sim.startCountdown(TUNING.countdownMs)
    run(sim, TUNING.countdownMs - 500)
    sim.playerSwap(sim.byId('p1')!, 'sniper')
    const lock = sim.byId('p1')!.netState().swapLeft
    run(sim, 500 + STEP)
    const seen: number[] = []
    run(sim, lock, () => {
      if (sim.shots.some((s) => s.ball.ownerId === 'p1') && !seen.length) seen.push(sim.clock)
    })
    expect(seen.length ? seen[0] : Infinity).toBeGreaterThanOrEqual(lock - 500 - 2 * STEP)
  })

  it('a pause holds the countdown (single player); in player vs player there is no pausing during it', () => {
    const sim = new BattleSim(open())
    sim.startCountdown(3000)
    run(sim, 500)
    expect(sim.pause()).toBe(true)
    run(sim, 2000)
    expect(sim.countdown).toBeCloseTo(2500, 0)
    sim.resume()
    const pvp = new BattleSim(open())
    pvp.makePvp()
    pvp.startCountdown(3000)
    run(pvp, 500)
    expect(pvp.pause()).toBe(false)
    run(pvp, 2600)
    expect(pvp.countdown).toBe(0)
    expect(pvp.pause()).toBe(true)
  })

  it('network views show the countdown from snapshots, and it is gone after Go', () => {
    const host = new BattleSim(open())
    host.makePvp()
    host.startCountdown(3000)
    run(host, 1000)
    const s1 = encodeSnap(host, 60, 'enemy')
    expect(s1.cd).toBe(2000)
    const view = new BattleSim(open())
    applySnap(view, s1, s1, 0, s1, true, STEP)
    expect(view.countdown).toBe(2000)
    run(host, 2100)
    const s2 = encodeSnap(host, 186, 'enemy')
    expect(s2.cd).toBeUndefined()
    applySnap(view, s1, s2, 0.5, s2, true, STEP)
    expect(view.countdown).toBe(1000)
    applySnap(view, s2, s2, 0, s2, true, STEP)
    expect(view.countdown).toBe(0)
  })
})

describe('the AI uses the countdown', () => {
  /** Each pink cannon's first shot after Go: when, at which job target, how lined up, and how close it passes the target. */
  function firstShots(difficulty: AiLevel) {
    const sim = new BattleSim(open(difficulty))
    sim.startCountdown(TUNING.countdownMs)
    for (const c of sim.cannons) if (c.side === 'player') c.clearAim()
    const jobs = (sim.ai as unknown as { jobs: Map<unknown, { target: { id: string; x: number; y: number } }> }).jobs
    const out = new Map<string, { at: number; job: string; err: number; miss: number }>()
    const seen = new Set<number>()
    let steps = 0
    while (sim.countdown > 0 && steps++ < 1000) sim.step(STEP)
    for (let i = 0; i < 60; i++) {
      sim.step(STEP)
      for (const s of sim.shots) {
        if (seen.has(s.id)) continue
        seen.add(s.id)
        const c = sim.byId(s.ball.ownerId)!
        if (c.side !== 'enemy' || out.has(c.id)) continue
        const t = jobs.get(c)!.target
        // Distance from the target's centre to the shot's line.
        const { x, y, vx, vy } = s.ball
        const v = Math.hypot(vx, vy)
        const miss = Math.abs((t.x - x) * vy - (t.y - y) * vx) / v
        out.set(c.id, { at: Math.round(sim.clock), job: t.id, err: c.aimErrorDeg(), miss })
      }
    }
    return out
  }

  it('Hard: every first shot leaves right at Go (volley offsets only), lined up on its own job, mostly on target', () => {
    const shots = firstShots('hard')
    expect([...shots.keys()].sort()).toEqual(['e1', 'e2', 'e3'])
    let onTarget = 0
    for (const [, s] of shots) {
      expect(s.at).toBeLessThanOrEqual(2 * TUNING.fireStaggerMs + 2 * STEP)
      expect(s.err).toBeLessThanOrEqual(TUNING.aimToleranceDeg)
      // Aimed at a gold cannon it chose (not the map's empty corner).
      expect(s.job).toMatch(/^p/)
      // Hard aims within its lane (a small aim error, never wild).
      expect(s.miss).toBeLessThan(TUNING.cannonRadius * 2)
      if (s.miss <= TUNING.cannonRadius + TUNING.shotRadius) onTarget++
    }
    expect(onTarget).toBeGreaterThanOrEqual(2)
  })

  it('Impossible: every first shot is dead on', () => {
    for (const [, s] of firstShots('impossible')) {
      expect(s.at).toBeLessThanOrEqual(2 * TUNING.fireStaggerMs + 2 * STEP)
      expect(s.miss).toBeLessThan(TUNING.cannonRadius)
    }
  })
})
