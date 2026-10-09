import { PVP } from '../config/pvp'
import type { BattleSim, SimEvents } from '../sim/BattleSim'
import { applyOrder, parseOrder, type Order, type OrderResult } from '../sim/orders'
import type { LevelDef, Side } from '../types'
import { applySnap, encodeSnap, EventLog, replayEvent, sideMapper, type EventRow, type Snap } from './snapshot'
import { RenderClock, type RenderClockStats } from './renderClock'
import { Predictor } from './predict'
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

/** Swapped events carry the cannon index and the new kind. */
const EV_SWAPPED = 9

/**
 * The second player (and every online player): keeps the last snapshots,
 * draws the round a little behind the newest one (blending between the two
 * around that time; how far behind adapts to the connection, see
 * RenderClock), replays the server's events (sparks, sounds, popups) when the
 * picture reaches them, and sends orders, showing their effect at once (see
 * Predictor) until the server's picture includes them.
 */
export class PvpClient {
  private snaps: Snap[] = []
  /** Each snapshot's arrival number and local arrival time. */
  private readonly meta = new WeakMap<Snap, { n: number; at: number }>()
  private received = 0
  private renderTick = -1
  private renderClock = 0
  private events: EventRow[] = []
  private seq = 0
  private heard: number
  readonly clockFn: () => number
  readonly timing = new RenderClock()
  readonly predictor = new Predictor()
  /** Own swaps shown early: their replayed event shows nothing (cannon id, kind, when). */
  private shownSwaps: { id: string; kind: string; at: number }[] = []
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
    /** The local clock (tests pass a fake one). */
    clock: () => number = now,
  ) {
    this.clockFn = clock
    this.heard = clock()
    this.off = transport.onMessage((msg) => this.handle(msg as HostMsg))
    this.stopBeat = beat ? heartbeat(() => this.beat()) : () => {}
  }

  private beat(): void {
    this.transport.send({ t: 'ping' } satisfies ClientMsg)
    if (!this.lost && this.clockFn() - this.heard > PVP.timeoutMs) {
      this.lost = true
      this.onLost?.()
    }
  }

  get latest(): Snap | null {
    return this.snaps[this.snaps.length - 1] ?? null
  }

  private handle(msg: HostMsg): void {
    if (!msg || typeof msg !== 'object') return
    this.heard = this.clockFn()
    if (this.lost && msg.t !== 'bye') {
      this.lost = false
      this.onBack?.()
    }
    if (msg.t === 'snap') {
      if (msg.match !== this.start.match) return
      const last = this.latest
      // Late or out of order (never over one WebSocket, but a relay might): the newer one stands.
      if (last && msg.s.tick < last.tick) return
      const at = this.clockFn()
      this.received += 1
      this.meta.set(msg.s, { n: this.received, at })
      this.timing.arrive(at, msg.s.tick * this.start.stepMs, !msg.s.paused && msg.s.winner === null)
      this.snaps.push(msg.s)
      if (this.snaps.length > 30) this.snaps.shift()
      for (const ev of msg.s.ev) this.events.push(ev)
      // A hidden tab draws nothing for a while: keep only the newest (the rest are stale by then).
      if (this.events.length > PVP.maxQueuedEvents) this.events.splice(0, this.events.length - PVP.maxQueuedEvents / 2)
    } else if (msg.t === 'start') {
      if (msg.match !== this.start.match) this.onStart?.(msg)
      // The same match again: we reconnected. Orders sent on the old line will never be answered,
      // so drop their predictions now and show the server's picture (instead of waiting out the timeout).
      else this.predictor.clear()
    } else if (msg.t === 'ack') {
      // Every snapshot after this answer includes the order.
      this.predictor.ack(Number(msg.seq), !!msg.ok, this.received + 1)
      if (!msg.ok) this.onRefused?.()
    } else if (msg.t === 'bye') {
      this.lost = true
      this.onLost?.()
    }
  }

  /**
   * Send an order for this player's side; aims, swaps and auto toggles show
   * at once (`on`: the value a toggle now shows) until the server's picture has them.
   */
  send(order: Order, on?: boolean): void {
    this.seq += 1
    const t = this.clockFn()
    this.predictor.add(this.seq, order, t, on)
    if (order.t === 'swap') {
      this.shownSwaps = this.shownSwaps.filter((s) => t - s.at < 5000)
      this.shownSwaps.push({ id: order.cannon, kind: order.kind, at: t })
    }
    this.transport.send({ t: 'order', seq: this.seq, o: order } satisfies ClientMsg)
  }

  /** Connection numbers for the HUD and the performance panel. */
  get netStats(): RenderClockStats & { predicted: number; refused: number } {
    return { ...this.timing.stats, predicted: this.predictor.shown, refused: this.predictor.refused }
  }

  private restartAt = -Infinity

  requestRestart(): void {
    // One request is enough (a double press would restart twice).
    if (now() - this.restartAt < 1500) return
    this.restartAt = now()
    this.transport.send({ t: 'restart' } satisfies ClientMsg)
  }

  /**
   * Every frame: move the draw time on by `frameMs` (RenderClock keeps it a
   * little behind the newest snapshot), show the round at that time, lay your
   * predicted orders over it, and replay the events it has reached.
   */
  update(view: BattleSim, handlers: SimEvents, frameMs: number): void {
    const latest = this.latest
    if (!latest) return
    const stepMs = this.start.stepMs
    const t = this.clockFn()
    const latestMeta = this.meta.get(latest)!
    const held = latest.paused || latest.winner !== null
    const drawMs = this.timing.frame(t, frameMs, latest.tick * stepMs, latestMeta.at, held)
    this.renderTick = drawMs / stepMs
    // The two snapshots around the draw time (past the newest: the newest, flown on).
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
    let ahead = 0
    if (this.renderTick > latest.tick) {
      a = b = latest
      ahead = (this.renderTick - latest.tick) * stepMs
    }
    const span = b.tick - a.tick
    const k = span > 0 ? Math.min(1, Math.max(0, (this.renderTick - a.tick) / span)) : 1
    applySnap(view, a, b, k, latest, this.flip, stepMs, held ? 0 : ahead)
    this.predictor.apply(view, this.meta.get(a)?.n ?? 0, latestMeta.n, t, frameMs)
    this.renderClock = view.clock
    // Events whose time has come (all of them once the round is paused or over).
    const all = latest.paused || latest.winner !== null
    let n = 0
    while (n < this.events.length && (all || Number(this.events[n][0]) <= this.renderClock)) n++
    // Long past ones (the picture jumped ahead after a hidden tab) are dropped: the snapshot shows their result.
    const stale = this.renderClock - PVP.staleEventMs
    if (n > 0) {
      const own = this.ownSwapFilter(handlers, t)
      for (const ev of this.events.splice(0, n)) if (Number(ev[0]) >= stale) replayEvent(ev, view, Number(ev[1]) === EV_SWAPPED ? own : handlers, this.flip)
    }
  }

  /** Handlers for a replayed swap: your own swap already showed when you made it, so its echo shows nothing. */
  private ownSwapFilter(handlers: SimEvents, t: number): SimEvents {
    return {
      ...handlers,
      swapped: (c) => {
        const i = this.shownSwaps.findIndex((s) => s.id === c.id && s.kind === c.kind && t - s.at < 5000)
        if (i >= 0 && c.side === 'player') {
          this.shownSwaps.splice(i, 1)
          return
        }
        handlers.swapped?.(c)
      },
    }
  }

  /**
   * Back from a hidden tab: drop every event still waiting (they happened
   * while nobody was looking; the snapshot already shows their result) and
   * jump the picture to the newest snapshot instead of easing toward it.
   */
  resync(): void {
    this.events.length = 0
    this.renderTick = -1
    this.timing.reset()
  }

  /** Events waiting for the picture to reach them (tests). */
  get pending(): number {
    return this.events.length
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
