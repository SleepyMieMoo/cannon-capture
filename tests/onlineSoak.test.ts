import { describe, expect, it } from 'vitest'
import { PVP_RULES } from '../src/config/pvpRules'
import { PVP_MAPS } from '../src/net/online'
import { BattleSim } from '../src/sim/BattleSim'
import { levelLanes } from '../src/sim/solver'
import { applySnap, type Snap } from '../src/net/snapshot'
import { clientAccepts } from '../src/net/orderCheck'
import type { Order } from '../src/sim/orders'
import type { LevelDef } from '../src/types'
import { LOOP_MS } from '../server/src/room'
import { setup, type FakeConn } from './helpers/fakeRoom'

/**
 * Two players play a long online match against the real room code: every
 * half second each one gives an order the way the game does (checked on
 * their own view first, then sent). The client must never refuse an order
 * the server would have taken: that is "aiming stops working".
 */

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

interface Player {
  conn: FakeConn
  view: BattleSim
  flip: boolean
  seq: number
}

function viewFor(conn: FakeConn): Player {
  const start = conn.last<{ level: LevelDef; side: string }>('start')
  const view = new BattleSim(start.level, null, {}, levelLanes(start.level))
  view.makePvp()
  return { conn, view, flip: start.side === 'enemy', seq: 0 }
}

function sync(p: Player): void {
  const s: Snap = p.conn.snap
  applySnap(p.view, s, s, 0, s, p.flip, PVP_RULES.stepMs)
}

export function soak(seed: number, ms: number) {
  const s = setup()
  const a = s.join('token-aaaaaaaa', 'A')
  const b = s.join('token-bbbbbbbb', 'B')
  a.say({ t: 'map', id: PVP_MAPS[0].id })
  a.say({ t: 'settings', countdown: 0 })
  a.say({ t: 'start' })
  s.run(LOOP_MS * 2)
  const players = [viewFor(a), viewFor(b)]
  const rand = rng(seed)
  const stats = { sent: 0, ok: 0, clientRefusedLegal: 0, damagedRefused: 0, serverRefused: 0, stalls: [] as number[] }
  const serverSide = (p: Player) => (p.flip ? 'enemy' : 'player')
  for (let t = 0; t < ms && s.room.match && !s.room.match.over; t += 500) {
    s.run(500)
    // Now and then: a pause (orders queue) and a resume; once, a dropped line and a reconnect.
    if (t % 30_000 === 20_000) a.say({ t: 'order', seq: ++players[0].seq, o: { t: 'pause' } })
    if (t % 30_000 === 23_000) a.say({ t: 'order', seq: ++players[0].seq, o: { t: 'resume' } })
    if (t === 45_000) {
      players[1].conn.drop()
      players[1].conn = s.join('token-bbbbbbbb', 'B')
    }
    for (const p of players) {
      sync(p)
      const v = p.view
      const mine = v.cannons.filter((c) => c.side === 'player')
      const others = v.cannons.filter((c) => c.side !== 'player')
      if (!mine.length || !others.length) continue
      const c = mine[Math.floor(rand() * mine.length)]
      const r = rand()
      const o: Order =
        r < 0.75 ? { t: 'aim', cannon: c.id, at: { cannon: others[Math.floor(rand() * others.length)].id } }
        : r < 0.85 ? { t: 'stop', cannon: c.id }
        : r < 0.95 ? { t: 'aim', cannon: c.id, at: { x: 200 + rand() * 800, y: 100 + rand() * 500 } }
        : { t: 'swap', cannon: c.id, kind: (['normal', 'sniper', 'machinegun'] as const)[Math.floor(rand() * 3)] }
      // What would the server say? (Ask a throwaway copy: same rules, nothing changes.)
      const server = s.room.match!.sim
      const sc = server.byId(c.id)!
      const legal = o.t === 'aim' && sc.side === serverSide(p) && !server.ended && 'cannon' in o.at && o.at.cannon !== o.cannon
      const ok = clientAccepts(v, o)
      if (legal && !ok) {
        stats.clientRefusedLegal++
        if (c.damaged) stats.damagedRefused++
        stats.stalls.push(t)
      }
      if (!ok) continue
      p.seq += 1
      p.conn.say({ t: 'order', seq: p.seq, o })
      stats.sent++
      if (p.conn.last('ack').ok) stats.ok++
      else stats.serverRefused++
    }
  }
  return { stats, s, players }
}

describe('online soak: long matches, many orders', () => {
  it('a damaged cannon of yours still takes an aim on your screen (the server takes it)', () => {
    const { s, players } = soak(2, 20_000)
    const v = players[0].view
    const c = v.cannons.find((x) => x.side === 'player')!
    const other = v.cannons.find((x) => x.side !== 'player')!
    c.captureProgress = 0.4
    c.captureAttacker = 'enemy'
    expect(c.damaged).toBe(true)
    expect(clientAccepts(v, { t: 'aim', cannon: c.id, at: { cannon: other.id } })).toBe(true)
    expect(s.room.match).toBeTruthy()
  })

  it('the client never refuses an aim the server would take (damaged cannons included)', () => {
    for (const seed of [1, 2, 3]) {
      const { stats } = soak(seed, 180_000)
      expect(stats.sent).toBeGreaterThan(40)
      expect(stats.clientRefusedLegal, JSON.stringify({ seed, ...stats, stalls: stats.stalls.slice(0, 5) })).toBe(0)
    }
  })
})
