import { describe, expect, it } from 'vitest'
import { RenderClock, RENDER_CLOCK } from '../src/net/renderClock'
import { Predictor, PREDICT } from '../src/net/predict'
import { BattleSim } from '../src/sim/BattleSim'
import { levelLanes } from '../src/sim/solver'
import { SIM_STEP_MS } from '../src/sim/fixedStep'
import { PVP_MAPS } from '../src/net/online'
import { NetMatch, rng, smoothness } from './helpers/netSim'

const FRAME = 1000 / 60
/** A cannon's target id (read through a function: TypeScript would narrow a field we just set). */
const targetOf = (c: { target: { id: string } | null }): string | undefined => c.target?.id

/** Snapshots every `gap` ms of server time, arriving after `delay` + up to `jitter` (in order). */
function feed(clock: RenderClock, opts: { gap?: number; delay: number; jitter: number; seconds: number; seed?: number; frames?: (t: number, latestMs: number, latestAt: number) => void }) {
  const gap = opts.gap ?? 50
  const r = rng(opts.seed ?? 3)
  const q: { at: number; ms: number }[] = []
  let lastDue = 0
  for (let ms = 0; ms <= opts.seconds * 1000; ms += gap) {
    const at = Math.max(lastDue, ms + opts.delay + r() * opts.jitter)
    lastDue = at
    q.push({ at, ms })
  }
  let latest: { at: number; ms: number } | null = null
  for (let t = 0; t <= opts.seconds * 1000 + opts.delay; t += FRAME) {
    while (q.length && q[0].at <= t) {
      latest = q.shift()!
      clock.arrive(latest.at, latest.ms, true)
    }
    if (latest) opts.frames?.(t, latest.ms, latest.at)
  }
}

describe('RenderClock (how far behind to draw)', () => {
  it('on a steady line draws about one snapshot gap behind, at real speed', () => {
    const c = new RenderClock()
    const steps: number[] = []
    let last = -1
    feed(c, {
      delay: 100,
      jitter: 0,
      seconds: 6,
      frames: (t, ms, at) => {
        const d = c.frame(t, FRAME, ms, at, false)
        if (t > 3000 && last >= 0) steps.push(d - last)
        last = d
      },
    })
    expect(c.stats.delayMs).toBeGreaterThanOrEqual(50)
    expect(c.stats.delayMs).toBeLessThan(80)
    for (const s of steps) expect(Math.abs(s - FRAME)).toBeLessThan(FRAME * (RENDER_CLOCK.maxLean + 0.01))
  })

  it('grows the buffer with jitter (clamped) and never runs backwards', () => {
    for (const jitter of [0, 40, 120, 600]) {
      const c = new RenderClock()
      let last = -1
      let back = 0
      let held = 0
      feed(c, {
        delay: 125,
        jitter,
        seconds: 8,
        seed: jitter + 1,
        frames: (t, ms, at) => {
          const d = c.frame(t, FRAME, ms, at, false)
          if (d < last) back++
          if (t > 4000 && d === last) held++
          last = d
        },
      })
      expect(back).toBe(0)
      expect(c.stats.delayMs).toBeLessThanOrEqual(RENDER_CLOCK.maxDelayMs)
      if (jitter === 40) {
        expect(c.stats.delayMs).toBeGreaterThan(60)
        expect(held).toBe(0)
      }
      if (jitter === 120) expect(c.stats.delayMs).toBeGreaterThan(130)
    }
  })

  it('runs a little past a late snapshot, then waits (never further than maxAheadMs)', () => {
    const c = new RenderClock()
    for (let i = 0; i < 20; i++) c.arrive(i * 50 + 100, i * 50, true)
    let d = 0
    for (let t = 1050; t < 1600; t += FRAME) d = c.frame(t, FRAME, 950, 1050, false)
    expect(d).toBeLessThanOrEqual(950 + RENDER_CLOCK.maxAheadMs)
    expect(d).toBeGreaterThan(950)
    expect(c.stats.heldFrames).toBeGreaterThan(0)
  })

  it('paused or over: draws up to the newest picture and stops there; starts over after a pause', () => {
    const c = new RenderClock()
    for (let i = 0; i < 20; i++) c.arrive(i * 50 + 100, i * 50, true)
    let d = 0
    for (let t = 1050; t < 1800; t += FRAME) d = c.frame(t, FRAME, 950, 1050, true)
    expect(d).toBe(950)
    c.arrive(1800, 950, false)
    // Resumed 5 s later: the old link between the clocks is gone, no big jump ahead.
    for (let i = 0; i < 6; i++) c.arrive(6000 + i * 50, 950 + i * 50, true)
    const before = d
    d = c.frame(6250, FRAME, 1200, 6250, false)
    expect(d).toBeGreaterThanOrEqual(before)
    expect(d).toBeLessThan(1200 + RENDER_CLOCK.maxAheadMs)
  })

  it('back from a hidden tab: reset jumps straight to now', () => {
    const c = new RenderClock()
    for (let i = 0; i < 20; i++) c.arrive(i * 50 + 100, i * 50, true)
    c.frame(1050, FRAME, 950, 1050, false)
    c.reset()
    for (let i = 0; i < 5; i++) c.arrive(60_000 + i * 50, 59_000 + i * 50, true)
    expect(c.frame(60_250, FRAME, 59_200, 60_200, false)).toBeGreaterThan(58_900)
  })
})

function duelView(): BattleSim {
  const level = PVP_MAPS[0]
  const v = new BattleSim(level, null, {}, levelLanes(level))
  v.makePvp()
  return v
}

describe('Predictor (your own orders show at once)', () => {
  it('shows an aim straight away and keeps it until the drawn picture includes it, then hands over without a jump', () => {
    const view = duelView()
    const mine = view.cannons.find((c) => c.side === 'player')!
    const foe = view.cannons.filter((c) => c.side === 'enemy').at(-1)!
    const p = new Predictor()
    const startAngle = mine.angle
    p.add(1, { t: 'aim', cannon: mine.id, at: { cannon: foe.id } }, 0)
    p.apply(view, 1, 1, 0, FRAME)
    expect(targetOf(mine)).toBe(foe.id)
    // The barrel turns at its own speed, not in one go.
    const maxStep = (110 * Math.PI) / 180 / 60 + 1e-6
    let last = mine.angle
    expect(Math.abs(last - startAngle)).toBeLessThanOrEqual(maxStep)
    p.ack(1, true, 5)
    // Snapshots before #5 don't have it: the prediction stays.
    for (let n = 2; n < 5; n++) {
      mine.target = null
      mine.angle = startAngle
      p.apply(view, n, n, n * FRAME, FRAME)
      expect(targetOf(mine)).toBe(foe.id)
      expect(Math.abs(mine.angle - last)).toBeLessThanOrEqual(maxStep)
      last = mine.angle
    }
    // #5 is drawn: the server's picture (target set, its barrel still behind) takes over; the barrel keeps its lead.
    mine.target = foe
    mine.angle = startAngle
    p.apply(view, 5, 5, 5 * FRAME, FRAME)
    expect(p.size).toBe(0)
    expect(targetOf(mine)).toBe(foe.id)
    expect(Math.abs(mine.angle - last)).toBeLessThanOrEqual(maxStep)
    expect(p.leading).toBe(1)
  })

  it('a refused order is dropped at once and the barrel eases back (no snap)', () => {
    const view = duelView()
    const mine = view.cannons.find((c) => c.side === 'player')!
    const foe = view.cannons.filter((c) => c.side === 'enemy').at(-1)!
    const p = new Predictor()
    const server = mine.angle
    p.add(7, { t: 'aim', cannon: mine.id, at: { cannon: foe.id } }, 0)
    for (let i = 0; i < 20; i++) {
      mine.target = null
      mine.angle = server
      p.apply(view, 1, 1, i * FRAME, FRAME)
    }
    const led = mine.angle
    expect(Math.abs(led - server)).toBeGreaterThan(0.2)
    p.ack(7, false, 2)
    expect(p.size).toBe(0)
    expect(p.refused).toBe(1)
    const maxStep = ((110 * Math.PI) / 180 / 60) * PREDICT.correctTurn + 1e-6
    let last = led
    for (let i = 0; i < 60 && p.leading; i++) {
      mine.target = null
      mine.angle = server
      p.apply(view, 2, 2, (20 + i) * FRAME, FRAME)
      expect(Math.abs(mine.angle - last)).toBeLessThanOrEqual(maxStep)
      last = mine.angle
    }
    expect(p.leading).toBe(0)
    expect(mine.target).toBeNull()
  })

  it('auto toggles and swaps show at once without flicker; paused orders show as queued ghosts', () => {
    const view = duelView()
    const own = view.cannons.filter((c) => c.side === 'player')
    const a = own[0]
    const b = own[1]
    const p = new Predictor()
    const was = a.autoTarget
    p.add(1, { t: 'auto', cannon: a.id }, 0, !was)
    p.add(2, { t: 'swap', cannon: b.id, kind: 'sniper' }, 0)
    for (let i = 0; i < 10; i++) {
      a.autoTarget = was
      p.apply(view, 1, 1, i * 30, FRAME)
      expect(a.autoTarget).toBe(!was)
      expect(b.kind).toBe('sniper')
    }
    view.paused = true
    view.setViewQueued([])
    const foe = view.cannons.find((c) => c.side === 'enemy')!
    p.add(3, { t: 'aim', cannon: a.id, at: { cannon: foe.id } }, 400)
    p.apply(view, 1, 1, 400, FRAME)
    expect(view.queuedOrders().find((q) => q.cannon === a)?.aim).toBe(foe)
    // The server's answer and a newer snapshot: the ghost now comes from the server.
    p.ack(3, true, 2)
    p.apply(view, 1, 2, 420, FRAME)
    expect(p.size).toBe(2)
  })

  it('gives up on orders the server never answered', () => {
    const view = duelView()
    const a = view.cannons.find((c) => c.side === 'player')!
    const p = new Predictor()
    p.add(1, { t: 'auto', cannon: a.id }, 0, true)
    p.apply(view, 1, 1, PREDICT.timeoutMs + 1, FRAME)
    expect(p.size).toBe(0)
  })
})

describe('online over a long-distance line (whole match, real server code)', () => {
  it('UK to the Philippines (250 ms, jitter): your aim shows on the next frame, the picture never stalls or runs backwards', () => {
    const net = { oneWayMs: 125, jitterMs: 40 }
    const m = new NetMatch([net, { ...net, seed: 2 }])
    m.run(1500)
    m.aimAll()
    m.run(2000)
    const p = m.players[1]
    const view = p.view!
    const mine = view.cannons.filter((c) => c.side === 'player')
    const foe = view.cannons.filter((c) => c.side === 'enemy').at(-1)!
    const t0 = m.now
    let seen = -1
    let reverts = 0
    m.onFrame = (i, t) => {
      if (i !== 1) return
      if (seen < 0 && mine[0].target?.id === foe.id) seen = t - t0
      else if (seen >= 0 && mine[0].side === 'player' && mine[0].target?.id !== foe.id) reverts++
    }
    p.client!.send({ t: 'aim', cannon: mine[0].id, at: { cannon: foe.id } })
    m.run(2500)
    m.onFrame = null
    m.run(4000)
    expect(seen).toBeLessThanOrEqual(FRAME + 1)
    expect(reverts).toBe(0)
    const s = smoothness(m.frames[1], t0, m.now)
    expect(s.backwards).toBe(0)
    expect(s.stalls).toBe(0)
    expect(s.jumps).toBe(0)
    expect(s.behindMs).toBeLessThan(260)
    // The server agreed with everything: nothing refused, every prediction settled.
    expect(p.client!.predictor.refused).toBe(0)
    expect(p.client!.predictor.size).toBe(0)
  })

  it('countdown, pause and the result still work through the new timing', () => {
    const net = { oneWayMs: 125, jitterMs: 40 }
    const m = new NetMatch([net, { ...net, seed: 5 }], PVP_MAPS[0].id, 3)
    const cds: number[] = []
    m.onFrame = (i) => {
      if (i === 0 && m.players[0].view!.countdown > 0) cds.push(m.players[0].view!.countdown)
    }
    m.run(4000)
    m.onFrame = null
    for (let k = 1; k < cds.length; k++) expect(cds[k]).toBeLessThanOrEqual(cds[k - 1] + 1e-6)
    expect(cds.length).toBeGreaterThan(100)
    expect(m.players[0].view!.countdown).toBe(0)
    m.aimAll()
    m.run(1500)
    m.players[0].client!.send({ t: 'pause' })
    m.run(1500)
    expect(m.players[1].view!.paused).toBe(true)
    const clock = m.players[1].view!.clock
    m.run(1000)
    expect(m.players[1].view!.clock).toBe(clock)
    m.players[0].client!.send({ t: 'resume' })
    m.run(1500)
    expect(m.players[1].view!.paused).toBe(false)
    expect(m.players[1].view!.clock).toBeGreaterThan(clock)
    const s = smoothness(m.frames[1], m.now - 900, m.now)
    expect(s.backwards).toBe(0)
    m.players[1].transport.send({ t: 'surrender' })
    m.run(1500)
    expect(m.players[0].view!.ended).toBe('win')
    expect(m.players[1].view!.ended).toBe('lose')
  })
})

void SIM_STEP_MS

import { SERVER_REGIONS, isServerRegion, nearestRegion, pickRegion } from '../src/net/online'
import { netText, pingLevel } from '../src/perf/perfStats'
import { debugInfo } from '../src/menu/debugInfo'
import { serverLine } from '../src/net/onlineView'
import { RoomCore, type RoomHost } from '../server/src/room'

describe('where a room runs', () => {
  it('near the creator by default, or the region they picked', () => {
    expect(nearestRegion(51.5, -0.1)).toBe('weur') // London
    expect(nearestRegion(14.6, 121)).toBe('apac') // Manila
    expect(nearestRegion(-37.8, 145)).toBe('oc') // Melbourne
    expect(nearestRegion(40.7, -74)).toBe('enam') // New York
    expect(nearestRegion(34, -118)).toBe('wnam') // Los Angeles
    expect(nearestRegion(52.2, 21)).toBe('eeur') // Warsaw
    expect(nearestRegion(24.7, 46.7)).toBe('me') // Riyadh
    expect(pickRegion('me', { latitude: '51.5', longitude: '-0.1' })).toBe('me')
    expect(pickRegion('nowhere', { latitude: '51.5', longitude: '-0.1' })).toBe('weur')
    expect(pickRegion(null, { continent: 'AS' })).toBe('apac')
    expect(pickRegion(undefined, undefined)).toBe('apac')
    for (const r of SERVER_REGIONS) expect(isServerRegion(r.id)).toBe(true)
    expect(isServerRegion('mars')).toBe(false)
  })

  it('the room tells its region and data centre in the lobby', () => {
    const host: RoomHost = { now: () => 0, conns: () => [], save: () => {}, setAlarm: () => {}, startLoop: () => {}, stopLoop: () => {} }
    const room = new RoomCore(host, null)
    expect(room.init('ABCD', 'me')).toBe(true)
    expect(room.roomInfo(null).server).toEqual({ region: 'me' })
    room.setColo('DXB')
    room.setColo('not a colo')
    expect(room.roomInfo(null).server).toEqual({ region: 'me', colo: 'DXB' })
    expect(serverLine({ region: 'me', colo: 'DXB' }, 120)).toBe('Server: Middle East (DXB) · your ping 120 ms')
    expect(serverLine({ region: 'apac' }, null)).toBe('Server: Asia-Pacific')
  })
})

describe('connection numbers on screen', () => {
  it('ping colours and the performance line', () => {
    expect(pingLevel(40)).toBe('good')
    expect(pingLevel(180)).toBe('ok')
    expect(pingLevel(260)).toBe('bad')
    expect(netText({ rtt: 182, delayMs: 95, jitterMs: 30, kbps: 19.44, predicted: 12, refused: 1, server: 'SIN (apac)' })).toBe(
      'ping 182 ms · buffer 95 ms (jitter 30) · 19.4 KB/s · predicted 12, refused 1 · server SIN (apac)',
    )
  })

  it('Copy debug info has the ping and server but never the room code', () => {
    const text = debugInfo({
      version: '0.2.2', commit: 'abc1234', build: 'b', userAgent: 'UA', browser: 'Chrome', screen: { w: 1, h: 1 }, viewport: { w: 1, h: 1 }, dpr: 1, canvas: null,
      renderer: 'WebGL2', gpu: null, fps: 60, discord: false, switches: [], settings: {}, online: { rtt: 182, server: 'SIN (apac)' },
    })
    expect(text).toContain('Online: ping 182 ms, server SIN (apac)')
  })
})

describe('server region picker', () => {
  it('only offers regions Cloudflare actually runs rooms in', () => {
    const offered = SERVER_REGIONS.filter((r) => !('pick' in r)).map((r) => r.id)
    expect(offered).toEqual(['weur', 'eeur', 'apac', 'oc', 'enam', 'wnam'])
  })
})
