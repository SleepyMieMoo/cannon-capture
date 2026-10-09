import { PVP_LIMITS, PVP_RULES } from '../../src/config/pvpRules'
import { DEFAULT_SETTINGS, PVP_MAPS, parseClientMsg, pvpLevel, pvpMap, readSettings, type ClientMsg, type RoomSettings, type MatchResult, type RoomInfo, type SeatInfo, type ServerMsg, type ServerRegion } from '../../src/net/online'
import { EventLog, encodeSnap, type SnapExtra } from '../../src/net/snapshot'
import { BattleSim } from '../../src/sim/BattleSim'
import { applyOrder, parseOrder } from '../../src/sim/orders'
import { levelLanes, type LaneTable } from '../../src/sim/solver'
import type { LevelDef, Side } from '../../src/types'
import { pvpSkins, type SideSkins, type SkinId } from '../../src/config/skins'
import { pvpColours, type SideColours, type TeamColourId } from '../../src/config/teamColours'

/**
 * One online room: seats, the lobby, and the authoritative round. Plain
 * TypeScript with no Cloudflare APIs (the Durable Object in worker.ts wires
 * it up), so tests drive it with fake connections and a fake clock.
 */

/** What a connection remembers (kept on the WebSocket, so it survives the room sleeping). */
export interface ConnData {
  id: string
  /** This tab's token once it said hello (seats belong to tokens). */
  token: string | null
  name: string
}

export interface Conn {
  readonly data: ConnData
  /** Store `data` changes (on the WebSocket). */
  save(): void
  send(text: string): void
  close(code: number, reason: string): void
}

/** What the room needs from where it runs. */
export interface RoomHost {
  now(): number
  /** Open connections. */
  conns(): Conn[]
  /** Store the lobby state (null: delete the room). */
  save(state: RoomState | null): void
  setAlarm(at: number | null): void
  /** The match loop (a timer: the room can't sleep while a match runs, and doesn't need to). */
  startLoop(fn: () => void, everyMs: number): void
  stopLoop(): void
}

export interface SeatState {
  token: string
  name: string
  /** Disconnected since (null: here). */
  leftAt: number | null
  /** Left for good (pressed Leave). */
  gone: boolean
  /** The cannon skin this player picked (from hello; older clients don't say). */
  skin?: SkinId
  /** The team colour this player picked (from hello; older clients don't say). */
  colour?: TeamColourId
}

/** Everything about a room that must survive it sleeping between matches. */
export interface RoomState {
  v: 1
  code: string
  createdAt: number
  lastActive: number
  seats: [SeatState | null, SeatState | null]
  host: 0 | 1 | null
  map: string
  /** Matches started so far. */
  matchNo: number
  phase: 'lobby' | 'ended'
  rematch: [boolean, boolean]
  result: MatchResult | null
  sides: [Side, Side]
  /** The host's match settings (rooms saved before settings existed have none: the defaults). */
  settings?: RoomSettings
  /** The seat on the left side next match (null/missing: the host's). */
  left?: 0 | 1 | null
  /** The region the room was placed in, and the data centre it runs in once known. */
  region?: ServerRegion
  colo?: string
}

interface Match {
  id: string
  sim: BattleSim
  log: EventLog
  tick: number
  sides: [Side, Side]
  /** What each side wears this match (decided once, at the start). */
  skins: SideSkins
  /** Team colours per side this match (decided once, at the start). */
  colours: SideColours
  /** Pauses allowed this match (the host's setting when it started). */
  pauses: boolean
  /** Pauses left per seat (-1: unlimited). */
  pausesLeft: [number, number]
  /** How long a pause lasts before it resumes by itself (null: no time limit, only the safety cap). */
  pauseMs: number | null
  pause: { seat: 0 | 1; until: number; limited: boolean } | null
  /** Anti-spam: when each seat paused lately, and until when it can't pause (0: free). `lockNext`: the running pause starts a lockout when it ends. */
  pausedAt: [number[], number[]]
  lockUntil: [number, number]
  lockNext: boolean
  ai: [boolean, boolean]
  last: number
  acc: number
  lastSnap: number
  why: MatchResult['why'] | null
  over: boolean
  /** Nobody connected since (the match is dropped after the grace time). */
  emptySince: number | null
}

export const LOOP_MS = 50
const SEATS = [0, 1] as const
const lanesCache = new Map<string, LaneTable>()

function lanesFor(level: LevelDef): LaneTable {
  let lanes = lanesCache.get(level.id)
  if (!lanes) {
    lanes = levelLanes(level)
    lanesCache.set(level.id, lanes)
  }
  return lanes
}

const rid = () => Math.random().toString(36).slice(2, 10)
const sideIx = (s: Side) => (s === 'player' ? 0 : 1)

export class RoomCore {
  state: RoomState | null
  match: Match | null = null
  private buckets = new Map<string, { tokens: number; at: number; dropped: number }>()
  /** Counters (for tests and the stats line in logs). */
  stats = { messagesIn: 0, bytesOut: 0, snaps: 0, dropped: 0 }

  constructor(
    private readonly host: RoomHost,
    state: RoomState | null,
  ) {
    this.state = state && state.v === 1 ? state : null
  }

  /** A new room with this code (placed in `region`). False if it already exists. */
  init(code: string, region?: ServerRegion): boolean {
    if (this.state) return false
    const now = this.host.now()
    this.state = {
      v: 1,
      code,
      createdAt: now,
      lastActive: now,
      seats: [null, null],
      host: null,
      map: PVP_MAPS[0].id,
      matchNo: 0,
      phase: 'lobby',
      rematch: [false, false],
      result: null,
      sides: ['player', 'enemy'],
      settings: { ...DEFAULT_SETTINGS },
      left: null,
      ...(region ? { region } : {}),
    }
    this.host.save(this.state)
    this.host.setAlarm(now + PVP_LIMITS.emptyRoomMs)
    return true
  }

  /** The data centre the room runs in (the Durable Object finds out once, after it is created). */
  setColo(colo: string): void {
    const st = this.state
    if (!st || !/^[A-Z]{3}$/.test(colo) || st.colo === colo) return
    st.colo = colo
    this.changed()
  }

  // ---------------------------------------------------------------- connections

  onConnect(conn: Conn): void {
    if (!this.state) {
      this.sendTo(conn, { t: 'error', code: 'noroom', msg: 'There is no room with that code (it may have closed).' })
      conn.close(4404, 'no room')
    }
  }

  onMessage(conn: Conn, raw: string | ArrayBuffer): void {
    const now = this.host.now()
    this.stats.messagesIn += 1
    if (!this.state) return this.onConnect(conn)
    if (!this.allow(conn, now)) return
    if (typeof raw !== 'string' || raw.length > PVP_LIMITS.maxMessage) return this.bad(conn, 'Message too long.')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return this.bad(conn, 'Not JSON.')
    }
    const msg = parseClientMsg(parsed)
    if (!msg) return this.bad(conn, 'Unknown message.')
    if (!conn.data.token && msg.t !== 'hello') return this.bad(conn, 'Say hello first.')
    this.state.lastActive = now
    this.handle(conn, msg, now)
  }

  onClose(conn: Conn): void {
    this.buckets.delete(conn.data.id)
    const st = this.state
    const token = conn.data.token
    if (!st) return
    const others = this.conns().filter((c) => c.data.id !== conn.data.id)
    const now = this.host.now()
    if (token && !others.some((c) => c.data.token === token)) {
      const seat = this.seatOf(token)
      if (seat !== null && !st.seats[seat]!.gone) st.seats[seat]!.leftAt = now
    }
    if (others.length === 0) st.lastActive = now
    if (!this.match || this.match.over) this.host.save(st)
    this.broadcastRoom(conn.data.id)
    this.schedule()
  }

  onAlarm(): void {
    const st = this.state
    if (!st) return
    const now = this.host.now()
    const conns = this.conns()
    if (conns.length === 0 && now - st.lastActive >= PVP_LIMITS.emptyRoomMs && !this.running) return this.destroy()
    if (!this.running && now - st.lastActive >= PVP_LIMITS.idleRoomMs) {
      for (const c of conns) {
        this.sendTo(c, { t: 'error', code: 'closed', msg: 'The room closed after a long time with nothing happening.' })
        c.close(4408, 'idle')
      }
      return this.destroy()
    }
    if (!this.running) this.tidySeats(now)
    this.host.save(st)
    this.broadcastRoom()
    this.schedule()
  }

  private get running(): boolean {
    return !!this.match && !this.match.over
  }

  private conns(): Conn[] {
    return this.host.conns()
  }

  private destroy(): void {
    this.host.stopLoop()
    this.match = null
    this.state = null
    this.host.setAlarm(null)
    this.host.save(null)
  }

  /**
   * Token bucket per connection; a flood gets the connection closed. Only
   * drops in a row count towards closing: a quick burst now and then in a
   * long match (spam-clicking) must never add up to a hang-up.
   */
  private allow(conn: Conn, now: number): boolean {
    let b = this.buckets.get(conn.data.id)
    if (!b) this.buckets.set(conn.data.id, (b = { tokens: PVP_LIMITS.rateBurst, at: now, dropped: 0 }))
    b.tokens = Math.min(PVP_LIMITS.rateBurst, b.tokens + ((now - b.at) / 1000) * PVP_LIMITS.ratePerSec)
    b.at = now
    if (b.tokens >= 1) {
      b.tokens -= 1
      b.dropped = 0
      return true
    }
    b.dropped += 1
    this.stats.dropped += 1
    if (b.dropped === 1) this.sendTo(conn, { t: 'error', code: 'rate', msg: 'Too many messages: slow down.' })
    if (b.dropped >= PVP_LIMITS.floodClose) conn.close(4429, 'flood')
    return false
  }

  private bad(conn: Conn, msg: string): void {
    this.sendTo(conn, { t: 'error', code: 'bad', msg })
  }

  // ---------------------------------------------------------------- messages

  private handle(conn: Conn, msg: ClientMsg, now: number): void {
    const st = this.state!
    const seat = conn.data.token ? this.seatOf(conn.data.token) : null
    switch (msg.t) {
      case 'hello':
        return this.hello(conn, msg.token, msg.name, now, msg.skin, msg.colour)
      case 'name': {
        conn.data.name = msg.name || conn.data.name
        conn.save()
        if (seat !== null) st.seats[seat]!.name = conn.data.name
        return this.changed()
      }
      case 'settings': {
        if (seat === null || seat !== st.host || this.running) return this.refuse(conn, 'Only the host changes the match settings, between matches.')
        const cur = this.settings()
        st.settings = {
          countdown: msg.countdown ?? cur.countdown,
          pauses: msg.pauses ?? cur.pauses,
          pauseCount: msg.pauseCount !== undefined ? msg.pauseCount : cur.pauseCount,
          pauseLimit: msg.pauseLimit ?? cur.pauseLimit,
          pauseSecs: msg.pauseSecs ?? cur.pauseSecs,
        }
        st.rematch = [false, false]
        return this.changed()
      }
      case 'swap': {
        if (seat === null || seat !== st.host || this.running) return this.refuse(conn, 'Only the host swaps sides, between matches.')
        st.left = this.leftSeat() === 0 ? 1 : 0
        st.rematch = [false, false]
        return this.changed()
      }
      case 'map': {
        if (seat === null || seat !== st.host || this.running || !pvpMap(msg.id)) return this.refuse(conn, 'Only the host picks the map, between matches.')
        st.map = msg.id
        st.rematch = [false, false]
        return this.changed()
      }
      case 'start': {
        if (seat === null || seat !== st.host || this.running) return this.refuse(conn, 'Only the host starts the match.')
        if (!this.bothHere()) return this.refuse(conn, 'Waiting for a second player.')
        return this.startMatch(now)
      }
      case 'rematch': {
        if (seat === null || st.phase !== 'ended' || this.running) return
        st.rematch[seat] = msg.on
        if (st.rematch[0] && st.rematch[1] && this.bothHere()) return this.startMatch(now)
        return this.changed()
      }
      case 'surrender':
        if (seat === null || !this.running) return this.refuse(conn, 'There is no match to surrender.')
        return this.surrender(seat, now)
      case 'order':
        if (seat === null) return this.sendTo(conn, { t: 'ack', seq: msg.seq, ok: false })
        return this.order(conn, seat, msg.seq, msg.o, now)
      case 'leave':
        return this.leave(conn, seat, now)
      case 'hb':
        return
    }
  }

  private refuse(conn: Conn, msg: string): void {
    this.sendTo(conn, { t: 'error', code: 'notallowed', msg })
  }

  private hello(conn: Conn, token: string, name: string, now: number, skin?: SkinId, colour?: TeamColourId): void {
    const st = this.state!
    if (conn.data.token) return
    // The same tab connecting again (a reload, a dropped line): the old connection goes.
    for (const c of this.conns()) {
      if (c.data.id !== conn.data.id && c.data.token === token) {
        c.close(4001, 'replaced')
        this.buckets.delete(c.data.id)
      }
    }
    let seat = this.seatOf(token)
    if (seat === null && !this.running) {
      this.tidySeats(now)
      const free = st.seats.findIndex((s) => s === null)
      if (free >= 0) {
        seat = free as 0 | 1
        st.seats[seat] = { token, name: name || `Player ${seat + 1}`, leftAt: null, gone: false }
        st.rematch = [false, false]
        // A new player: sides go back to the default (host on the left).
        st.left = null
        if (st.host === null) st.host = seat
      }
    }
    if (seat === null) {
      const watching = this.conns().filter((c) => c.data.token && c.data.id !== conn.data.id && this.seatOf(c.data.token) === null).length
      if (watching >= PVP_RULES.maxSpectators) {
        this.sendTo(conn, { t: 'error', code: 'full', msg: 'This room is full.' })
        conn.close(4003, 'full')
        return
      }
    }
    conn.data.token = token
    conn.data.name = name || (seat !== null ? st.seats[seat]!.name : 'Watcher')
    conn.save()
    if (seat !== null) {
      const s = st.seats[seat]!
      s.leftAt = null
      if (name) s.name = name
      // Changes take effect at the next match (this one's skins are already shown).
      if (skin) s.skin = skin
      if (colour) s.colour = colour
      // Back in time: take the seat back from the AI.
      const m = this.match
      if (m && !m.over && m.ai[seat]) {
        m.sim.setController(m.sides[seat], null)
        m.ai[seat] = false
      }
    }
    this.changed()
    // Joining (or coming back) during or right after a match: the round as it is now.
    const m = this.match
    if (m) {
      this.sendTo(conn, this.startMsg(conn))
      this.sendTo(conn, { t: 'snap', match: m.id, s: encodeSnap(m.sim, m.tick, this.sideOf(conn), [], this.extra(now)) })
    }
  }

  private leave(conn: Conn, seat: 0 | 1 | null, now: number): void {
    const st = this.state!
    if (seat !== null) {
      const m = this.match
      if (m && !m.over) {
        st.seats[seat]!.gone = true
        st.seats[seat]!.leftAt = now
        this.takeOver(seat)
      } else {
        st.seats[seat] = null
        st.rematch = [false, false]
      }
      this.fixHost()
    }
    conn.data.token = null
    conn.save()
    conn.close(1000, 'left')
    this.changed(conn.data.id)
  }

  // ---------------------------------------------------------------- seats

  seatOf(token: string): 0 | 1 | null {
    const st = this.state
    if (!st) return null
    for (const i of SEATS) if (st.seats[i]?.token === token) return i
    return null
  }

  private connected(seat: 0 | 1): boolean {
    const s = this.state!.seats[seat]
    return !!s && !s.gone && this.conns().some((c) => c.data.token === s.token)
  }

  private bothHere(): boolean {
    return this.connected(0) && this.connected(1)
  }

  private stale(s: SeatState, now: number): boolean {
    return s.gone || (s.leftAt !== null && now - s.leftAt > PVP_RULES.graceMs)
  }

  /** Between matches: seats whose player left (or ran out of grace time) are freed. */
  private tidySeats(now: number): void {
    const st = this.state!
    for (const i of SEATS) {
      const s = st.seats[i]
      if (s && this.stale(s, now) && !this.connected(i)) {
        st.seats[i] = null
        st.rematch = [false, false]
      }
    }
    this.fixHost()
  }

  /** The host is a seated player; if the host's seat empties, the other player becomes host. */
  private fixHost(): void {
    const st = this.state!
    const ok = (i: 0 | 1 | null) => i !== null && !!st.seats[i] && !st.seats[i]!.gone
    if (ok(st.host)) return
    st.host = ok(0) ? 0 : ok(1) ? 1 : null
  }

  // ---------------------------------------------------------------- the match

  /** The match settings now (the defaults until the host changes them). */
  settings(): RoomSettings {
    return readSettings(this.state?.settings ?? DEFAULT_SETTINGS)
  }

  /** The seat that plays the left side next match: the host's unless swapped. */
  leftSeat(): 0 | 1 {
    const st = this.state!
    return st.left ?? st.host ?? 0
  }

  private startMatch(now: number): void {
    const st = this.state!
    const no = st.matchNo + 1
    // The left side is the 'player' (gold) side of every PvP map. The host
    // starts there unless they swapped; each rematch then swaps (fair maps
    // are mirrored, so either side is fair).
    const left = this.leftSeat()
    const sides: [Side, Side] = left === 0 ? ['player', 'enemy'] : ['enemy', 'player']
    st.left = PVP_RULES.swapSidesEachMatch ? (left === 0 ? 1 : 0) : left
    const settings = this.settings()
    const level = pvpLevel(pvpMap(st.map) ?? PVP_MAPS[0])
    // Each player always wears their own skin and colour (clients show name tags when the two clash; config/looks.ts).
    const seatOn = (side: Side): 0 | 1 => (sides[0] === side ? 0 : 1)
    const skins = pvpSkins(st.seats[seatOn('player')]?.skin, st.seats[seatOn('enemy')]?.skin)
    const colours = pvpColours(st.seats[seatOn('player')]?.colour, st.seats[seatOn('enemy')]?.colour)
    let sim: BattleSim | null = null
    const log = new EventLog(() => sim?.clock ?? 0)
    sim = new BattleSim(level, null, log.tap({}), lanesFor(level))
    sim.makePvp()
    // 3-2-1-Go: nothing fires and the match clock stands still until Go (both screens and watchers show it).
    // 3, 5 or 0 s ("Chaotic rush": firing starts at once), as the host set it.
    sim.startCountdown(settings.countdown * 1000)
    log.bind(sim)
    this.match = {
      id: rid(),
      sim,
      log,
      tick: 0,
      sides,
      skins,
      colours,
      pauses: settings.pauses,
      // Pauses off: nobody has any (older games show "0 pauses left" and the server refuses them). -1: unlimited.
      pausesLeft: !settings.pauses ? [0, 0] : settings.pauseCount === null ? [-1, -1] : [settings.pauseCount, settings.pauseCount],
      pauseMs: settings.pauseLimit ? settings.pauseSecs * 1000 : null,
      pausedAt: [[], []],
      lockUntil: [0, 0],
      lockNext: false,
      pause: null,
      ai: [false, false],
      last: now,
      acc: 0,
      lastSnap: -Infinity,
      why: null,
      over: false,
      emptySince: null,
    }
    st.matchNo = no
    st.rematch = [false, false]
    st.result = null
    st.sides = sides
    this.host.save(st)
    this.broadcastRoom()
    for (const c of this.conns()) if (c.data.token) this.sendTo(c, this.startMsg(c))
    this.sendSnaps(now)
    this.host.startLoop(() => this.tick(), LOOP_MS)
  }

  private startMsg(conn: Conn): ServerMsg {
    const m = this.match!
    const seat = conn.data.token ? this.seatOf(conn.data.token) : null
    return {
      t: 'start',
      match: m.id,
      level: m.sim.level,
      side: seat === null ? 'player' : m.sides[seat],
      stepMs: PVP_RULES.stepMs,
      skins: m.skins,
      colours: m.colours,
      ...(m.pauses ? {} : { pauses: false }),
      ...(seat === null ? { spectate: true } : {}),
    }
  }

  /** The match loop: step the round to now, apply the rules, send snapshots. */
  tick(): void {
    const m = this.match
    const st = this.state
    if (!m || !st || m.over) return this.host.stopLoop()
    const now = this.host.now()
    const sim = m.sim
    const dt = Math.min(250, Math.max(0, now - m.last))
    m.last = now
    if (!sim.paused && !sim.ended) {
      m.acc += dt
      let n = Math.min(15, Math.floor(m.acc / PVP_RULES.stepMs + 1e-9))
      m.acc -= n * PVP_RULES.stepMs
      while (n-- > 0 && !sim.ended) {
        sim.step(PVP_RULES.stepMs)
        m.tick += 1
      }
    } else m.acc = 0
    // A pause runs out.
    if (sim.paused && m.pause && now >= m.pause.until) {
      sim.resume()
      this.pauseEnded(m, now)
    }
    // Time is up: most cannons wins.
    if (!sim.ended && sim.clock >= PVP_RULES.matchMs) {
      const gold = sim.count('player')
      const pink = sim.count('enemy')
      m.why = 'time'
      sim.endMatch(gold > pink ? 'win' : pink > gold ? 'lose' : 'draw', 'time')
    }
    // Players gone too long: an AI takes their seat. Everyone gone: the match is dropped.
    for (const i of SEATS) {
      const s = st.seats[i]
      if (s && !m.ai[i] && s.leftAt !== null && (s.gone || now - s.leftAt > PVP_RULES.graceMs)) this.takeOver(i)
    }
    const anyone = this.connected(0) || this.connected(1)
    m.emptySince = anyone ? null : (m.emptySince ?? now)
    if (!sim.ended && m.emptySince !== null && now - m.emptySince > PVP_RULES.graceMs) {
      m.why = 'empty'
      const gold = sim.count('player')
      const pink = sim.count('enemy')
      sim.endMatch(gold > pink ? 'win' : pink > gold ? 'lose' : 'draw', 'empty')
    }
    if (sim.ended) return this.endMatch(now)
    // While paused, a few snapshots a second are plenty (the countdown).
    if (!sim.paused || now - m.lastSnap >= 250) this.sendSnaps(now)
  }

  /** A player gives up: the other seat wins straight away (paused or not, even in the countdown). */
  private surrender(seat: 0 | 1, now: number): void {
    const m = this.match!
    if (m.sim.ended) return
    m.why = 'surrender'
    m.pause = null
    // endMatch's outcome is gold's ('player'): gold surrendering is gold losing.
    m.sim.endMatch(m.sides[seat] === 'player' ? 'lose' : 'win', 'surrender')
    this.endMatch(now)
  }

  /** A pause is over: a spammed one starts its player's lockout now. */
  private pauseEnded(m: Match, now: number): void {
    if (m.pause && m.lockNext) {
      m.lockUntil[m.pause.seat] = now + PVP_RULES.pauseSpam.lockoutMs
      m.pausedAt[m.pause.seat] = []
    }
    m.lockNext = false
    m.pause = null
  }

  private takeOver(seat: 0 | 1): void {
    const m = this.match
    if (!m || m.over || m.ai[seat]) return
    m.ai[seat] = true
    m.sim.setController(m.sides[seat], PVP_RULES.takeoverAi)
    if (m.pause?.seat === seat) {
      m.sim.resume()
      this.pauseEnded(m, this.host.now())
    }
    this.broadcastRoom()
  }

  private endMatch(now: number): void {
    const m = this.match!
    const st = this.state!
    m.over = true
    this.host.stopLoop()
    const seatOfSide = (side: Side): 0 | 1 => (m.sides[0] === side ? 0 : 1)
    const w = m.sim.winner
    st.result = {
      winner: w === 'player' || w === 'enemy' ? seatOfSide(w) : null,
      why: m.why ?? 'wipe',
      cannons: [m.sim.count(m.sides[0]), m.sim.count(m.sides[1])],
    }
    st.phase = 'ended'
    st.rematch = [false, false]
    st.lastActive = now
    this.sendSnaps(now)
    this.tidySeats(now)
    this.host.save(st)
    this.broadcastRoom()
    this.schedule()
  }

  private order(conn: Conn, seat: 0 | 1, seq: number, raw: unknown, now: number): void {
    const m = this.match
    const order = parseOrder(raw)
    let ok = false
    if (m && !m.over && order && !m.sim.ended && !m.ai[seat]) {
      const sim = m.sim
      if (order.t === 'pause') {
        ok = m.pauses && !sim.paused && m.pausesLeft[seat] !== 0 && now >= m.lockUntil[seat] && sim.pause()
        if (ok) {
          if (m.pausesLeft[seat] > 0) m.pausesLeft[seat] -= 1
          const limited = m.pauseMs !== null
          m.pause = { seat, until: now + (m.pauseMs ?? PVP_RULES.pauseSafetyMs), limited }
          // Anti-spam: too many pauses in a short time and this one ends in a lockout.
          const spam = PVP_RULES.pauseSpam
          const times = m.pausedAt[seat].filter((t) => now - t < spam.windowMs)
          times.push(now)
          m.pausedAt[seat] = times
          m.lockNext = times.length >= spam.count
        }
      } else if (order.t === 'resume') {
        ok = sim.paused && m.pause?.seat === seat
        if (ok) {
          sim.resume()
          this.pauseEnded(m, now)
        }
      } else ok = applyOrder(sim, m.sides[seat], order).ok
    }
    this.sendTo(conn, { t: 'ack', seq, ok })
    // Pausing shows on both screens straight away.
    if (ok && m && (order!.t === 'pause' || order!.t === 'resume')) this.sendSnaps(now)
  }

  private sideOf(conn: Conn): Side {
    const m = this.match
    const seat = conn.data.token ? this.seatOf(conn.data.token) : null
    // Watchers see nobody's queued orders.
    return !m || seat === null ? 'neutral' : m.sides[seat]
  }

  private extra(now: number): SnapExtra {
    const m = this.match!
    const sim = m.sim
    const bySide = <T>(f: (seat: 0 | 1) => T): [T, T] => {
      const goldSeat: 0 | 1 = m.sides[0] === 'player' ? 0 : 1
      return [f(goldSeat), f(goldSeat === 0 ? 1 : 0)]
    }
    return {
      tl: Math.max(0, Math.round(PVP_RULES.matchMs - sim.clock)),
      pz: m.pause ? sideIx(m.sides[m.pause.seat]) : -1,
      pzl: !m.pause ? 0 : m.pause.limited ? Math.max(0, Math.round(m.pause.until - now)) : -1,
      pl: bySide((s) => m.pausesLeft[s]),
      plk: bySide((s) => Math.max(0, Math.round(m.lockUntil[s] - now))),
      ai: bySide((s) => (m.ai[s] ? 1 : 0)),
      on: bySide((s) => (this.connected(s) ? 1 : 0)),
      ...(m.over || sim.ended ? { why: m.why ?? 'wipe' } : {}),
    }
  }

  private sendSnaps(now: number): void {
    const m = this.match!
    m.lastSnap = now
    const events = m.log.take()
    const extra = this.extra(now)
    const texts = new Map<Side, string>()
    for (const c of this.conns()) {
      if (!c.data.token) continue
      const side = this.sideOf(c)
      let text = texts.get(side)
      if (!text) {
        text = JSON.stringify({ t: 'snap', match: m.id, s: encodeSnap(m.sim, m.tick, side, events, extra) } satisfies ServerMsg)
        texts.set(side, text)
      }
      this.stats.bytesOut += text.length
      c.send(text)
    }
    this.stats.snaps += 1
  }

  // ---------------------------------------------------------------- room info

  roomInfo(conn: Conn | null): RoomInfo {
    const st = this.state!
    const seatInfo = (i: 0 | 1): SeatInfo | null => {
      const s = st.seats[i]
      return s ? { name: s.name, connected: this.connected(i), ai: !!this.match && !this.match.over && this.match.ai[i] } : null
    }
    const seat = conn?.data.token ? this.seatOf(conn.data.token) : null
    const spectators = this.conns().filter((c) => c.data.token && this.seatOf(c.data.token) === null).length
    return {
      t: 'room',
      code: st.code,
      you: { seat, host: seat !== null && seat === st.host },
      seats: [seatInfo(0), seatInfo(1)],
      host: st.host,
      spectators,
      map: st.map,
      phase: this.running ? 'playing' : st.phase,
      match: st.matchNo,
      sides: st.sides,
      rematch: [...st.rematch],
      result: st.result,
      settings: this.settings(),
      left: this.leftSeat(),
      surrender: true,
      ...(st.region ? { server: { region: st.region, ...(st.colo ? { colo: st.colo } : {}) } } : {}),
    }
  }

  private changed(skipId?: string): void {
    if (this.state) this.host.save(this.state)
    this.broadcastRoom(skipId)
    this.schedule()
  }

  private broadcastRoom(skipId?: string): void {
    if (!this.state) return
    for (const c of this.conns()) if (c.data.token && c.data.id !== skipId) this.sendTo(c, this.roomInfo(c))
  }

  private sendTo(conn: Conn, msg: ServerMsg): void {
    const text = JSON.stringify(msg)
    this.stats.bytesOut += text.length
    conn.send(text)
  }

  /** One alarm: tidy seats after a drop, and close empty or idle rooms. */
  private schedule(): void {
    const st = this.state
    if (!st) return
    const now = this.host.now()
    const times: number[] = []
    if (this.conns().length === 0) times.push(st.lastActive + PVP_LIMITS.emptyRoomMs)
    else times.push(st.lastActive + PVP_LIMITS.idleRoomMs)
    if (!this.running) for (const s of st.seats) if (s && s.leftAt !== null) times.push(s.leftAt + PVP_RULES.graceMs + 500)
    const at = Math.max(now + 1000, Math.min(...times))
    this.host.setAlarm(at)
  }
}
