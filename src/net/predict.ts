import { Cannon } from '../entities/Cannon'
import { turnSpeedDegFor } from '../config/kinds'
import { aimAngle } from '../sim/ballistics'
import { angleDelta, turnToward } from '../sim/aim'
import type { BattleSim } from '../sim/BattleSim'
import type { Order } from '../sim/orders'
import type { Point } from '../types'

/**
 * Client-side prediction for online play: your own orders (aim, tower swap,
 * auto-target) show on your screen the moment you give them, instead of a
 * round trip later. The server still decides: each order stays "predicted"
 * until the server has answered and the picture being drawn already includes
 * it; then the server's state simply takes over (it shows the same thing, so
 * nothing moves). If the server says no, the prediction is dropped at once.
 *
 * Barrels: a predicted aim turns your barrel at its normal speed right away.
 * The server's barrel (drawn a little in the past) turns the same way a bit
 * later, so your barrel keeps its lead until the server's catches up, and only
 * eases over (never snaps) if the server ends up aiming somewhere else.
 */

export const PREDICT = {
  /** Give up on a prediction the server never answered (ms). */
  timeoutMs: 5000,
  /** A correction turns the barrel this many times faster than a cannon turns. */
  correctTurn: 3,
  /** Points within this distance count as the same aim (the server rounds and clamps them). */
  samePointPx: 3,
} as const

interface Pending {
  seq: number
  order: Order
  at: number
  /** Auto toggles: the value shown. */
  on?: boolean
  /** The first snapshot number that includes it (known once the server says ok). */
  confirmN: number | null
}

type AimRef = { cannon: string } | Point

interface Lead {
  angle: number
  aim: AimRef
}

const predictable = (o: Order): boolean => o.t === 'aim' || o.t === 'swap' || o.t === 'auto' || o.t === 'autoAll'

/** Show an aim on a view's cannon the way the server will apply it (sim applyAim). */
export function showAim(c: Cannon, aim: Cannon | Point): void {
  if (!c.fires) {
    if (aim instanceof Cannon && aim.side !== c.side) {
      c.target = aim
      c.aimPoint = null
    } else if (aim !== c) {
      c.target = null
      c.aimPoint = { x: aim.x, y: aim.y }
    }
    c.healing = null
    return
  }
  if (aim instanceof Cannon) {
    if (aim === c) return
    c.target = aim
    c.aimPoint = null
    c.healing = aim.side === c.side ? aim : null
    return
  }
  c.target = null
  c.aimPoint = { x: aim.x, y: aim.y }
  c.healing = null
}

function sameAim(c: Cannon, aim: AimRef): boolean {
  if ('cannon' in aim) return c.target?.id === aim.cannon
  if (c.target || !c.aimPoint) return false
  return Math.hypot(c.aimPoint.x - aim.x, c.aimPoint.y - aim.y) <= PREDICT.samePointPx
}

export class Predictor {
  private pending: Pending[] = []
  private readonly leads = new Map<string, Lead>()
  /** Orders shown early so far, and ones the server turned down (stats). */
  shown = 0
  refused = 0

  /** An order was sent. `on`: the value a toggle now shows. */
  add(seq: number, order: Order, at: number, on?: boolean): void {
    if (!predictable(order)) return
    this.pending.push({ seq, order, at, on, confirmN: null })
    this.shown++
  }

  /**
   * The server answered order `seq`. `nextN`: the number the next snapshot
   * will get (every snapshot after this answer includes the order).
   */
  ack(seq: number, ok: boolean, nextN: number): void {
    const i = this.pending.findIndex((p) => p.seq === seq)
    if (i < 0) return
    if (!ok) {
      this.pending.splice(i, 1)
      this.refused++
      return
    }
    this.pending[i].confirmN = nextN
  }

  get size(): number {
    return this.pending.length
  }

  get leading(): number {
    return this.leads.size
  }

  clear(): void {
    this.pending.length = 0
    this.leads.clear()
  }

  /**
   * After the snapshot is on the view: lay the predictions over it.
   * `baseN`: the snapshot whose cannons are drawn; `latestN`: the newest one
   * (a paused round shows queued orders from the newest).
   */
  apply(view: BattleSim, baseN: number, latestN: number, now: number, frameMs: number): void {
    const paused = view.paused
    this.pending = this.pending.filter((p) => !(p.confirmN !== null && (paused ? latestN : baseN) >= p.confirmN) && now - p.at < PREDICT.timeoutMs)
    let queued: ReturnType<BattleSim['queuedOrders']> | null = null
    for (const p of this.pending) {
      const o = p.order
      if (o.t === 'autoAll') {
        view.setAutoTarget(p.on ?? o.on, 'player')
        continue
      }
      if (o.t !== 'aim' && o.t !== 'swap' && o.t !== 'auto') continue
      const c = view.byId(o.cannon)
      // Captured meanwhile (or not ours): the server will refuse it; show what is.
      if (!c || c.side !== 'player') continue
      if (o.t === 'auto') {
        if (p.on !== undefined) c.autoTarget = p.on
        continue
      }
      if (paused) {
        // Paused: orders queue up (shown as ghosts); the newest snapshot's list is the base.
        queued ??= view.queuedOrders()
        let q = queued.find((e) => e.cannon === c)
        if (!q) queued.push((q = { cannon: c, aim: null, kind: null }))
        if (o.t === 'aim') q.aim = 'cannon' in o.at ? (view.byId(o.at.cannon) ?? null) : { x: o.at.x, y: o.at.y }
        else q.kind = o.kind === c.kind ? null : o.kind
        continue
      }
      if (o.t === 'aim') {
        const at = 'cannon' in o.at ? view.byId(o.at.cannon) : o.at
        if (!at) continue
        if (!this.leads.has(c.id)) this.leads.set(c.id, { angle: c.angle, aim: o.at })
        else this.leads.get(c.id)!.aim = o.at
        showAim(c, at)
      } else c.showNetSwap(o.kind, now - p.at)
    }
    if (queued) view.setViewQueued(queued.filter((q) => q.aim || q.kind))
    this.steer(view, frameMs)
  }

  /** Barrels with a lead: keep turning them at their own speed until the server's barrel catches up. */
  private steer(view: BattleSim, frameMs: number): void {
    for (const [id, lead] of this.leads) {
      const c = view.byId(id)
      if (!c || c.side !== 'player') {
        this.leads.delete(id)
        continue
      }
      const step = ((turnSpeedDegFor(c.kind) * Math.PI) / 180) * (Math.max(0, frameMs) / 1000)
      const waiting = this.pending.some((p) => p.order.t === 'aim' && p.order.cannon === id)
      const aim = c.aim()
      if (aim && sameAim(c, lead.aim)) {
        const want = aimAngle(c, aim)
        lead.angle = turnToward(lead.angle, want, step)
        const serverLeft = Math.abs(angleDelta(c.angle, want))
        const leadLeft = Math.abs(angleDelta(lead.angle, want))
        if (!waiting && serverLeft <= leadLeft + 1e-3) {
          this.leads.delete(id)
          continue
        }
      } else {
        // The server aims somewhere else (refused, or it changed since): ease over to its barrel.
        lead.angle = turnToward(lead.angle, c.angle, step * PREDICT.correctTurn)
        if (Math.abs(angleDelta(lead.angle, c.angle)) < 1e-3) {
          this.leads.delete(id)
          continue
        }
      }
      c.angle = lead.angle
    }
  }
}
