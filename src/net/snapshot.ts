import { Cannon, type CannonNet } from '../entities/Cannon'
import { Shot } from '../entities/Shot'
import type { BattleSim, SimEvents } from '../sim/BattleSim'
import { CANNON_KINDS, type CannonKind, type Point, type Side } from '../types'

/**
 * Snapshots: the authoritative round's state, small and plain JSON, for a
 * player who only draws it (player vs player). The host encodes one every few
 * steps; the other side blends the two around its render time into a view
 * BattleSim that is never stepped, so the normal battle screen draws it.
 *
 * Cannons go by their index in the level and sides/types by small numbers.
 * Positions are rounded to 0.1 px and angles to 0.001 rad.
 */

const SIDES: Side[] = ['player', 'enemy', 'neutral']
const sideNo = (s: Side | null): number => (s === null ? -1 : SIDES.indexOf(s))
const kindNo = (k: CannonKind | null): number => (k === null ? -1 : CANNON_KINDS.indexOf(k))
const r1 = (v: number) => Math.round(v * 10) / 10
const r3 = (v: number) => Math.round(v * 1000) / 1000

/** One cannon: [side, kind, angle, target, aimX, aimY, attacker, progress, healing, auto, hitFlash, healFlash, swapTotal, swapLeft, muzzle, shotsFired, pop, shieldHp, shieldDown, shieldFlash, shieldBreakFx]. */
export type CannonRow = number[]
/** One shot: [id, side, kind, x, y, vx, vy]. */
export type ShotRow = number[]
/** A queued order (paused): [cannon, target (-1 none), aimX, aimY (NaN-free: -1 when none), kind (-1 none), hasAim]. */
export type QueuedRow = number[]

/** A sim event to replay on the view, at its sim time: [clock, type, ...args]. */
export type EventRow = (number | string)[]

export interface Snap {
  v: 1
  /** Sim steps so far (the view interpolates by it). */
  tick: number
  clock: number
  paused: boolean
  /** The winner once it is over. */
  winner: Side | null
  /** Global auto-target per side: [gold, pink]. */
  auto: [boolean, boolean]
  c: CannonRow[]
  s: ShotRow[]
  /** The recipient's own queued orders (the other player's stay hidden). */
  q: QueuedRow[]
  ev: EventRow[]
}

const EV = { fired: 1, bounce: 2, hit: 3, blocked: 4, shieldBroken: 5, shieldBack: 6, captured: 7, healed: 8, swapped: 9 } as const

/** Records sim events (wrap the events you pass to the host's BattleSim) for the next snapshot. */
export class EventLog {
  rows: EventRow[] = []
  private index = new Map<Cannon, number>()
  constructor(private readonly clock: () => number) {}

  /** Learn cannon indexes (call once the sim exists). */
  bind(sim: BattleSim): void {
    this.index = new Map(sim.cannons.map((c, i) => [c, i]))
  }

  /** `events`, plus recording into this log. */
  tap(events: SimEvents): SimEvents {
    const i = (c: Cannon) => this.index.get(c) ?? -1
    const t = () => Math.round(this.clock())
    const push = (row: EventRow) => this.rows.push(row)
    return {
      ...events,
      fired: (c, shot) => (push([t(), EV.fired, i(c)]), events.fired?.(c, shot)),
      bounce: (x, y) => (push([t(), EV.bounce, r1(x), r1(y)]), events.bounce?.(x, y)),
      hit: (x, y, side, kind) => (push([t(), EV.hit, r1(x), r1(y), sideNo(side), kindNo(kind)]), events.hit?.(x, y, side, kind)),
      blocked: (x, y, shield, side, kind) => (push([t(), EV.blocked, r1(x), r1(y), i(shield), sideNo(side), kindNo(kind)]), events.blocked?.(x, y, shield, side, kind)),
      shieldBroken: (c) => (push([t(), EV.shieldBroken, i(c)]), events.shieldBroken?.(c)),
      shieldBack: (c) => (push([t(), EV.shieldBack, i(c)]), events.shieldBack?.(c)),
      captured: (c) => (push([t(), EV.captured, i(c), sideNo(c.side)]), events.captured?.(c)),
      healed: (c, amount) => (push([t(), EV.healed, i(c), r3(amount)]), events.healed?.(c, amount)),
      swapped: (c) => (push([t(), EV.swapped, i(c), kindNo(c.kind)]), events.swapped?.(c)),
    }
  }

  take(): EventRow[] {
    const out = this.rows
    this.rows = []
    return out
  }
}

/** Encode the round for a player of `forSide` (only that side's queued orders are included). */
export function encodeSnap(sim: BattleSim, tick: number, forSide: Side, events: EventRow[] = []): Snap {
  const index = new Map(sim.cannons.map((c, i) => [c.id, i]))
  const ix = (id: string | null) => (id === null ? -1 : (index.get(id) ?? -1))
  const c = sim.cannons.map((cannon): CannonRow => {
    const n = cannon.netState()
    return [
      sideNo(n.side),
      kindNo(n.kind),
      r3(n.angle),
      ix(n.target),
      n.aimPoint ? r1(n.aimPoint.x) : -1,
      n.aimPoint ? r1(n.aimPoint.y) : -1,
      sideNo(n.attacker),
      r3(n.progress),
      ix(n.healing),
      n.autoTarget ? 1 : 0,
      r3(n.hitFlash),
      r3(n.healFlash),
      Math.round(n.swapTotal),
      Math.round(n.swapLeft),
      Math.round(n.muzzle),
      n.shotsFired,
      r3(n.pop),
      r3(n.shieldHp),
      Math.round(n.shieldDown),
      r3(n.shieldFlash),
      r3(n.shieldBreakFx),
    ]
  })
  const s = sim.shots.map((shot): ShotRow => [shot.id, sideNo(shot.side), kindNo(shot.kind), r1(shot.ball.x), r1(shot.ball.y), r1(shot.ball.vx), r1(shot.ball.vy)])
  const q = sim.queuedOrders(forSide).map((o): QueuedRow => {
    const aimCannon = o.aim instanceof Cannon ? ix(o.aim.id) : -1
    const point = o.aim && !(o.aim instanceof Cannon) ? o.aim : null
    return [ix(o.cannon.id), aimCannon, point ? r1(point.x) : -1, point ? r1(point.y) : -1, kindNo(o.kind), o.aim ? 1 : 0]
  })
  return {
    v: 1,
    tick,
    clock: Math.round(sim.clock),
    paused: sim.paused,
    winner: sim.winner,
    auto: [sim.autoTargetOf('player'), sim.autoTargetOf('enemy')],
    c,
    s,
    q,
    ev: events,
  }
}

/** How a view maps the host's sides: flipped, the viewer (pink on the host) is 'player' in the view. */
export function sideMapper(flip: boolean): (s: Side) => Side {
  return (s) => (!flip || s === 'neutral' ? s : s === 'player' ? 'enemy' : 'player')
}

function decodeCannon(row: CannonRow, cannons: Cannon[], map: (s: Side) => Side): CannonNet {
  const side = (n: number): Side | null => (n < 0 ? null : map(SIDES[n]))
  const id = (n: number) => (n < 0 ? null : (cannons[n]?.id ?? null))
  return {
    side: side(row[0]) ?? 'neutral',
    kind: CANNON_KINDS[row[1]] ?? 'normal',
    angle: row[2],
    target: id(row[3]),
    aimPoint: row[4] < 0 && row[5] < 0 ? null : { x: row[4], y: row[5] },
    attacker: side(row[6]),
    progress: row[7],
    healing: id(row[8]),
    autoTarget: row[9] === 1,
    hitFlash: row[10],
    healFlash: row[11],
    swapTotal: row[12],
    swapLeft: row[13],
    muzzle: row[14],
    shotsFired: row[15],
    pop: row[16],
    shieldHp: row[17],
    shieldDown: row[18],
    shieldFlash: row[19],
    shieldBreakFx: row[20],
  }
}

/** The shortest way round from a to b, a share t of the way. */
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Show the round between snapshots `a` and `b` (t = 0 is a, 1 is b) on a view
 * BattleSim. Smooth values (barrels, meters, flashes, shots) are blended;
 * everything else is a's. The pause, the winner, the toggles and the queued
 * orders come from `latest`, so they show as soon as they arrive.
 */
export function applySnap(view: BattleSim, a: Snap, b: Snap, t: number, latest: Snap, flip: boolean, stepMs: number): void {
  const map = sideMapper(flip)
  const cannons = view.cannons
  const byId = (id: string) => view.byId(id)
  for (let i = 0; i < cannons.length; i++) {
    const ra = a.c[i]
    const rb = b.c[i]
    if (!ra) continue
    const s = decodeCannon(ra, cannons, map)
    if (rb && t > 0) {
      const sb = decodeCannon(rb, cannons, map)
      s.angle = lerpAngle(s.angle, sb.angle, t)
      if (s.attacker === sb.attacker && s.side === sb.side) s.progress = lerp(s.progress, sb.progress, t)
      s.hitFlash = lerp(s.hitFlash, sb.hitFlash, t)
      s.healFlash = lerp(s.healFlash, sb.healFlash, t)
      s.muzzle = lerp(s.muzzle, sb.muzzle, t)
      s.pop = lerp(s.pop, sb.pop, t)
      if (s.kind === sb.kind) s.swapLeft = lerp(s.swapLeft, sb.swapLeft, t)
      s.shieldFlash = lerp(s.shieldFlash, sb.shieldFlash, t)
      s.shieldBreakFx = lerp(s.shieldBreakFx, sb.shieldBreakFx, t)
    }
    cannons[i].applyNet(s, byId)
  }

  // Shots in both snapshots slide between them; new ones show from halfway; gone ones vanish.
  const before = new Map(a.s.map((row) => [row[0], row]))
  const shots: Shot[] = []
  for (const row of b.s) {
    const old = before.get(row[0])
    if (!old && t < 0.5) continue
    const x = old ? lerp(old[3], row[3], t) : row[3]
    const y = old ? lerp(old[4], row[4], t) : row[4]
    const vx = old ? lerp(old[5], row[5], t) : row[5]
    const vy = old ? lerp(old[6], row[6], t) : row[6]
    const side = map(SIDES[row[1]] ?? 'neutral')
    const shot = new Shot({ x, y, vx, vy, age: 0, bounces: 0, alive: true, ownerId: '' }, side, 1, CANNON_KINDS[row[2]] ?? 'normal')
    shot.id = row[0]
    shot.prevX = x - (vx * stepMs) / 1000
    shot.prevY = y - (vy * stepMs) / 1000
    shots.push(shot)
  }
  view.shots = shots

  view.clock = lerp(a.clock, b.clock, t)
  view.paused = latest.paused
  const winner = latest.winner === null ? null : map(latest.winner)
  view.ended = winner === null ? null : winner === 'player' ? 'win' : 'lose'
  const mine = flip ? latest.auto[1] : latest.auto[0]
  view.setAutoTarget(mine, 'player')
  view.setViewQueued(
    latest.q
      .filter((row) => cannons[row[0]])
      .map((row) => ({
        cannon: cannons[row[0]],
        aim: row[5] !== 1 ? null : row[1] >= 0 ? (cannons[row[1]] ?? null) : ({ x: row[2], y: row[3] } as Point),
        kind: row[4] >= 0 ? (CANNON_KINDS[row[4]] ?? null) : null,
      })),
  )
}

/** Replay a recorded event on the view's handlers (sparks, popups, sounds). */
export function replayEvent(row: EventRow, view: BattleSim, events: SimEvents, flip: boolean): void {
  const map = sideMapper(flip)
  const n = (k: number) => Number(row[k])
  const cannon = (k: number) => view.cannons[n(k)] as Cannon | undefined
  const side = (k: number) => map(SIDES[n(k)] ?? 'neutral')
  const kind = (k: number) => CANNON_KINDS[n(k)] ?? 'normal'
  switch (n(1)) {
    case EV.fired: {
      const c = cannon(2)
      if (c) events.fired?.(c, new Shot({ x: c.x, y: c.y, vx: 0, vy: 0, age: 0, bounces: 0, alive: true, ownerId: c.id }, c.side, 1, c.kind))
      break
    }
    case EV.bounce:
      events.bounce?.(n(2), n(3))
      break
    case EV.hit:
      events.hit?.(n(2), n(3), side(4), kind(5))
      break
    case EV.blocked: {
      const c = cannon(4)
      if (c) events.blocked?.(n(2), n(3), c, side(5), kind(6))
      break
    }
    case EV.shieldBroken: {
      const c = cannon(2)
      if (c) events.shieldBroken?.(c)
      break
    }
    case EV.shieldBack: {
      const c = cannon(2)
      if (c) events.shieldBack?.(c)
      break
    }
    case EV.captured: {
      // The view may still show the old owner for a moment: show the new one now (the next snapshot agrees).
      const c = cannon(2)
      if (c) {
        if (row.length > 3) c.side = side(3)
        events.captured?.(c)
      }
      break
    }
    case EV.healed: {
      const c = cannon(2)
      if (c) events.healed?.(c, n(3))
      break
    }
    case EV.swapped: {
      const c = cannon(2)
      if (c) {
        if (row.length > 3) c.kind = kind(3)
        events.swapped?.(c)
      }
      break
    }
  }
}

