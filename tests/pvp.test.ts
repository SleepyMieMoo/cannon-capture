import { describe, expect, it } from 'vitest'
import { BattleSim, type SimEvents } from '../src/sim/BattleSim'
import { applyOrder, parseOrder, type Order } from '../src/sim/orders'
import { FixedStep, SIM_STEP_MS } from '../src/sim/fixedStep'
import { levelLanes } from '../src/sim/solver'
import { withDifficulty } from '../src/editor/maps'
import { encodeSnap, applySnap, sideMapper } from '../src/net/snapshot'
import { PvpClient, PvpHost, flipLevel, joinRoom, type StartMsg } from '../src/net/pvp'
import { loopbackPair } from '../src/net/transport'
import type { LevelDef } from '../src/types'
import { mirrored } from './helpers/arena'

const FRAME = 1000 / 60

/** Two gold, two pink, one neutral in the middle. */
function duel(): LevelDef {
  return {
    id: 'duel',
    name: 'Duel',
    kind: 'battle',
    walls: [{ x: 580, y: 120, w: 40, h: 160 }],
    fans: [],
    cannons: [
      { id: 'g1', name: 'G1', x: 200, y: 260, side: 'player' },
      { id: 'g2', name: 'G2', x: 200, y: 520, side: 'player' },
      { id: 'p1', name: 'P1', x: 1000, y: 260, side: 'enemy' },
      { id: 'p2', name: 'P2', x: 1000, y: 520, side: 'enemy' },
      { id: 'n1', name: 'N1', x: 600, y: 420, side: 'neutral' },
    ],
  }
}

function pvpSim(level = duel(), events: SimEvents = {}): BattleSim {
  const sim = new BattleSim(level, null, events, levelLanes(level))
  sim.makePvp()
  return sim
}

/** Everything that moves in a round, as one comparable value. */
function state(sim: BattleSim): string {
  return JSON.stringify({
    clock: sim.clock,
    ended: sim.ended,
    cannons: sim.cannons.map((c) => [c.id, c.side, c.kind, c.angle, c.target?.id ?? null, c.aimPoint, c.captureProgress, c.autoTarget]),
    shots: sim.shots.map((s) => [s.ball.x, s.ball.y, s.ball.vx, s.ball.vy]),
  })
}

describe('one order API', () => {
  it('the screen and the network take the same orders, and single player plays out exactly as with the direct calls', () => {
    const level = withDifficulty(mirrored(3), 'hard')
    const a = new BattleSim(level, null, {}, levelLanes(level))
    const b = new BattleSim(level, null, {}, levelLanes(level))
    const gold = a.cannons.filter((c) => c.side === 'player')
    const foe = a.cannons.find((c) => c.side === 'enemy')!
    // Direct calls on one round, orders on the other.
    a.playerAim(gold[0], foe)
    expect(applyOrder(b, 'player', { t: 'aim', cannon: gold[0].id, at: { cannon: foe.id } }).ok).toBe(true)
    a.playerAim(gold[1], { x: 700, y: 300 })
    expect(applyOrder(b, 'player', { t: 'aim', cannon: gold[1].id, at: { x: 700, y: 300 } }).ok).toBe(true)
    a.playerSwap(gold[0], 'sniper')
    expect(applyOrder(b, 'player', { t: 'swap', cannon: gold[0].id, kind: 'sniper' }).ok).toBe(true)
    const on = a.toggleCannonAuto(gold[1])
    expect(applyOrder(b, 'player', { t: 'auto', cannon: gold[1].id })).toEqual({ ok: true, on })
    for (let i = 0; i < 900; i++) {
      a.step(FRAME)
      b.step(FRAME)
    }
    a.setAutoTarget(false)
    expect(applyOrder(b, 'player', { t: 'autoAll', on: false }).ok).toBe(true)
    a.pause()
    expect(applyOrder(b, 'player', { t: 'pause' }).ok).toBe(true)
    expect(applyOrder(b, 'player', { t: 'pause' }).ok).toBe(false)
    a.resume()
    expect(applyOrder(b, 'player', { t: 'resume' }).ok).toBe(true)
    for (let i = 0; i < 900; i++) {
      a.step(FRAME)
      b.step(FRAME)
    }
    expect(state(b)).toBe(state(a))
  })

  it("refuses orders for the other side's cannons, and for the AI's side in single player", () => {
    const sp = new BattleSim(duel(), null, {})
    expect(applyOrder(sp, 'enemy', { t: 'aim', cannon: 'p1', at: { cannon: 'g1' } }).ok).toBe(false)
    expect(applyOrder(sp, 'player', { t: 'aim', cannon: 'p1', at: { cannon: 'g1' } }).ok).toBe(false)
    expect(applyOrder(sp, 'player', { t: 'swap', cannon: 'n1', kind: 'shield' }).ok).toBe(false)
    expect(applyOrder(sp, 'player', { t: 'aim', cannon: 'nope', at: { cannon: 'g1' } }).ok).toBe(false)
    expect(applyOrder(sp, 'player', { t: 'aim', cannon: 'g1', at: { cannon: 'g1' } }).ok).toBe(false)
    const pvp = pvpSim()
    expect(applyOrder(pvp, 'enemy', { t: 'aim', cannon: 'p1', at: { cannon: 'g1' } }).ok).toBe(true)
    expect(pvp.byId('p1')!.target?.id).toBe('g1')
    expect(applyOrder(pvp, 'enemy', { t: 'aim', cannon: 'g1', at: { cannon: 'p1' } }).ok).toBe(false)
    expect(applyOrder(pvp, 'enemy', { t: 'auto', cannon: 'g2' }).ok).toBe(false)
    // Each side has its own Settings auto-target toggle.
    applyOrder(pvp, 'enemy', { t: 'autoAll', on: false })
    expect(pvp.autoTargetOf('enemy')).toBe(false)
    expect(pvp.autoTargetOf('player')).toBe(true)
    // Points off the board are pulled back onto it.
    expect(applyOrder(pvp, 'player', { t: 'aim', cannon: 'g1', at: { x: -5000, y: 99999 } }).ok).toBe(true)
    const p = pvp.byId('g1')!.aimPoint!
    expect(p.x).toBeGreaterThanOrEqual(pvp.board.x)
    expect(p.y).toBeLessThanOrEqual(pvp.board.y + pvp.board.h)
  })

  it('checks the shape of orders from the network', () => {
    const good: Order[] = [
      { t: 'aim', cannon: 'p1', at: { cannon: 'g1' } },
      { t: 'aim', cannon: 'p1', at: { x: 10, y: 20 } },
      { t: 'swap', cannon: 'p1', kind: 'machinegun' },
      { t: 'auto', cannon: 'p1' },
      { t: 'autoAll', on: true },
      { t: 'pause' },
      { t: 'resume' },
    ]
    for (const o of good) expect(parseOrder(JSON.parse(JSON.stringify(o)))).toEqual(o)
    const bad = [
      null,
      7,
      'aim',
      {},
      { t: 'aim', cannon: 'p1' },
      { t: 'aim', cannon: 'p1', at: { x: 'a', y: 2 } },
      { t: 'aim', cannon: 'p1', at: { x: Infinity, y: 2 } },
      { t: 'aim', cannon: 5, at: { cannon: 'g1' } },
      { t: 'swap', cannon: 'p1', kind: 'laser' },
      { t: 'autoAll', on: 'yes' },
      { t: 'restart' },
      { t: 'aim', cannon: 'x'.repeat(200), at: { cannon: 'g1' } },
    ]
    for (const o of bad) expect(parseOrder(o)).toBeNull()
  })
})

describe('fixed timestep', () => {
  it('runs one step per 1/60 s whatever the frame rate, and slows down (not jumps) after a long frame', () => {
    const f = new FixedStep(SIM_STEP_MS, 2)
    let steps = 0
    // 120 Hz screen for a second: 60 steps.
    for (let i = 0; i < 120; i++) steps += f.take(1000 / 120)
    expect(steps).toBe(60)
    // 50 Hz: still 60 steps a second (some frames take two).
    f.reset()
    steps = 0
    for (let i = 0; i < 50; i++) steps += f.take(20)
    expect(Math.abs(steps - 60)).toBeLessThanOrEqual(1)
    // A 500 ms hitch runs at most two steps and forgets the rest.
    f.reset()
    expect(f.take(500)).toBe(2)
    expect(f.alpha).toBe(0)
    expect(f.take(SIM_STEP_MS / 2)).toBe(0)
    expect(f.alpha).toBeCloseTo(0.5)
  })
})

describe('player vs player rules (provisional)', () => {
  it('has no AI, and a side wins once the other holds no cannons (neutrals may be left)', () => {
    const sim = pvpSim()
    expect(sim.ais).toHaveLength(0)
    expect(sim.isHuman('enemy')).toBe(true)
    sim.byId('p1')!.side = 'player'
    sim.byId('p2')!.side = 'player'
    sim.step(FRAME)
    expect(sim.ended).toBe('win')
    expect(sim.winner).toBe('player')
    const other = pvpSim()
    other.byId('g1')!.side = 'enemy'
    other.byId('g2')!.side = 'neutral'
    other.step(FRAME)
    expect(other.winner).toBe('enemy')
  })

  it("keeps each side's queued orders (paused) apart", () => {
    const sim = pvpSim()
    applyOrder(sim, 'player', { t: 'pause' })
    expect(applyOrder(sim, 'player', { t: 'swap', cannon: 'g1', kind: 'sniper' }).ok).toBe(true)
    expect(applyOrder(sim, 'enemy', { t: 'swap', cannon: 'p1', kind: 'shield' }).ok).toBe(true)
    expect(sim.queuedOrders('player').map((q) => q.cannon.id)).toEqual(['g1'])
    expect(sim.queuedOrders('enemy').map((q) => q.cannon.id)).toEqual(['p1'])
    // Either player may resume (provisional); both queues run.
    expect(applyOrder(sim, 'enemy', { t: 'resume' }).ok).toBe(true)
    expect(sim.queuedKind(sim.byId('g1')!)).toBeNull()
    expect(sim.queuedKind(sim.byId('p1')!)).toBeNull()
  })
})

describe('snapshots', () => {
  it("a snapshot shows the host's round to the other player with the sides swapped", () => {
    const host = pvpSim()
    applyOrder(host, 'player', { t: 'aim', cannon: 'g1', at: { cannon: 'p1' } })
    applyOrder(host, 'enemy', { t: 'aim', cannon: 'p2', at: { cannon: 'n1' } })
    for (let i = 0; i < 200; i++) host.step(FRAME)
    expect(host.shots.length).toBeGreaterThan(0)
    const snap = JSON.parse(JSON.stringify(encodeSnap(host, 200, 'enemy')))
    const view = pvpSim(flipLevel(duel()))
    applySnap(view, snap, snap, 1, snap, true, SIM_STEP_MS)
    const map = sideMapper(true)
    for (const c of host.cannons) {
      const v = view.byId(c.id)!
      expect(v.side).toBe(map(c.side))
      expect(v.angle).toBeCloseTo(c.angle, 3)
      expect(v.captureProgress).toBeCloseTo(c.captureProgress, 3)
      expect(v.target?.id ?? null).toBe(c.target?.id ?? null)
    }
    expect(view.byId('p2')!.side).toBe('player')
    expect(view.shots.map((s) => [map(s.side), Math.round(s.ball.x), Math.round(s.ball.y)])).toEqual(
      host.shots.map((s) => [s.side, Math.round(s.ball.x), Math.round(s.ball.y)]),
    )
    expect(Math.abs(view.clock - host.clock)).toBeLessThan(1)
  })
})

describe('host and second player over a fake network', () => {
  it('the second player joins, orders pink cannons, sees the round and its events, and can not order gold', () => {
    const [hostEnd, clientEnd] = loopbackPair()
    const level = duel()
    const host = new PvpHost(hostEnd, level, 'match-1', 'enemy', SIM_STEP_MS)
    const sim = pvpSim(level, host.log.tap({}))
    host.attach(sim)
    expect(host.joined).toBe(false)

    let start: StartMsg | null = null
    const cancel = joinRoom(clientEnd, (s) => (start = s), () => {})
    hostEnd.flush()
    expect(host.joined).toBe(true)
    clientEnd.flush()
    cancel()
    expect(start).not.toBeNull()
    expect(start!.side).toBe('enemy')

    const client = new PvpClient(clientEnd, start!, true)
    const view = pvpSim(flipLevel(start!.level))
    const seen = { fired: 0, captured: 0 }
    const handlers: SimEvents = { fired: () => seen.fired++, captured: () => seen.captured++ }
    let refused = 0
    client.onRefused = () => refused++

    // Pink (gold on the second player's screen) aims both cannons at the neutral and at G1.
    expect(view.byId('p1')!.side).toBe('player')
    client.send({ t: 'aim', cannon: 'p1', at: { cannon: 'n1' } })
    client.send({ t: 'aim', cannon: 'p2', at: { cannon: 'g2' } })
    // A forged order for a gold cannon: refused by the host.
    client.send({ t: 'aim', cannon: 'g1', at: { cannon: 'p1' } })
    hostEnd.flush()
    expect(sim.byId('p1')!.target?.id).toBe('n1')
    expect(sim.byId('p2')!.target?.id).toBe('g2')
    expect(sim.byId('g1')!.target).toBeNull()

    const bytes0 = hostEnd.bytesSent
    const run = (steps: number) => {
      for (let i = 0; i < steps && !sim.ended; i++) {
        if (!sim.paused) {
          sim.step(SIM_STEP_MS)
          host.stepped()
        }
        clientEnd.flush()
        client.update(view, handlers, SIM_STEP_MS)
      }
    }
    run(60 * 8)
    expect(sim.ended).toBeNull()
    expect(refused).toBe(1)
    const seconds = sim.clock / 1000
    const perSecond = (hostEnd.bytesSent - bytes0) / seconds
    console.log(`pvp snapshot traffic: ${Math.round(perSecond)} bytes/s (JSON, ${sim.cannons.length} cannons)`)
    expect(perSecond).toBeLessThan(40_000)

    // The picture is 100 ms behind the host, and matches it (sides swapped).
    const map = sideMapper(true)
    expect(sim.clock - view.clock).toBeGreaterThan(50)
    expect(sim.clock - view.clock).toBeLessThan(200)
    for (const c of sim.cannons) expect(view.byId(c.id)!.side).toBe(map(c.side))
    expect(seen.fired).toBeGreaterThan(5)

    // Pause from the second player stops the host's round.
    client.send({ t: 'pause' })
    hostEnd.flush()
    expect(sim.paused).toBe(true)
    clientEnd.flush()
    client.update(view, handlers, SIM_STEP_MS)
    expect(view.paused).toBe(true)
    client.send({ t: 'resume' })
    hostEnd.flush()
    expect(sim.paused).toBe(false)

    // Gold never moves, so pink takes everything: the second player sees "You win".
    run(60 * 120)
    expect(sim.ended).toBe('lose')
    host.sendSnap()
    clientEnd.flush()
    client.update(view, handlers, SIM_STEP_MS)
    expect(view.ended).toBe('win')
    // The neutral went to pink, which is "yours" on the second player's screen; the captures replayed there.
    expect(sim.byId('n1')!.side).toBe('enemy')
    expect(view.byId('n1')!.side).toBe('player')
    expect(seen.captured).toBeGreaterThanOrEqual(3)

    // Leaving says goodbye.
    let left = false
    host.onPeer = (joined) => (left = !joined)
    client.close(true)
    hostEnd.flush()
    expect(left).toBe(true)
    expect(host.joined).toBe(false)
    host.close(false)
  })

  it('a second joiner is turned away while the first is playing', () => {
    const [hostEnd, clientEnd] = loopbackPair()
    const host = new PvpHost(hostEnd, duel(), 'm', 'enemy')
    host.attach(pvpSim())
    const cancel = joinRoom(clientEnd, () => {}, () => {})
    hostEnd.flush()
    cancel()
    expect(host.joined).toBe(true)
    const first = host.peerId
    // A hello from someone else on the same channel.
    const deliver = (hostEnd as unknown as { handlers: Set<(m: unknown, from: string) => void> }).handlers
    for (const fn of deliver) fn({ t: 'hello' }, 'stranger')
    const replies = (clientEnd as unknown as { inbox: string[] }).inbox.map((t) => JSON.parse(t))
    expect(replies.some((m) => m.t === 'busy')).toBe(true)
    expect(host.peerId).toBe(first)
    host.close(false)
  })

  it('a player the host gave up on (their tab was asleep) is taken back as soon as they are heard again', () => {
    const [hostEnd, clientEnd] = loopbackPair()
    const host = new PvpHost(hostEnd, duel(), 'm', 'enemy')
    host.attach(pvpSim())
    const cancel = joinRoom(clientEnd, () => {}, () => {})
    hostEnd.flush()
    cancel()
    ;(host as unknown as { dropPeer: () => void }).dropPeer()
    expect(host.joined).toBe(false)
    clientEnd.send({ t: 'ping' })
    hostEnd.flush()
    expect(host.joined).toBe(true)
    host.close(false)
  })
})
