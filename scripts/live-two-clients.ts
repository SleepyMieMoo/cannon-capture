// Two real clients against a local worker (wrangler dev): a long match with many orders.
// Run: npx esbuild scripts/live-two-clients.ts --bundle --platform=node --format=esm --outfile=/tmp/live2.mjs && node /tmp/live2.mjs (Node 22; OLD=1 replays the 0.7.7 check)
import { PVP_RULES } from '../src/config/pvpRules'
import { PVP_MAPS } from '../src/net/online'
import { BattleSim } from '../src/sim/BattleSim'
import { levelLanes } from '../src/sim/solver'
import { applySnap, type Snap } from '../src/net/snapshot'
import { clientAccepts } from '../src/net/orderCheck'
import type { Order } from '../src/sim/orders'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8799'
const OLD = process.env.OLD === '1' // the old (0.7.7) client check: refuse damaged cannons
const SECS = Number(process.env.SECS ?? 150)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class Client {
  ws!: WebSocket
  view: BattleSim | null = null
  flip = false
  snap: Snap | null = null
  seq = 0
  acks = { ok: 0, no: 0 }
  pending = new Map<number, number>()
  closed: number | null = null
  errors: string[] = []
  constructor(public code: string, public token: string, public name: string) {}
  connect() {
    return new Promise<void>((res) => {
      this.ws = new WebSocket(BASE.replace('http', 'ws') + `/api/rooms/${this.code}/ws`)
      this.ws.onopen = () => {
        this.say({ t: 'hello', token: this.token, name: this.name })
        res()
      }
      this.ws.onclose = (e) => (this.closed = e.code)
      this.ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data))
        if (m.t === 'start') {
          this.flip = m.side === 'enemy'
          if (!this.view) {
            this.view = new BattleSim(m.level, null, {}, levelLanes(m.level))
            this.view.makePvp()
          }
        } else if (m.t === 'snap') this.snap = m.s
        else if (m.t === 'ack') {
          this.pending.delete(m.seq)
          m.ok ? this.acks.ok++ : this.acks.no++
        } else if (m.t === 'error') this.errors.push(m.code + ': ' + m.msg)
      }
    })
  }
  say(m: unknown) {
    this.ws.send(JSON.stringify(m))
  }
  order(o: Order) {
    this.seq += 1
    this.pending.set(this.seq, Date.now())
    this.say({ t: 'order', seq: this.seq, o })
  }
  sync() {
    if (this.view && this.snap) applySnap(this.view, this.snap, this.snap, 0, this.snap, this.flip, PVP_RULES.stepMs)
  }
}

const check = (v: BattleSim, o: Order) => {
  if (OLD && o.t === 'aim' && v.byId(o.cannon)?.damaged) return false
  return clientAccepts(v, o)
}

async function main() {
  const { code } = (await (await fetch(BASE + '/api/rooms', { method: 'POST' })).json()) as { code: string }
  const a = new Client(code, 'live-token-aaaaaaaa', 'A')
  const b = new Client(code, 'live-token-bbbbbbbb', 'B')
  await a.connect()
  await b.connect()
  await sleep(300)
  a.say({ t: 'map', id: PVP_MAPS[0].id })
  a.say({ t: 'settings', countdown: 0 })
  a.say({ t: 'start' })
  await sleep(1500)
  let s = 7
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const st = { tries: 0, sent: 0, refusedLegal: 0, firstRefuse: -1, stuck: 0, reconnects: 0, pauses: 0 }
  const t0 = Date.now()
  for (let i = 0; (Date.now() - t0) / 1000 < SECS; i++) {
    await sleep(400)
    const t = (Date.now() - t0) / 1000
    if (i % 75 === 15) (a.order({ t: 'pause' }), st.pauses++)
    if (i % 75 === 22) a.order({ t: 'resume' })
    if (i === 30) {
      b.ws.close()
      await sleep(500)
      await b.connect()
      st.reconnects++
    }
    for (const p of [a, b]) {
      p.sync()
      const v = p.view
      if (!v || v.ended) continue
      const mine = v.cannons.filter((c) => c.side === 'player')
      const others = v.cannons.filter((c) => c.side !== 'player')
      if (!mine.length || !others.length) continue
      const c = mine[Math.floor(rand() * mine.length)]
      const r = rand()
      const o: Order = r < 0.8 ? { t: 'aim', cannon: c.id, at: { cannon: others[Math.floor(rand() * others.length)].id } } : { t: 'stop', cannon: c.id }
      st.tries++
      const ok = check(v, o)
      if (o.t === 'aim' && !ok) {
        st.refusedLegal++
        if (st.firstRefuse < 0) st.firstRefuse = Math.round(t)
      }
      if (ok) (p.order(o), st.sent++)
      // A burst now and then (spam-clicking).
      if (i % 20 === 0) for (let k = 0; k < 20; k++) p.say({ t: 'hb' })
    }
    if (a.view?.ended || b.view?.ended) break
  }
  await sleep(2000)
  for (const p of [a, b]) st.stuck += [...p.pending.values()].filter((at) => Date.now() - at > 1500).length
  const res = { old: OLD, secs: Math.round((Date.now() - t0) / 1000), ended: a.view?.ended, ...st, acksA: a.acks, acksB: b.acks, closedA: a.closed, closedB: b.closed, errA: a.errors.slice(0, 3), errB: b.errors.slice(0, 3) }
  console.log(JSON.stringify(res))
  a.ws.close()
  b.ws.close()
  process.exit(0)
}
main()
