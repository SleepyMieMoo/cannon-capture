import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

/** A WebSocket to a room through the real Worker, collecting what the room sends. */
async function connect(code: string, origin?: string) {
  const res = await SELF.fetch(`https://server.test/api/rooms/${code}/ws`, { headers: { Upgrade: 'websocket', ...(origin ? { Origin: origin } : {}) } })
  const ws = res.webSocket
  if (!ws) return { status: res.status, ws: null, inbox: [] as any[], next: async () => null }
  ws.accept()
  const inbox: any[] = []
  const waiters: ((m: any) => void)[] = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data))
    inbox.push(m)
    for (const w of waiters.splice(0)) w(m)
  })
  /** Wait for a message of type `t` (already received or coming). */
  const next = (t: string, since = 0, ms = 3000): Promise<any> =>
    new Promise((resolve, reject) => {
      const found = inbox.slice(since).find((m) => m.t === t)
      if (found) return resolve(found)
      const timer = setTimeout(() => reject(new Error('timeout waiting for ' + t + ' got ' + inbox.map((m) => m.t).join(','))), ms)
      const check = (m: any) => {
        if (m.t === t) {
          clearTimeout(timer)
          resolve(m)
        } else waiters.push(check)
      }
      waiters.push(check)
    })
  return { status: res.status, ws, inbox, next }
}

async function createRoom(origin = 'https://sleepymiemoo.github.io'): Promise<string> {
  const res = await SELF.fetch('https://server.test/api/rooms', { method: 'POST', headers: { Origin: origin } })
  expect(res.status).toBe(200)
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin)
  const body = (await res.json()) as { code: string }
  return body.code
}

describe('worker + room Durable Object', () => {
  it('health check', async () => {
    const res = await SELF.fetch('https://server.test/health')
    expect(await res.json()).toMatchObject({ ok: true })
  })

  it('creates a room, seats two players over WebSockets, and runs a match with snapshots', async () => {
    const code = await createRoom()
    expect(code).toMatch(/^[A-Z]{4}$/)
    const a = await connect(code, 'https://sleepymiemoo.github.io')
    a.ws!.send(JSON.stringify({ t: 'hello', token: 'token-aaaaaaaa', name: 'Nova' }))
    const ra = await a.next('room')
    expect(ra.you).toEqual({ seat: 0, host: true })
    const b = await connect(code, 'http://localhost:5173')
    b.ws!.send(JSON.stringify({ t: 'hello', token: 'token-bbbbbbbb', name: 'Friend' }))
    expect((await b.next('room')).you.seat).toBe(1)
    a.ws!.send(JSON.stringify({ t: 'start' }))
    const start = await b.next('start')
    expect(start.side).toBe('enemy')
    const n = b.inbox.length
    b.ws!.send(JSON.stringify({ t: 'order', seq: 7, o: { t: 'aim', cannon: 'e1', at: { cannon: 'p1' } } }))
    expect(await b.next('ack', n)).toEqual({ t: 'ack', seq: 7, ok: true })
    // Snapshots keep coming from the room's timer.
    await new Promise((r) => setTimeout(r, 400))
    const snaps = b.inbox.filter((m) => m.t === 'snap')
    expect(snaps.length).toBeGreaterThan(3)
    expect(snaps[snaps.length - 1].s.tick).toBeGreaterThan(10)
    // The plain ping is answered (by the runtime, without waking the room).
    const k = a.inbox.length
    a.ws!.send('{"t":"ping"}')
    expect(await a.next('pong', k)).toEqual({ t: 'pong' })
    a.ws!.send(JSON.stringify({ t: 'leave' }))
    b.ws!.send(JSON.stringify({ t: 'leave' }))
  })

  it('refuses unknown rooms, bad codes, other sites, and plain requests', async () => {
    const c = await connect('ZZZZ')
    expect((await c.next('error')).code).toBe('noroom')
    expect((await connect('ab12')).status).toBe(404)
    expect((await connect('ABCD', 'https://evil.example')).status).toBe(403)
    const res = await SELF.fetch('https://server.test/api/rooms', { method: 'POST', headers: { Origin: 'https://evil.example' } })
    expect(res.status).toBe(403)
    expect((await SELF.fetch('https://server.test/api/rooms/ABCD/ws')).status).toBe(426)
  })
})
