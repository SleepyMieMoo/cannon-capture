import type { BattleSim } from '../sim/BattleSim'
import type { Cannon } from '../entities/Cannon'
import type { Order } from '../sim/orders'

/**
 * Online: would the server take this order from you, judging by your view
 * (your side is 'player' there)? The client only shows an order early and
 * sends it when this says yes, so it must never be stricter than the server
 * (sim/orders applyOrder and the BattleSim player* methods), or the order
 * is lost on your screen while the server would have taken it.
 */
export function clientAccepts(view: BattleSim, o: Order): boolean {
  const mine = (id: string): Cannon | null => {
    const c = view.byId(id)
    return c && c.side === 'player' ? c : null
  }
  switch (o.t) {
    case 'aim': {
      const c = mine(o.cannon)
      // A cannon under fire (capture progress against it) still takes orders: the server never refuses
      // those, and in a long match most cannons have been hit at some point (progress only heals away).
      if (!c) return false
      if ('cannon' in o.at) return !!view.byId(o.at.cannon) && o.at.cannon !== o.cannon
      return true
    }
    case 'stop': {
      const c = mine(o.cannon)
      return !!c && canStop(view, c)
    }
    case 'swap': {
      const c = mine(o.cannon)
      return !!c && (o.kind !== c.kind || view.queuedKind(c) !== null)
    }
    case 'auto':
      return !!mine(o.cannon) && !view.isPuzzle
    case 'autoAll':
      return true
    case 'pause':
      return !view.paused
    case 'resume':
      return view.paused
  }
}

/** Can "Stop aiming" do anything for this cannon? It has an aim now (and no stop queued yet), or, paused, a queued aim to cancel. */
export function canStop(view: BattleSim, c: Cannon): boolean {
  if (view.ended || c.side !== 'player') return false
  if (view.paused) return view.queuedAim(c) !== null || (!!c.aim() && !view.queuedStop(c))
  return !!c.aim()
}
