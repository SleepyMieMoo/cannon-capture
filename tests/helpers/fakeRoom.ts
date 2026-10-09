import { expect } from 'vitest'
import type { RoomInfo } from '../../src/net/online'
import type { Snap } from '../../src/net/snapshot'
import { LOOP_MS, RoomCore, type Conn, type ConnData, type RoomHost, type RoomState } from '../../server/src/room'

/** A fake place for a room to run: a clock we move, connections we open and close. */
export class FakeHost implements RoomHost {
  t = 1_000_000
  open = new Set<FakeConn>()
  saved: RoomState | null | undefined
  saves = 0
  alarm: number | null = null
  loop: (() => void) | null = null
  now = () => this.t
  conns = () => [...this.open]
  save(state: RoomState | null) {
    this.saves += 1
    this.saved = state ? (JSON.parse(JSON.stringify(state)) as RoomState) : null
  }
  setAlarm(at: number | null) {
    this.alarm = at
  }
  startLoop(fn: () => void) {
    this.loop = fn
  }
  stopLoop() {
    this.loop = null
  }
}

let nextId = 0
export class FakeConn implements Conn {
  data: ConnData = { id: 'c' + nextId++, token: null, name: '' }
  inbox: Record<string, any>[] = []
  closed: { code: number; reason: string } | null = null
  constructor(
    private readonly host: FakeHost,
    private readonly room: RoomCore,
  ) {
    host.open.add(this)
    room.onConnect(this)
  }
  save() {}
  send(text: string) {
    this.inbox.push(JSON.parse(text))
  }
  close(code: number, reason: string) {
    if (this.closed) return
    this.closed = { code, reason }
    this.host.open.delete(this)
    this.room.onClose(this)
  }
  /** Drop the line (no Leave). */
  drop() {
    this.close(1006, 'dropped')
  }
  say(msg: unknown) {
    this.room.onMessage(this, typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  last<T = any>(t: string): T {
    for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i].t === t) return this.inbox[i] as T
    throw new Error('no ' + t)
  }
  all(t: string) {
    return this.inbox.filter((m) => m.t === t)
  }
  get room_(): RoomInfo {
    return this.last<RoomInfo>('room')
  }
  get snap(): Snap {
    return this.last<{ s: Snap }>('snap').s
  }
}

export function setup() {
  const host = new FakeHost()
  const room = new RoomCore(host, null)
  expect(room.init('ABCD')).toBe(true)
  const join = (token: string, name: string) => {
    const c = new FakeConn(host, room)
    c.say({ t: 'hello', token, name })
    return c
  }
  /** Run the match loop for `ms`. */
  const run = (ms: number) => {
    for (let t = 0; t < ms && host.loop; t += LOOP_MS) {
      host.t += LOOP_MS
      host.loop()
    }
  }
  return { host, room, join, run }
}

