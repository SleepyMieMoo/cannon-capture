import { CANNON_KINDS, type CannonKind, type Point, type Side } from '../types'
import type { BattleSim } from './BattleSim'

/**
 * Everything a player can tell the round to do. The battle screen sends its
 * clicks and keys through here, and in player vs player the other player's
 * orders arrive in the same shape over the network, so both go through one
 * set of checks (applyOrder). Cannons are named by id, so an order is plain
 * JSON.
 */
export type Order =
  /** Aim a cannon at another cannon (a foe to capture, a friend to heal) or at a point. */
  | { t: 'aim'; cannon: string; at: { cannon: string } | Point }
  /** Stop aiming: the cannon drops its aim (and any heal) and holds its fire until it gets a new one. */
  | { t: 'stop'; cannon: string }
  /** Change a cannon's tower type (queued while paused; its current type cancels a queued swap). */
  | { t: 'swap'; cannon: string; kind: CannonKind }
  /** Flip one cannon's own auto-target toggle. */
  | { t: 'auto'; cannon: string }
  /** The Settings toggle: auto-target on or off for all your cannons. */
  | { t: 'autoAll'; on: boolean }
  /** Tactical pause / resume. */
  | { t: 'pause' }
  | { t: 'resume' }

export interface OrderResult {
  ok: boolean
  /** auto: the cannon's toggle afterwards. */
  on?: boolean
}

const NO: OrderResult = { ok: false }

/** Apply `order` for `side`. Orders for another side's cannons, or that don't make sense now, are refused. */
export function applyOrder(sim: BattleSim, side: Side, order: Order): OrderResult {
  if (!sim.isHuman(side)) return NO
  switch (order.t) {
    case 'aim': {
      const cannon = sim.byId(order.cannon)
      if (!cannon) return NO
      const at = 'cannon' in order.at ? sim.byId(order.at.cannon) : clampToBoard(sim, order.at)
      if (!at || at === cannon) return NO
      return { ok: sim.playerAim(cannon, at, side) }
    }
    case 'stop': {
      const cannon = sim.byId(order.cannon)
      return { ok: !!cannon && sim.playerStop(cannon, side) }
    }
    case 'swap': {
      const cannon = sim.byId(order.cannon)
      return { ok: !!cannon && sim.playerSwap(cannon, order.kind, side) }
    }
    case 'auto': {
      const cannon = sim.byId(order.cannon)
      if (!cannon || sim.ended || sim.isPuzzle) return NO
      const on = sim.toggleCannonAuto(cannon, side)
      return on === null ? NO : { ok: true, on }
    }
    case 'autoAll':
      if (sim.ended || sim.isPuzzle) return NO
      sim.setAutoTarget(order.on, side)
      return { ok: true, on: order.on }
    case 'pause':
      return { ok: !sim.paused && sim.pause() }
    case 'resume':
      if (!sim.paused || sim.ended) return NO
      sim.resume()
      return { ok: true }
  }
}

function clampToBoard(sim: BattleSim, p: Point): Point {
  const b = sim.board
  return { x: Math.min(b.x + b.w, Math.max(b.x, p.x)), y: Math.min(b.y + b.h, Math.max(b.y, p.y)) }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64

/** Check an order that came from outside (the network): the right shape, or null. */
export function parseOrder(raw: unknown): Order | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  switch (o.t) {
    case 'aim': {
      if (!isId(o.cannon) || !o.at || typeof o.at !== 'object') return null
      const at = o.at as Record<string, unknown>
      if (isId(at.cannon)) return { t: 'aim', cannon: o.cannon, at: { cannon: at.cannon } }
      if (isNum(at.x) && isNum(at.y)) return { t: 'aim', cannon: o.cannon, at: { x: at.x, y: at.y } }
      return null
    }
    case 'swap':
      return isId(o.cannon) && (CANNON_KINDS as readonly unknown[]).includes(o.kind) ? { t: 'swap', cannon: o.cannon, kind: o.kind as CannonKind } : null
    case 'auto':
      return isId(o.cannon) ? { t: 'auto', cannon: o.cannon } : null
    case 'stop':
      return isId(o.cannon) ? { t: 'stop', cannon: o.cannon } : null
    case 'autoAll':
      return typeof o.on === 'boolean' ? { t: 'autoAll', on: o.on } : null
    case 'pause':
    case 'resume':
      return { t: o.t }
    default:
      return null
  }
}
