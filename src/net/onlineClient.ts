import { PVP } from '../config/pvp'
import { PVP_RULES } from '../config/pvpRules'
import type { ClientMsg, RoomInfo, ServerMsg } from './online'
import type { StartMsg } from './pvp'
import type { Transport } from './transport'

/**
 * The game's side of an online room: one WebSocket to the room's server,
 * reconnecting by itself (same tab = same seat), with ping times and traffic
 * counted. It is also the Transport the round's PvpClient listens on.
 */

const DEFAULT_SERVER = 'https://cannon-capture-server.sleepymiemoo.workers.dev'

/** The server: ?server=http://localhost:8787 for a local `wrangler dev` (localhost only), else the build's, else the live one. */
export function serverUrl(): string {
  const q = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('server')
  if (q && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(q)) return q
  return String(import.meta.env?.VITE_PVP_SERVER || DEFAULT_SERVER).replace(/\/$/, '')
}

/** This tab's token: a reload (or a dropped line) gets the same seat back. */
export function tabToken(): string {
  const key = 'cc-online-token'
  try {
    let t = sessionStorage.getItem(key)
    if (!t) {
      t = crypto.randomUUID()
      sessionStorage.setItem(key, t)
    }
    return t
  } catch {
    return crypto.randomUUID()
  }
}

export function savedName(): string {
  try {
    return localStorage.getItem('cc-online-name') ?? ''
  } catch {
    return ''
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem('cc-online-name', name)
  } catch {
    // Private mode: fine.
  }
}

/** Ask the server for a new room; resolves to its code. */
export async function createRoom(): Promise<string> {
  const res = await fetch(`${serverUrl()}/api/rooms`, { method: 'POST' })
  if (!res.ok) throw new Error(`The server said ${res.status}`)
  const body = (await res.json()) as { code?: string }
  if (!body.code) throw new Error('No room code came back')
  return body.code
}

export type RoomStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'
export type OnlineStart = StartMsg & { spectate?: boolean }

const now = () => performance.now()

/** Close codes from the server that mean: do not come back. */
const FATAL_CLOSE: Record<number, string> = {
  4001: 'This room was opened in another tab.',
  4003: 'The room is full.',
  4404: 'There is no room with that code.',
  4408: 'The room closed after a long quiet spell.',
  4429: 'Too many messages: the room hung up.',
}

export class OnlineRoom implements Transport {
  readonly id = 'online'
  /** The match the battle screen last opened (so the menu only jumps into new ones). */
  entered: string | null = null
  info: RoomInfo | null = null
  start: OnlineStart | null = null
  status: RoomStatus = 'connecting'
  /** Why it closed (a fatal error) or what was refused last. */
  error: { code: string; msg: string } | null = null
  /** Round trip of the last ping and the average of the last few (ms, fake lag included). */
  rtt: number | null = null
  rttAvg: number | null = null
  private rtts: number[] = []
  readonly stats = { bytesIn: 0, msgsIn: 0, bytesOut: 0, msgsOut: 0, since: now() }
  private ws: WebSocket | null = null
  private readonly handlers = new Set<(msg: unknown, from: string) => void>()
  private readonly listeners = new Set<() => void>()
  private pingAt: number[] = []
  private retry = 0
  private downSince: number | null = null
  private left = false
  private readonly timers: ReturnType<typeof setInterval>[] = []
  private lastOut = 0
  private lastIn = 0

  constructor(
    readonly code: string,
    public name: string,
    readonly token = tabToken(),
  ) {
    this.connect()
    this.timers.push(setInterval(() => this.ping(), 2000))
    // A match keeps its room awake anyway; this tells it now and then that we are still here.
    this.timers.push(setInterval(() => this.info?.phase === 'playing' && this.sendNow(JSON.stringify({ t: 'hb' } satisfies ClientMsg)), 15000))
  }

  get seat(): 0 | 1 | null {
    return this.info?.you.seat ?? null
  }

  /** Room info or connection changes. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private changed(): void {
    for (const fn of [...this.listeners]) fn()
  }

  private connect(): void {
    if (this.left) return
    const url = serverUrl().replace(/^http/, 'ws') + `/api/rooms/${this.code}/ws`
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      return this.lost()
    }
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.downSince = null
      this.pingAt = []
      this.status = 'open'
      this.sendNow(JSON.stringify({ t: 'hello', token: this.token, name: this.name } satisfies ClientMsg))
      this.changed()
    }
    ws.onmessage = (e) => {
      const text = String(e.data)
      this.stats.bytesIn += text.length
      this.stats.msgsIn += 1
      this.later(() => this.receive(text), true)
    }
    ws.onclose = (e) => {
      if (this.ws !== ws) return
      const fatal = FATAL_CLOSE[e.code]
      if (fatal && !this.left) {
        this.ws = null
        this.error ??= { code: 'closed', msg: fatal }
        this.left = true
        this.status = 'closed'
        this.stop()
        return this.changed()
      }
      this.lost()
    }
  }

  private lost(): void {
    this.ws = null
    if (this.left) return
    this.downSince ??= now()
    // Give up a little after the server would have given the seat away.
    if (now() - this.downSince > PVP_RULES.graceMs + 15_000) {
      this.status = 'closed'
      this.error ??= { code: 'lost', msg: 'Lost the connection to the room.' }
      this.left = true
      this.stop()
      return this.changed()
    }
    this.status = 'reconnecting'
    this.changed()
    const wait = Math.min(5000, 400 * 2 ** this.retry++)
    setTimeout(() => this.connect(), wait)
  }

  private receive(text: string): void {
    let msg: ServerMsg
    try {
      msg = JSON.parse(text) as ServerMsg
    } catch {
      return
    }
    if (msg.t === 'pong') {
      const at = this.pingAt.shift()
      if (at !== undefined) {
        this.rtt = Math.round(now() - at)
        this.rtts.push(this.rtt)
        if (this.rtts.length > 10) this.rtts.shift()
        this.rttAvg = Math.round(this.rtts.reduce((a, b) => a + b, 0) / this.rtts.length)
      }
    } else if (msg.t === 'room') {
      this.info = msg
      this.changed()
    } else if (msg.t === 'start') {
      this.start = msg
      this.changed()
    } else if (msg.t === 'error') {
      this.error = { code: msg.code, msg: msg.msg }
      if (msg.code === 'noroom' || msg.code === 'full' || msg.code === 'closed') {
        this.left = true
        this.status = 'closed'
        this.stop()
        this.ws?.close()
      }
      this.changed()
    }
    for (const fn of [...this.handlers]) fn(msg, 'server')
  }

  /** Fake network delay (?lag=, ?jitter=), each way, keeping the order. */
  private later(fn: () => void, incoming: boolean): void {
    if (PVP.lagMs <= 0 && PVP.jitterMs <= 0) return fn()
    const t = now()
    const due = Math.max(incoming ? this.lastIn : this.lastOut, t + PVP.lagMs + Math.random() * PVP.jitterMs)
    if (incoming) this.lastIn = due
    else this.lastOut = due
    setTimeout(fn, due - t)
  }

  private sendNow(text: string): void {
    this.later(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return
      this.stats.bytesOut += text.length
      this.stats.msgsOut += 1
      this.ws.send(text)
    }, false)
  }

  private ping(): void {
    if (this.status !== 'open') return
    this.pingAt.push(now())
    if (this.pingAt.length > 5) this.pingAt.shift()
    this.sendNow('{"t":"ping"}')
  }

  /** Transport: the round's messages (orders) and the lobby's. */
  send(msg: unknown): void {
    if (this.left) return
    this.sendNow(JSON.stringify(msg))
  }

  onMessage(fn: (msg: unknown, from: string) => void): () => void {
    this.handlers.add(fn)
    return () => this.handlers.delete(fn)
  }

  /** Transport: hanging up means leaving the room. */
  close(): void {
    this.leave()
  }

  setName(name: string): void {
    this.name = name
    this.send({ t: 'name', name } satisfies ClientMsg)
  }

  /** Leave for good (the seat is freed, or an AI takes it during a match). */
  leave(): void {
    if (this.left) return
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'leave' } satisfies ClientMsg))
    this.left = true
    this.status = 'closed'
    this.stop()
    const ws = this.ws
    this.ws = null
    setTimeout(() => ws?.close(1000, 'left'), 100)
    if (current === this) current = null
    this.changed()
  }

  private stop(): void {
    for (const t of this.timers) clearInterval(t)
    this.timers.length = 0
  }

  get closed(): boolean {
    return this.left
  }
}

let current: OnlineRoom | null = null

/** The room this tab is in (it outlives scenes: lobby, battle, lobby again). */
export const online = {
  get room(): OnlineRoom | null {
    return current
  },
  join(code: string, name: string): OnlineRoom {
    if (current && current.code === code && !current.closed) return current
    current?.leave()
    current = new OnlineRoom(code, name)
    if (typeof window !== 'undefined') (window as unknown as { __online?: () => OnlineRoom | null }).__online = () => current
    return current
  },
}
