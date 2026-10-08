/**
 * How the two players' games talk. Phase 0 only has fake transports: a
 * BroadcastChannel between tabs of the same browser (?pvpdev) and an
 * in-memory pair for tests. A WebSocket one comes with the server.
 */
export interface Transport {
  /** This end's id (random per page load). */
  readonly id: string
  send(msg: unknown): void
  /** Returns an unsubscribe function. */
  onMessage(fn: (msg: unknown, from: string) => void): () => void
  close(): void
}

interface Envelope {
  room: string
  from: string
  msg: unknown
}

export const randomId = (): string => Math.random().toString(36).slice(2, 10)

/**
 * Tabs of the same browser (same origin) in one room. Optional fake lag
 * (ms, plus up to `jitterMs`) to try the game as if over a network; messages
 * still arrive in order.
 */
export class BroadcastTransport implements Transport {
  readonly id = randomId()
  private readonly channel: BroadcastChannel
  private readonly handlers = new Set<(msg: unknown, from: string) => void>()
  private lastDue = 0
  private closed = false

  constructor(
    private readonly room: string,
    private readonly lagMs = 0,
    private readonly jitterMs = 0,
  ) {
    this.channel = new BroadcastChannel(`cannon-capture-pvp:${room}`)
    this.channel.onmessage = (e: MessageEvent<Envelope>) => {
      const env = e.data
      if (!env || env.room !== this.room || env.from === this.id) return
      this.deliver(env)
    }
  }

  private deliver(env: Envelope): void {
    if (this.lagMs <= 0 && this.jitterMs <= 0) {
      for (const fn of this.handlers) fn(env.msg, env.from)
      return
    }
    const now = performance.now()
    const due = Math.max(this.lastDue, now + this.lagMs + Math.random() * this.jitterMs)
    this.lastDue = due
    setTimeout(() => {
      for (const fn of this.handlers) fn(env.msg, env.from)
    }, due - now)
  }

  send(msg: unknown): void {
    // Sending on a closed channel throws; a late message after hanging up is simply dropped.
    if (this.closed) return
    this.channel.postMessage({ room: this.room, from: this.id, msg } satisfies Envelope)
  }

  onMessage(fn: (msg: unknown, from: string) => void): () => void {
    this.handlers.add(fn)
    return () => this.handlers.delete(fn)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.handlers.clear()
    this.channel.close()
  }
}

/**
 * Two connected in-memory ends for tests. Messages are JSON round-tripped
 * (like a real network) and queued until flush(), so a test decides when
 * they "arrive".
 */
export function loopbackPair(): [LoopbackEnd, LoopbackEnd] {
  const a = new LoopbackEnd('a')
  const b = new LoopbackEnd('b')
  a.peer = b
  b.peer = a
  return [a, b]
}

export class LoopbackEnd implements Transport {
  peer: LoopbackEnd | null = null
  private readonly handlers = new Set<(msg: unknown, from: string) => void>()
  private inbox: string[] = []
  /** Bytes sent from this end (JSON), for bandwidth checks. */
  bytesSent = 0
  constructor(readonly id: string) {}

  send(msg: unknown): void {
    const text = JSON.stringify(msg)
    this.bytesSent += text.length
    this.peer?.inbox.push(text)
  }

  onMessage(fn: (msg: unknown, from: string) => void): () => void {
    this.handlers.add(fn)
    return () => this.handlers.delete(fn)
  }

  /** Deliver everything that has arrived. */
  flush(): void {
    const inbox = this.inbox
    this.inbox = []
    for (const text of inbox) for (const fn of this.handlers) fn(JSON.parse(text), this.peer?.id ?? '')
  }

  close(): void {
    this.handlers.clear()
    this.peer = null
  }
}
