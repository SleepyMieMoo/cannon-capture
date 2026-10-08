import { PVP } from '../config/pvp'
import type { BattleSim, SimEvents } from '../sim/BattleSim'
import { applyOrder, parseOrder, type Order, type OrderResult } from '../sim/orders'
import type { LevelDef, Side } from '../types'
import { applySnap, encodeSnap, EventLog, replayEvent, sideMapper, type EventRow, type Snap } from './snapshot'
import type { Transport } from './transport'
import { isSkin, pvpSkins, type SideSkins, type SkinId } from '../config/skins'
import { isTeamColour, pvpColours, type SideColours, type TeamColourId } from '../config/teamColours'

/**
 * Player vs player, Phase 0: one game is the host (it runs the real round,
 * plays gold, and takes pink's orders from the other player); the other only
 * draws snapshots and sends orders. Both talk over a Transport. The messages
 * are plain JSON, so a server can take the host's place later.
 */

/** Host to player. */
export type HostMsg =
  | { t: 'start'; match: string; level: LevelDef; side: Side; stepMs: number; skins?: SideSkins; colours?: SideColours }
  | { t: 'snap'; match: string; s: Snap }
  | { t: 'ack'; seq: number; ok: boolean }
  | { t: 'busy' }
  | { t: 'bye' }
  | { t: 'ping' }

/** Player to host. */
export type ClientMsg = { t: 'hello'; skin?: SkinId; colour?: TeamColourId } | { t: 'order'; seq: number; o: Order } | { t: 'restart' } | { t: 'bye' } | { t: 'ping' }

export type StartMsg = Extract<HostMsg, { t: 'start' }>

/** The skin each player who said hello picked (kept across restarts, which make a new host). */
const peerSkins = new Map<string, SkinId>()
/** The same for team colours. */
const peerColours = new Map<string, TeamColourId>()

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/**
 * "Still here" runs on a timer, not on screen frames: a browser stops drawing
 * a tab that is out of sight, but its timers keep going (slowly), so switching
 * tabs for a moment doesn't drop the other player.
 */
function heartbeat(fn: () => void): () => void {
  const timer = setInterval(fn, PVP.heartbeatMs)
  ;(timer as unknown as { unref?: () => void }).unref?.()
  return () => clearInterval(timer)
}

/** Swap gold and pink in a level (the second player's view starts like this). */
export function flipLevel(level: LevelDef): LevelDef {
  const map = sideMapper(true)
  return { ...level, cannons: level.cannons.map((c) => ({ ...c, side: map(c.side) })) }
}

export class PvpHost {
  readonly log: EventLog
  private sim: BattleSim | null = null
  private tick = 0
  private peer: string | null = null
  private heard = 0
  private lastSnap = -Infinity
  private readonly off: () => void
  private readonly stopBeat: () => void
  /** True while applying the other player's order (their aims shouldn't ping on this screen). */
  applyingRemote = false
  /** The other player asked for a new round. */
  onRestart: (() => void) | null = null
  /** Someone joined, left or went quiet. */
  onPeer: ((joined: boolean) => void) | null = null

  /** This screen's own skin (gold); set before attach(). */
  localSkin: SkinId | undefined
  /** This screen's own team colour; set before attach(). */
  localColour: TeamColourId | undefined

  constructor(
    private readonly transport: Transport,
    private readonly level: LevelDef,
    /** A new id for every round (a restart is a new match). */
    readonly match: string,
    readonly remoteSide: Side = 'enemy',
    readonly stepMs = 1000 / 60,
    /** A restart keeps the player who was already here. */
    peer?: string,
  ) {
    this.peer = peer ?? null
    this.heard = now()
    this.log = new EventLog(() => this.sim?.clock ?? 0)
    this.off = transport.onMessage((msg, from) => this.handle(msg as ClientMsg, from))
    this.stopBeat = heartbeat(() => this.beat())
  }

  private beat(): void {
    this.transport.send({ t: 'ping' } satisfies HostMsg)
    if (this.peer && now() - this.heard > PVP.timeoutMs) this.dropPeer()
  }

  /** The round to run (create it with log.tap(events)). Tells a player who is already here. */
  attach(sim: BattleSim): void {
    this.sim = sim
    this.log.bind(sim)
    if (this.peer) this.sendStart()
  }

  /** Someone is playing pink (the round only runs then). */
  get joined(): boolean {
    return this.peer !== null
  }

  get peerId(): string | null {
    return this.peer
  }

  /** Both players' team colours, host first (each keeps theirs; name tags show when they clash). */
  get colours(): SideColours {
    return pvpColours(this.localColour, this.peer ? peerColours.get(this.peer) : undefined)
  }

  /** Both players' skins, gold first (each keeps theirs). */
  get skins(): SideSkins {
    return pvpSkins(this.localSkin, this.peer ? peerSkins.get(this.peer) : undefined)
  }

  private handle(msg: ClientMsg, from: string): void {
    if (!msg || typeof msg !== 'object') return
    // Someone we had given up on (their tab was asleep) is back: take them again.
    if (!this.peer && msg.t !== 'bye' && msg.t !== 'hello') this.handle({ t: 'hello' }, from)
    if (msg.t === 'hello') {
      if (isSkin(msg.skin)) peerSkins.set(from, msg.skin)
      if (isTeamColour(msg.colour)) peerColours.set(from, msg.colour)
      const quiet = now() - this.heard > PVP.timeoutMs
      if (this.peer && this.peer !== from && !quiet) {
        this.transport.send({ t: 'busy' } satisfies HostMsg)
        return
      }
      const fresh = this.peer !== from
      this.peer = from
      this.heard = now()
      this.sendStart()
      if (fresh) this.onPeer?.(true)
      return
    }
    if (from !== this.peer) return
    this.heard = now()
    if (msg.t === 'order') {
      const order = parseOrder(msg.o)
      const ok = order && this.sim ? this.applyRemote(order).ok : false
      this.transport.send({ t: 'ack', seq: Number(msg.seq) || 0, ok } satisfies HostMsg)
      this.sendSnap()
    } else if (msg.t === 'restart') this.onRestart?.()
    else if (msg.t === 'bye') this.dropPeer()
  }

  private applyRemote(order: Order): OrderResult {
    this.applyingRemote = true
    try {
      return applyOrder(this.sim!, this.remoteSide, order)
    } finally {
      this.applyingRemote = false
    }
  }

  private dropPeer(): void {
    if (!this.peer) return
    this.peer = null
    this.onPeer?.(false)
  }

  private sendStart(): void {
    this.transport.send({ t: 'start', match: this.match, level: this.level, side: this.remoteSide, stepMs: this.stepMs, skins: this.skins, colours: this.colours } satisfies HostMsg)
    this.sendSnap()
  }

  sendSnap(): void {
    if (!this.sim || !this.peer) return
    this.lastSnap = now()
    this.transport.send({ t: 'snap', match: this.match, s: encodeSnap(this.sim, this.tick, this.remoteSide, this.log.take()) } satisfies HostMsg)
  }

  /** After every sim step. */
  stepped(): void {
    this.tick += 1
    if (this.tick % PVP.snapEvery === 0) this.sendSnap()
  }

  /** Every frame: keep snapshots coming while the round isn't stepping (paused, over, waiting). */
  frame(): void {
    if (this.peer && now() - this.lastSnap > 100) this.sendSnap()
  }

  /** Leaving: tell the player, stop listening. The transport stays open (the round may restart). */
  close(sayBye: boolean): void {
    if (sayBye) this.transport.send({ t: 'bye' } satisfies HostMsg)
    this.off()
    this.stopBeat()
  }
}

/**
 * The second player: keeps the last snapshots, draws the round a little
 * behind the newest one (blending between the two around that time), replays
 * the host's events (sparks, sounds, popups) when the view reaches them, and
 * sends orders.
 */
export class PvpClient {
  private snaps: Snap[] = []
  private renderTick = -1
  private renderClock = 0
  private events: EventRow[] = []
  private seq = 0
  private heard = now()
  private readonly off: () => void
  private readonly stopBeat: () => void
  /** A new round started (restart): the screen should start over with it. */
  onStart: ((start: StartMsg) => void) | null = null
  /** The host left or went quiet. */
  onLost: (() => void) | null = null
  /** The host is answering again after going quiet. */
  onBack: (() => void) | null = null
  /** The host refused an order (it was stale by the time it arrived). */
  onRefused: (() => void) | null = null
  lost = false

  constructor(
    private readonly transport: Transport,
    readonly start: StartMsg,
    /** Flip sides so this player's cannons are "player" in the view (the UI acts on those). */
    readonly flip = true,
    /** Ping the host and watch for silence (Phase 0). Online, the room's connection does that. */
    beat = true,
  ) {
    this.off = transport.onMessage((msg) => this.handle(msg as HostMsg))
    this.stopBeat = beat ? heartbeat(() => this.beat()) : () => {}
  }

  private beat(): void {
    this.transport.send({ t: 'ping' } satisfies ClientMsg)
    if (!this.lost && now() - this.heard > PVP.timeoutMs) {
      this.lost = true
      this.onLost?.()
    }
  }

  get latest(): Snap | null {
    return this.snaps[this.snaps.length - 1] ?? null
  }

  private handle(msg: HostMsg): void {
    if (!msg || typeof msg !== 'object') return
    this.heard = now()
    if (this.lost && msg.t !== 'bye') {
      this.lost = false
      this.onBack?.()
    }
    if (msg.t === 'snap') {
      if (msg.match !== this.start.match) return
      const last = this.latest
      if (last && msg.s.tick < last.tick) return
      this.snaps.push(msg.s)
      if (this.snaps.length > 12) this.snaps.shift()
      for (const ev of msg.s.ev) this.events.push(ev)
    } else if (msg.t === 'start') {
      if (msg.match !== this.start.match) this.onStart?.(msg)
    } else if (msg.t === 'ack') {
      if (!msg.ok) this.onRefused?.()
    } else if (msg.t === 'bye') {
      this.lost = true
      this.onLost?.()
    }
  }

  /** Send an order for this player's side. */
  send(order: Order): void {
    this.seq += 1
    this.transport.send({ t: 'order', seq: this.seq, o: order } satisfies ClientMsg)
  }

  private restartAt = -Infinity

  requestRestart(): void {
    // One request is enough (a double press would restart twice).
    if (now() - this.restartAt < 1500) return
    this.restartAt = now()
    this.transport.send({ t: 'restart' } satisfies ClientMsg)
  }

  /**
   * Every frame: move the render time on by `frameMs` (kept about
   * interpDelayMs behind the newest snapshot) and show the round at that time.
   */
  update(view: BattleSim, handlers: SimEvents, frameMs: number): void {
    const latest = this.latest
    if (!latest) return
    const stepMs = this.start.stepMs
    const target = latest.tick - PVP.interpDelayMs / stepMs
    if (this.renderTick < 0 || Math.abs(this.renderTick - target) > 30) this.renderTick = target
    else {
      this.renderTick += frameMs / stepMs
      // Drift gently toward the target so lag changes don't jump.
      this.renderTick += (target - this.renderTick) * 0.05
    }
    if (this.renderTick > latest.tick) this.renderTick = latest.tick
    // The two snapshots around the render time.
    let a = this.snaps[0]
    let b = latest
    for (let i = 0; i < this.snaps.length; i++) {
      if (this.snaps[i].tick <= this.renderTick) a = this.snaps[i]
      if (this.snaps[i].tick >= this.renderTick) {
        b = this.snaps[i]
        break
      }
    }
    if (a.tick > this.renderTick) b = a
    const span = b.tick - a.tick
    const k = span > 0 ? Math.min(1, Math.max(0, (this.renderTick - a.tick) / span)) : 1
    applySnap(view, a, b, k, latest, this.flip, stepMs)
    this.renderClock = view.clock
    // Events whose time has come (all of them once the round is paused or over).
    const all = latest.paused || latest.winner !== null
    let n = 0
    while (n < this.events.length && (all || Number(this.events[n][0]) <= this.renderClock)) n++
    if (n > 0) for (const ev of this.events.splice(0, n)) replayEvent(ev, view, handlers, this.flip)
  }

  close(sayBye: boolean): void {
    if (sayBye) this.transport.send({ t: 'bye' } satisfies ClientMsg)
    this.off()
    this.stopBeat()
  }
}

/** Knock on a room until its host answers with a round to play (or says it is busy). Returns a cancel function. */
export function joinRoom(transport: Transport, onStart: (start: StartMsg) => void, onBusy: () => void, skin?: SkinId, colour?: TeamColourId): () => void {
  let done = false
  const off = transport.onMessage((raw) => {
    const msg = raw as HostMsg
    if (done || !msg || typeof msg !== 'object') return
    if (msg.t === 'start') {
      done = true
      cancel()
      onStart(msg)
    } else if (msg.t === 'busy') onBusy()
  })
  const hello = () => transport.send({ t: 'hello', skin, colour } satisfies ClientMsg)
  hello()
  const timer = setInterval(hello, 500)
  const cancel = () => {
    clearInterval(timer)
    off()
  }
  return () => {
    done = true
    cancel()
  }
}
