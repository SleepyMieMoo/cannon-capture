import { PVP_RULES } from '../../src/config/pvpRules'
import { PVP_MAPS } from '../../src/net/online'
import { PvpClient, flipLevel, type StartMsg } from '../../src/net/pvp'
import type { Transport } from '../../src/net/transport'
import { BattleSim, type SimEvents } from '../../src/sim/BattleSim'
import { levelLanes } from '../../src/sim/solver'
import { LOOP_MS, RoomCore, type Conn, type ConnData, type RoomHost, type RoomState } from '../../server/src/room'

/**
 * A whole online match in virtual time: the real server room (RoomCore), two
 * players' PvpClients, and a network between them with delay and jitter each
 * way (in order, like a WebSocket over TCP). Frames are drawn at 60 fps and the
 * picture each player sees is measured.
 */

export interface NetConditions {
  /** One-way delay (ms); round trip is twice this plus jitter. */
  oneWayMs: number
  /** Extra one-way delay, uniform 0..jitterMs, per message. */
  jitterMs: number
  /** Chance per message of a spike of `spikeMs` on top (Wi-Fi hiccup). */
  spikeChance?: number
  spikeMs?: number
  seed?: number
}

export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One direction of a connection: messages arrive in order, each after its delay. */
class Link {
  private q: { due: number; text: string }[] = []
  private lastDue = 0
  constructor(
    private readonly net: NetConditions,
    private readonly random: () => number,
  ) {}
  push(now: number, text: string): void {
    let d = this.net.oneWayMs + this.random() * this.net.jitterMs
    if (this.net.spikeChance && this.random() < this.net.spikeChance) d += this.net.spikeMs ?? 0
    const due = Math.max(this.lastDue, now + d)
    this.lastDue = due
    this.q.push({ due, text })
  }
  take(now: number): string[] {
    let n = 0
    while (n < this.q.length && this.q[n].due <= now) n++
    return this.q.splice(0, n).map((m) => m.text)
  }
}

class SimHost implements RoomHost {
  t = 1_000_000
  open = new Set<SimConn>()
  loop: (() => void) | null = null
  now = () => this.t
  conns = () => [...this.open]
  save(_s: RoomState | null) {}
  setAlarm(_at: number | null) {}
  startLoop(fn: () => void) {
    this.loop = fn
  }
  stopLoop() {
    this.loop = null
  }
}

let nextId = 0
/** The server's end of one player's connection. */
class SimConn implements Conn {
  data: ConnData = { id: 's' + nextId++, token: null, name: '' }
  constructor(
    private readonly host: SimHost,
    readonly down: Link,
  ) {
    host.open.add(this)
  }
  save() {}
  send(text: string) {
    this.down.push(this.host.t, text)
  }
  close() {
    this.host.open.delete(this)
  }
}

/** The player's end: what PvpClient listens on. */
class SimTransport implements Transport {
  readonly id = 'p' + nextId++
  private handlers = new Set<(msg: unknown, from: string) => void>()
  bytesIn = 0
  msgsIn = 0
  /** Every message received (for size studies). */
  texts: { t: number; text: string }[] = []
  constructor(
    private readonly host: SimHost,
    readonly up: Link,
  ) {}
  send(msg: unknown) {
    this.up.push(this.host.t, JSON.stringify(msg))
  }
  onMessage(fn: (msg: unknown, from: string) => void) {
    this.handlers.add(fn)
    return () => this.handlers.delete(fn)
  }
  close() {}
  deliver(text: string) {
    this.bytesIn += text.length
    this.msgsIn += 1
    this.texts.push({ t: this.host.t, text })
    const msg = JSON.parse(text)
    for (const fn of [...this.handlers]) fn(msg, 'server')
  }
}

export interface Player {
  conn: SimConn
  transport: SimTransport
  start: StartMsg | null
  client: PvpClient | null
  view: BattleSim | null
  replayed: number
}

export interface Frame {
  t: number
  /** The view's round clock and the server's (ms). */
  viewClock: number
  serverClock: number
  shots: Map<number, { x: number; y: number }>
  paused: boolean
  countdown: number
}

export class NetMatch {
  readonly host = new SimHost()
  readonly room: RoomCore
  readonly players: Player[] = []
  /** Every frame each player drew. */
  readonly frames: Frame[][] = [[], []]
  private nextLoop: number
  private nextFrame: number
  private readonly random: () => number
  /** Server loop jitter (a Durable Object's timer isn't exact). */
  loopJitterMs = 4
  frameMs = 1000 / 60
  onFrame: ((p: number, t: number) => void) | null = null

  constructor(
    readonly net: [NetConditions, NetConditions],
    readonly mapId = PVP_MAPS[0].id,
    countdown: 0 | 3 | 5 = 0,
  ) {
    this.random = rng(net[0].seed ?? 1)
    this.room = new RoomCore(this.host, null)
    this.room.init('NETS')
    for (let i = 0; i < 2; i++) {
      const r = rng((net[i].seed ?? 1) * 7919 + i)
      const conn = new SimConn(this.host, new Link(net[i], r))
      const transport = new SimTransport(this.host, new Link(net[i], r))
      this.room.onConnect(conn)
      this.players.push({ conn, transport, start: null, client: null, view: null, replayed: 0 })
      transport.onMessage((m) => {
        const msg = m as { t: string } & StartMsg
        if (msg.t === 'start') this.begin(i, msg)
      })
    }
    this.nextLoop = this.host.t
    this.nextFrame = this.host.t
    // Player 0 first, so they are the host.
    this.players[0].transport.send({ t: 'hello', token: 'netsim-token-0', name: 'P0' })
    for (let k = 0; k < 100 && !this.room.state!.seats[0]; k++) this.run(20)
    this.players[1].transport.send({ t: 'hello', token: 'netsim-token-1', name: 'P1' })
    this.players[0].transport.send({ t: 'map', id: mapId })
    this.players[0].transport.send({ t: 'settings', countdown })
    for (let k = 0; k < 100 && !(this.room.state!.seats[0] && this.room.state!.seats[1]); k++) this.run(50)
    this.players[0].transport.send({ t: 'start' })
    for (let k = 0; k < 100 && !this.players.every((p) => p.client && p.client.latest); k++) this.run(50)
  }

  private begin(i: number, start: StartMsg): void {
    const p = this.players[i]
    if (p.client) return
    const flip = start.side === 'enemy'
    const level = flip ? flipLevel(start.level) : start.level
    p.start = start
    p.view = new BattleSim(level, null, {}, levelLanes(level))
    p.view.makePvp()
    p.client = new PvpClient(p.transport, start, flip, false, () => this.host.t)
  }

  get now(): number {
    return this.host.t
  }

  /** Run `ms` of virtual time, 1 ms at a time. */
  run(ms: number): void {
    const end = this.host.t + ms
    while (this.host.t < end) {
      this.host.t += 1
      const t = this.host.t
      for (const p of this.players) {
        for (const text of p.transport.up.take(t)) this.room.onMessage(p.conn, text)
        for (const text of p.conn.down.take(t)) p.transport.deliver(text)
      }
      if (t >= this.nextLoop) {
        this.host.loop?.()
        this.nextLoop += LOOP_MS + (this.random() * 2 - 1) * this.loopJitterMs
      }
      if (t >= this.nextFrame) {
        this.nextFrame += this.frameMs
        this.players.forEach((p, i) => this.draw(p, i))
      }
    }
  }

  private draw(p: Player, i: number): void {
    if (!p.client || !p.view) return
    const handlers: SimEvents = { fired: () => p.replayed++, captured: () => p.replayed++, hit: () => p.replayed++ }
    p.client.update(p.view, handlers, this.frameMs)
    this.onFrame?.(i, this.host.t)
    const sim = this.room.match?.sim
    this.frames[i].push({
      t: this.host.t,
      viewClock: p.view.clock,
      serverClock: sim?.clock ?? 0,
      shots: new Map(p.view.shots.map((s) => [s.id, { x: s.ball.x, y: s.ball.y }])),
      paused: p.view.paused,
      countdown: p.view.countdown,
    })
  }

  /** Both players aim every one of their cannons at the other side (so shots fly all match). */
  aimAll(): void {
    for (const p of this.players) {
      const view = p.view!
      const mine = view.cannons.filter((c) => c.side === 'player')
      const theirs = view.cannons.filter((c) => c.side === 'enemy')
      mine.forEach((c, k) => p.client!.send({ t: 'aim', cannon: c.id, at: { cannon: theirs[k % theirs.length].id } }))
    }
  }
}

export interface Smoothness {
  frames: number
  /** Frames where the round clock stood still while it should run. */
  stalls: number
  /** Frames where it jumped more than 2.5 frames' worth. */
  jumps: number
  /** Frames where it went backwards. */
  backwards: number
  /** RMS error of the clock's step per frame against real time (ms). */
  clockRms: number
  /** Shot steps whose speed was off by more than half (stalls, jumps, snaps). */
  shotJerks: number
  shotSteps: number
  /** How far behind the server's round the picture is (ms, mean). */
  behindMs: number
}

/** Measure one player's frames between `from` and `to` (ms of virtual time). */
export function smoothness(frames: Frame[], from: number, to: number, frameMs = 1000 / 60): Smoothness {
  const fs = frames.filter((f) => f.t >= from && f.t <= to)
  let stalls = 0
  let jumps = 0
  let backwards = 0
  let sq = 0
  let n = 0
  let behind = 0
  let shotJerks = 0
  let shotSteps = 0
  for (let k = 1; k < fs.length; k++) {
    const a = fs[k - 1]
    const b = fs[k]
    if (a.paused || b.paused || a.countdown > 0 || b.countdown > 0) continue
    const d = b.viewClock - a.viewClock
    const want = b.t - a.t
    if (d < -0.01) backwards++
    else if (d < want * 0.1) stalls++
    else if (d > want * 2.5) jumps++
    sq += (d - want) ** 2
    n++
    behind += b.serverClock - b.viewClock
    // Shots: speed per frame against the median of their own speed.
    if (k >= 2) {
      const z = fs[k - 2]
      for (const [id, pb] of b.shots) {
        const pa = a.shots.get(id)
        const pz = z.shots.get(id)
        if (!pa || !pz) continue
        const v1 = Math.hypot(pa.x - pz.x, pa.y - pz.y)
        const v2 = Math.hypot(pb.x - pa.x, pb.y - pa.y)
        const ref = Math.max(v1, v2)
        if (ref < 0.5) continue
        shotSteps++
        if (Math.abs(v2 - v1) > 0.5 * ref) shotJerks++
      }
    }
  }
  void frameMs
  return { frames: n, stalls, jumps, backwards, clockRms: n ? Math.sqrt(sq / n) : 0, shotJerks, shotSteps, behindMs: n ? behind / n : 0 }
}

export { PVP_RULES }
