import { DurableObject } from 'cloudflare:workers'
import { isRoomCode, randomCode } from '../../src/net/online'
import { RoomCore, type Conn, type ConnData, type RoomHost, type RoomState } from './room'

/**
 * Cannon Capture online server: one Durable Object per room (named by its
 * code). The Worker creates rooms and passes WebSockets to them.
 *
 *   POST /api/rooms              -> { code }   a new room, placed near the creator
 *   GET  /api/rooms/ABCD/ws      WebSocket to that room (the protocol is src/net/online.ts)
 *   GET  /health
 */

export interface Env {
  ROOMS: DurableObjectNamespace<RoomDO>
  /** Comma-separated origins allowed to use the server ("*" for any port: http://localhost:*). */
  ALLOWED_ORIGINS: string
}

/** Rooms start near whoever creates them (Cloudflare's coarse location hints). */
const HINTS: Record<string, DurableObjectLocationHint> = { AS: 'apac', OC: 'oc', EU: 'weur', NA: 'enam', SA: 'sam', AF: 'afr' }

function originAllowed(origin: string | null, env: Env): boolean {
  // Non-browser clients send no Origin (tests, tools); browsers always do.
  if (!origin) return true
  return env.ALLOWED_ORIGINS.split(',').some((pattern) => {
    const p = pattern.trim()
    if (!p) return false
    if (p.endsWith(':*')) return origin.startsWith(p.slice(0, -1)) && /^\d+$/.test(origin.slice(p.length - 1))
    return origin === p
  })
}

function withCors(res: Response, origin: string | null, allowed: boolean): Response {
  if (origin && allowed) {
    res.headers.set('Access-Control-Allow-Origin', origin)
    res.headers.set('Vary', 'Origin')
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  }
  return res
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const origin = req.headers.get('Origin')
    const allowed = originAllowed(origin, env)
    if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), origin, allowed)
    if (url.pathname === '/' || url.pathname === '/health') return withCors(json({ ok: true, name: 'cannon-capture-server' }), origin, allowed)
    if (!allowed) return json({ error: 'origin not allowed' }, 403)

    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      const continent = (req as Request & { cf?: { continent?: string } }).cf?.continent ?? ''
      const locationHint = HINTS[continent] ?? 'apac'
      for (let i = 0; i < 6; i++) {
        const code = randomCode()
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code), { locationHint })
        if (await stub.create(code)) return withCors(json({ code, near: locationHint }), origin, allowed)
      }
      return withCors(json({ error: 'no free code, try again' }, 503), origin, allowed)
    }

    const m = url.pathname.match(/^\/api\/rooms\/([A-Z]+)\/ws$/)
    if (m) {
      if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'expected a WebSocket' }, 426)
      if (!isRoomCode(m[1])) return json({ error: 'no such room' }, 404)
      return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req)
    }
    return withCors(json({ error: 'not found' }, 404), origin, allowed)
  },
} satisfies ExportedHandler<Env>

const rid = () => crypto.randomUUID().slice(0, 8)

/**
 * One room. WebSockets use the Hibernation API: between matches (the lobby,
 * the end screen) the room can sleep with everyone still connected and costs
 * nothing; plain {"t":"ping"} keep-alives are answered without waking it.
 * During a match a timer steps the round, so it stays awake (5 minutes at most).
 */
export class RoomDO extends DurableObject<Env> {
  private core!: RoomCore
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly conns = new WeakMap<WebSocket, Conn>()
  private readonly closed = new WeakSet<WebSocket>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'))
    void ctx.blockConcurrencyWhile(async () => {
      const state = (await ctx.storage.get<RoomState>('room')) ?? null
      this.core = new RoomCore(this.roomHost(), state)
    })
  }

  private roomHost(): RoomHost {
    const ctx = this.ctx
    return {
      now: () => Date.now(),
      conns: () =>
        ctx
          .getWebSockets()
          .filter((ws) => ws.readyState === WebSocket.OPEN && !this.closed.has(ws))
          .map((ws) => this.conn(ws)),
      save: (state) => {
        if (state) void ctx.storage.put('room', state)
        else void ctx.storage.deleteAll()
      },
      setAlarm: (at) => {
        if (at === null) void ctx.storage.deleteAlarm()
        else void ctx.storage.setAlarm(at)
      },
      startLoop: (fn, everyMs) => {
        if (this.timer) clearInterval(this.timer)
        this.timer = setInterval(fn, everyMs)
      },
      stopLoop: () => {
        if (this.timer) clearInterval(this.timer)
        this.timer = null
      },
    }
  }

  private conn(ws: WebSocket): Conn {
    let c = this.conns.get(ws)
    if (!c) {
      const data = (ws.deserializeAttachment() as ConnData | null) ?? { id: rid(), token: null, name: '' }
      c = {
        data,
        save: () => ws.serializeAttachment(data),
        send: (text) => {
          try {
            ws.send(text)
          } catch {
            // Already closing.
          }
        },
        close: (code, reason) => {
          if (this.closed.has(ws)) return
          this.closed.add(ws)
          try {
            ws.close(code, reason)
          } catch {
            // Already closed.
          }
          this.core.onClose(c!)
        },
      }
      this.conns.set(ws, c)
    }
    return c
  }

  /** The Worker asks for a new room with this code; false if the code is taken. */
  async create(code: string): Promise<boolean> {
    return this.core.init(code)
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected a WebSocket', { status: 426 })
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ id: rid(), token: null, name: '' } satisfies ConnData)
    this.core.onConnect(this.conn(server))
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (this.closed.has(ws)) return
    this.core.onMessage(this.conn(ws), message)
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    if (!this.closed.has(ws)) {
      this.closed.add(ws)
      this.core.onClose(this.conn(ws))
    }
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye')
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011)
  }

  async alarm(): Promise<void> {
    this.core.onAlarm()
  }
}
