import { describe, expect, it } from 'vitest'
import { BattleSim } from '../src/sim/BattleSim'
import { levelLanes } from '../src/sim/solver'
import { applyOrder, parseOrder } from '../src/sim/orders'
import { Predictor } from '../src/net/predict'
import { applySnap, encodeSnap } from '../src/net/snapshot'
import type { Cannon } from '../src/entities/Cannon'
import type { LevelDef } from '../src/types'

const FRAME = 1000 / 60

function level(kind: 'battle' | 'puzzle' = 'battle', aims?: number): LevelDef {
  return {
    id: 'stop-' + kind,
    name: 'Stop',
    kind,
    aims,
    walls: [],
    fans: [],
    cannons: [
      { id: 'p1', name: 'P1', x: 200, y: 300, side: 'player' },
      { id: 'p2', name: 'P2', x: 200, y: 500, side: 'player' },
      { id: 'n1', name: 'N1', x: 420, y: 400, side: 'neutral' },
      { id: 'n2', name: 'N2', x: 420, y: 650, side: 'neutral' },
      { id: 'e1', name: 'E1', x: 1000, y: 400, side: 'enemy' },
    ],
  }
}

function sim(kind: 'battle' | 'puzzle' = 'battle', aims?: number): BattleSim {
  const l = level(kind, aims)
  const s = new BattleSim(l, null, {}, levelLanes(l))
  ;(s as unknown as { aiOff: boolean }).aiOff = true
  s.countdown = 0
  return s
}

function run(s: BattleSim, ms: number): void {
  const end = s.clock + ms
  while (s.clock < end - 1e-6 && !s.ended) s.step(FRAME)
}

const by = (s: BattleSim, id: string): Cannon => s.byId(id)!
const shots = (c: Cannon): number => (c as unknown as { shotsFired: number }).shotsFired

describe('Stop aiming', () => {
  it('clears the aim and the cannon holds its fire until aimed again', () => {
    const s = sim()
    const [p1, n1] = [by(s, 'p1'), by(s, 'n1')]
    expect(s.playerAim(p1, n1)).toBe(true)
    run(s, 1500)
    expect(shots(p1)).toBeGreaterThan(0)
    expect(s.playerStop(p1)).toBe(true)
    expect(p1.aim()).toBeNull()
    const fired = shots(p1)
    const angle = p1.angle
    run(s, 4000)
    expect(shots(p1)).toBe(fired)
    // The barrel stays where it was.
    expect(p1.angle).toBeCloseTo(angle, 6)
    // Nothing left to stop.
    expect(s.playerStop(p1)).toBe(false)
    // A new aim brings it back.
    expect(s.playerAim(p1, n1)).toBe(true)
    run(s, 1500)
    expect(shots(p1)).toBeGreaterThan(fired)
  })

  it('auto-target does not re-pick for a stopped cannon when another target falls', () => {
    const s = sim()
    const [p1, p2, n2] = [by(s, 'p1'), by(s, 'p2'), by(s, 'n2')]
    expect(s.autoTargets(p1)).toBe(true)
    s.playerAim(p1, by(s, 'n1'))
    run(s, 300)
    s.playerStop(p1)
    s.playerAim(p2, n2)
    run(s, 20_000)
    expect(n2.side).toBe('player')
    expect(p1.aim()).toBeNull()
  })

  it('also ends a heal', () => {
    const s = sim()
    const [p1, p2] = [by(s, 'p1'), by(s, 'p2')]
    p2.captureAttacker = 'enemy'
    p2.captureProgress = 0.5
    expect(s.playerAim(p1, p2)).toBe(true)
    expect(p1.healing).toBe(p2)
    expect(s.playerStop(p1)).toBe(true)
    expect(p1.healing).toBeNull()
    expect(p1.aim()).toBeNull()
  })

  it('only works on your own cannons', () => {
    const s = sim()
    expect(s.playerStop(by(s, 'e1'))).toBe(false)
    expect(s.playerStop(by(s, 'n1'))).toBe(false)
  })

  it('paused: queues the stop (shown with the queued orders) and applies it on resume', () => {
    const s = sim()
    const [p1, n1] = [by(s, 'p1'), by(s, 'n1')]
    s.playerAim(p1, n1)
    s.pause()
    expect(s.playerStop(p1)).toBe(true)
    expect(p1.target).toBe(n1)
    expect(s.queuedStop(p1)).toBe(true)
    expect(s.queuedOrders()).toEqual([{ cannon: p1, aim: null, kind: null, stop: true }])
    s.resume()
    expect(p1.aim()).toBeNull()
    expect(s.queuedOrders()).toHaveLength(0)
  })

  it('paused: a later aim replaces a queued stop, and a stop cancels a queued aim', () => {
    const s = sim()
    const [p1, p2, n1] = [by(s, 'p1'), by(s, 'p2'), by(s, 'n1')]
    s.playerAim(p1, n1)
    s.pause()
    s.playerStop(p1)
    s.playerAim(p1, { x: 500, y: 200 })
    expect(s.queuedStop(p1)).toBe(false)
    // p2 has no aim: stopping it only cancels its queued aim.
    s.playerAim(p2, n1)
    expect(s.playerStop(p2)).toBe(true)
    expect(s.queuedAim(p2)).toBeNull()
    expect(s.queuedStop(p2)).toBe(false)
    expect(s.playerStop(p2)).toBe(false)
    s.resume()
    expect(p1.aimPoint).toEqual({ x: 500, y: 200 })
    expect(p2.aim()).toBeNull()
  })

  it('puzzles: stopping never spends an aim, and cancelling a queued aim gives it back', () => {
    const s = sim('puzzle', 2)
    const [p1, p2, n1] = [by(s, 'p1'), by(s, 'p2'), by(s, 'n1')]
    s.playerAim(p1, n1)
    expect(s.aimsLeft).toBe(1)
    expect(s.playerStop(p1)).toBe(true)
    expect(s.aimsLeft).toBe(1)
    s.pause()
    s.playerAim(p2, n1)
    expect(s.aimsLeft).toBe(0)
    s.playerStop(p2)
    expect(s.aimsLeft).toBe(1)
  })

  it('is an order like the others: checked from the network and applied for either side', () => {
    expect(parseOrder(JSON.parse(JSON.stringify({ t: 'stop', cannon: 'p1' })))).toEqual({ t: 'stop', cannon: 'p1' })
    expect(parseOrder({ t: 'stop' })).toBeNull()
    expect(parseOrder({ t: 'stop', cannon: 7 })).toBeNull()
    const s = sim()
    const [p1, n1] = [by(s, 'p1'), by(s, 'n1')]
    s.playerAim(p1, n1)
    expect(applyOrder(s, 'player', { t: 'stop', cannon: 'p1' }).ok).toBe(true)
    expect(p1.aim()).toBeNull()
    expect(applyOrder(s, 'player', { t: 'stop', cannon: 'nope' }).ok).toBe(false)
  })

  it('online: a queued stop travels in the snapshot', () => {
    const host = sim()
    const p1 = by(host, 'p1')
    host.playerAim(p1, by(host, 'n1'))
    host.pause()
    host.playerStop(p1)
    const snap = encodeSnap(host, 1, 'player')
    const view = sim()
    applySnap(view, snap, snap, 0, snap, false, FRAME)
    expect(view.queuedStop(by(view, 'p1'))).toBe(true)
  })

  it('online: the client shows the stop at once (and as a queued ghost when paused)', () => {
    const view = sim()
    const [p1, n1] = [by(view, 'p1'), by(view, 'n1')]
    view.playerAim(p1, n1)
    const p = new Predictor()
    p.add(1, { t: 'stop', cannon: 'p1' }, 0)
    p.apply(view, 1, 1, 0, FRAME)
    expect(p1.aim()).toBeNull()

    const paused = sim()
    const q1 = by(paused, 'p1')
    paused.playerAim(q1, by(paused, 'n1'))
    paused.pause()
    const pp = new Predictor()
    pp.add(1, { t: 'stop', cannon: 'p1' }, 0)
    pp.apply(paused, 1, 1, 0, FRAME)
    expect(paused.queuedStop(q1)).toBe(true)
    expect(q1.aim()).not.toBeNull()
  })
})
