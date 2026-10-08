import { BOARD } from '../config/layout'
import type { Rect } from '../types'
import { TUNING } from '../config/tuning'
import { MIN_LANE_DEG, lanesOf, type Lane, type LaneTable } from '../sim/solver'
import { KIND_IDS, laneKey, shotSpeedFor, turnSpeedDegFor } from '../config/kinds'
import { angleDelta } from '../sim/aim'
import type { Cannon } from '../entities/Cannon'
import type { CannonKind, Point, Side } from '../types'
import { SwapGovernor, canReach, jobTime, kindRate, type AiDifficulty, type SwapPolicy } from './towerChoice'

/**
 * A cannon's committed job: a foe to capture or a friend to heal. The tower
 * type is part of the plan too (chosen when the job is taken on).
 */
export interface Job {
  kind: 'attack' | 'heal'
  target: Cannon
  /** Controller time (ms) when it was committed. */
  since: number
  /** Picked before the lanes were built: replace it as soon as they are. */
  provisional?: boolean
  /** Heal jobs: the attack to go back to once the friend is whole. */
  resume?: Job
}

/** How quickly one side thinks and how firmly it sticks to a plan. */
export interface PlanTiming {
  /** Each cannon re-thinks this often, on its own staggered tick (ms). */
  thinkMs: number
  /** A job is kept at least this long unless it is done or falls through (ms). */
  commitMs: number
  /** A new job must look this many times quicker to replace the current one. */
  margin: number
  /** Delay before reacting to an event: a friend under attack, a job finished or lost (ms). */
  reactMs: number
}

export function planTiming(difficulty: AiDifficulty, thinkMs: number = TUNING.aiRetargetMs): PlanTiming {
  const p = TUNING.aiPlan
  return { thinkMs, commitMs: p.commitMs[difficulty], margin: p.margin[difficulty], reactMs: p.reactMs[difficulty] }
}

/** One line of the decision log (window.__cc.sim.ai.log in ?debug builds). */
export interface Decision {
  t: number
  id: string
  job: string
  why: string
}

/** Barrel still this far off its aim: the cannon is mid-turn. */
const TURNING_DEG = 2
const LOG_SIZE = 400

/**
 * Plays one side. Plain rules, no library:
 *
 * - Every cannon has a committed job (a foe to capture or a friend to heal,
 *   and the tower type for it). The jobs double as the team's claims list.
 * - Each cannon thinks on its own tick, staggered across the team, so the
 *   side never re-plans everything at once.
 * - A job is kept until it is done, falls through (target lost, no lane),
 *   or, after commitMs, another job is clearly quicker (margin). Never while
 *   the barrel is still turning onto the current job.
 * - Real events get a quick reaction (reactMs): a friend about to be
 *   captured gets a helper; a cannon whose job ended picks a new one.
 * - Jobs are scored by estimated time to finish: swap reload, turn time,
 *   shot travel, and damage still needed at the type's real hit rate (see
 *   towerChoice.ts), plus crowdMs per teammate already on that target, so
 *   cannons split up unless the other side is capturing it (then ganging up
 *   pays).
 *
 * Its cannons obey the same turn speed and swap rules as yours.
 */
export class AiController {
  private now = 0
  private started = false
  private lanes: LaneTable = new Map()
  private board: Rect = BOARD
  timing: PlanTiming = planTiming('normal')
  readonly swaps = new SwapGovernor()
  /** Each own cannon's committed job: the team's claims list. */
  readonly jobs = new Map<Cannon, Job>()
  private readonly nextThink = new Map<Cannon, number>()
  /** Reaction thinks that are due (cannon -> when, why). */
  private readonly react = new Map<Cannon, { at: number; why: string }>()
  private helpAt: number | null = null
  /** Recent decisions, oldest first. */
  readonly log: Decision[] = []

  constructor(readonly side: Side = 'enemy') {}

  reset(
    lanes: LaneTable = new Map(),
    retargetMs: number = TUNING.aiRetargetMs,
    board: Rect = BOARD,
    policy?: SwapPolicy,
    difficulty: AiDifficulty = 'normal',
  ): void {
    this.board = board
    this.lanes = lanes
    this.now = 0
    this.started = false
    this.timing = planTiming(difficulty, retargetMs)
    this.jobs.clear()
    this.nextThink.clear()
    this.react.clear()
    this.helpAt = null
    this.log.length = 0
    this.swaps.reset(policy)
  }

  /** Controller time in ms (matches the round clock). */
  get clock(): number {
    return this.now
  }

  update(dt: number, cannons: Cannon[]): void {
    this.now += dt
    this.swaps.tick(dt)
    const mine = cannons.filter((c) => c.side === this.side)
    this.forgetLost()
    this.schedule(mine)
    this.watch(mine)
    if (this.helpAt !== null && this.now >= this.helpAt) {
      this.helpAt = null
      this.assignHelpers(cannons)
    }
    for (const c of mine) {
      const due = this.react.get(c)
      if (due && this.now >= due.at) {
        this.react.delete(c)
        this.think(c, cannons, due.why)
      } else if (this.now >= (this.nextThink.get(c) ?? Infinity)) {
        this.think(c, cannons, 'tick')
      }
    }
  }

  /** When `c` next thinks on its own tick (ms of controller time), if scheduled. */
  nextThinkAt(c: Cannon): number | undefined {
    return this.nextThink.get(c)
  }

  /** Make every cannon think right now (tests, debugging). */
  retarget(cannons: Cannon[]): void {
    this.assignHelpers(cannons)
    for (const c of cannons) if (c.side === this.side && !c.healing) this.think(c, cannons, 'forced')
  }

  /** Cannons it no longer owns drop their jobs and ticks. */
  private forgetLost(): void {
    for (const c of this.nextThink.keys()) {
      if (c.side === this.side) continue
      this.nextThink.delete(c)
      this.jobs.delete(c)
      this.react.delete(c)
    }
  }

  /**
   * First tick for each cannon. At the start, cannons the map already aims
   * keep that aim for a full think interval (then they stagger); unaimed
   * ones decide right away, a moment apart. A cannon captured mid-round
   * picks a job after reactMs.
   */
  private schedule(mine: Cannon[]): void {
    const { thinkMs, reactMs } = this.timing
    mine.forEach((c, i) => {
      if (this.nextThink.has(c)) return
      if (!this.started) {
        if (c.target && c.target.side !== this.side) this.jobs.set(c, { kind: 'attack', target: c.target, since: 0 })
        this.nextThink.set(c, c.aim() ? thinkMs * (1 + i / mine.length) : 150 + i * 150)
      } else {
        this.nextThink.set(c, this.now + reactMs)
      }
    })
    this.started = true
  }

  /** Spot real events every frame and schedule quick reactions to them. */
  private watch(mine: Cannon[]): void {
    for (const c of mine) {
      this.sync(c)
      const job = this.jobs.get(c)
      const broken = job ? this.broken(c, job) : c.aim() ? null : 'idle'
      if (broken) this.soon(c, broken)
    }
    const needy = mine.some((f) => f.damaged && f.captureProgress >= TUNING.aiHealAtProgress && helpersOn(f, mine) < helpersWanted(f))
    if (!needy) this.helpAt = null
    else if (this.helpAt === null) this.helpAt = this.now + this.timing.reactMs
  }

  private soon(c: Cannon, why: string): void {
    if (!this.react.has(c)) this.react.set(c, { at: this.now + this.timing.reactMs, why })
  }

  /** Follow what the cannon did by itself: a finished heal resumes its old job, a lost friend becomes a capture. */
  private sync(c: Cannon): void {
    const job = this.jobs.get(c)
    if (!job || job.kind !== 'heal' || c.healing === job.target) return
    if (job.target.side !== this.side) {
      this.jobs.set(c, { kind: 'attack', target: job.target, since: this.now })
      this.note(c, `friend ${job.target.id} lost: take it back`)
    } else if (job.resume && job.resume.target.side !== this.side && c.target === job.resume.target) {
      this.jobs.set(c, job.resume)
      this.note(c, `${job.target.id} healed: back to plan`)
    } else {
      this.jobs.delete(c)
    }
  }

  /** Why a job can no longer go on, or null while it still can. */
  private broken(c: Cannon, job: Job): string | null {
    const t = job.target
    if (job.kind === 'heal') return null // sync() ends heals
    if (t.side === this.side) return `${t.id} captured`
    if (this.lanesKnown(c) && !canReach(c, t, this.lanes)) return `no lane to ${t.id}`
    if (job.provisional && this.lanesKnown(c)) return 'lanes ready'
    return null
  }

  /** True once every tower type's lanes for this cannon are built. */
  private lanesKnown(c: Cannon): boolean {
    return KIND_IDS.every((kind) => this.lanes.has(laneKey(c.id, kind)))
  }

  private think(c: Cannon, cannons: Cannon[], why: string): void {
    this.nextThink.set(c, this.now + this.timing.thinkMs)
    this.sync(c)
    const job = this.jobs.get(c)
    const broken = job ? this.broken(c, job) : 'no job'
    const kept = broken ? null : job!
    if (kept) {
      // Heals run until the friend is whole (or lost).
      if (kept.kind === 'heal') return this.refit(c, kept)
      // Committed: only a type that can't hit at all gets changed.
      if (this.now - kept.since < this.timing.commitMs) return this.refit(c, kept, true)
      // Never change its mind halfway through a turn.
      if (c.aimErrorDeg() > TURNING_DEG) return
    }
    const best = this.bestJob(c, cannons)
    if (!best) {
      if (!kept) this.jobs.delete(c)
      return
    }
    if (kept) {
      if (best.target === kept.target) return this.refit(c, kept)
      const current = this.score(c, kept.target, cannons)
      if (best.score * this.timing.margin >= current) return this.refit(c, kept)
    }
    const job2: Job = { kind: 'attack', target: best.target, since: this.now, provisional: best.provisional }
    this.commit(c, job2, kept ? `${why}: ${best.target.id} clearly quicker` : `${why}: ${broken}`)
  }

  /** Take on a job: fit the type for it (same swap rules as yours) and aim. */
  private commit(c: Cannon, job: Job, why: string): void {
    // Only judge types once every type's lanes are known (big maps build them over a second or two).
    if (this.lanesKnown(c)) this.swaps.consider(c, job.target, this.lanes, (x, kind) => x.setKind(kind))
    this.aim(c, job)
    this.jobs.set(c, job)
    this.react.delete(c)
    this.nextThink.set(c, this.now + this.timing.thinkMs)
    this.note(c, why)
  }

  /** Re-check the tower type for the current job (only if it can't hit at all when `stuckOnly`). */
  private refit(c: Cannon, job: Job, stuckOnly = false): void {
    if (!this.lanesKnown(c)) return
    const canHit = kindRate(c, c.kind, job.target, this.lanes) > 0
    if (canHit && (stuckOnly || c.aimErrorDeg() > TURNING_DEG)) return
    if (!this.swaps.consider(c, job.target, this.lanes, (x, kind) => x.setKind(kind))) return
    this.aim(c, job)
    this.note(c, `refit as ${c.kind}`)
  }

  private aim(c: Cannon, job: Job): void {
    const lane = lanesOf(this.lanes, c)?.get(job.target.id)
    if (job.kind === 'heal') healViaLane(c, job.target, lane, this.board)
    else aimViaLane(c, job.target, lane, this.board)
  }

  /** The quickest foe for `c` to capture, counting the team's claims. */
  private bestJob(c: Cannon, cannons: Cannon[]): { target: Cannon; score: number; provisional: boolean } | null {
    let best: Cannon | null = null
    let bestScore = Infinity
    for (const foe of cannons) {
      if (foe.side === this.side) continue
      const score = this.score(c, foe, cannons)
      if (score < bestScore) {
        best = foe
        bestScore = score
      }
    }
    return best ? { target: best, score: bestScore, provisional: !this.lanesKnown(c) } : null
  }

  /**
   * Estimated ms for `c` to capture `foe`: swap reload + damage needed at
   * the type's real hit rate (jobTime), plus turning and shot travel, plus
   * crowdMs per teammate already on it. Before the lanes are built it
   * guesses from distance alone.
   */
  score(c: Cannon, foe: Cannon, cannons: Cannon[]): number {
    const dist = Math.hypot(foe.x - c.x, foe.y - c.y)
    const crowd = this.crowd(c, foe, cannons)
    if (!this.lanes.has(laneKey(c.id, c.kind))) return (dist / shotSpeedFor(c.kind)) * 1000 + crowd
    const kind = this.swaps.preview(c, foe, this.lanes)
    const time = jobTime(c, kind, foe, this.lanes)
    if (!Number.isFinite(time)) return Infinity
    const lane = this.lanes.get(laneKey(c.id, kind))?.get(foe.id)
    const turnDeg = lane ? Math.abs((angleDelta(c.angle, lane.angle) * 180) / Math.PI) : 0
    const turn = (turnDeg / turnSpeedDegFor(kind)) * 1000
    const travel = (dist / shotSpeedFor(kind)) * 1000
    return time + turn + travel + crowd
  }

  /** Extra cost of piling on: crowdMs per teammate already attacking it, unless the other side is capturing it. */
  private crowd(c: Cannon, foe: Cannon, cannons: Cannon[]): number {
    if (foe.captureAttacker !== null && foe.captureAttacker !== this.side) return 0
    let n = 0
    for (const other of cannons) {
      if (other === c || other.side !== this.side) continue
      const job = this.jobs.get(other)
      if (job && job.kind === 'attack' && job.target === foe) n += 1
    }
    return n * TUNING.aiPlan.crowdMs
  }

  /** Send helpers to friends close to flipping (see planHeals). */
  private assignHelpers(cannons: Cannon[]): void {
    for (const { helper, friend } of planHeals(this.side, cannons, this.lanes)) {
      const prev = this.jobs.get(helper)
      const resume = prev?.kind === 'attack' ? prev : prev?.resume
      this.commit(helper, { kind: 'heal', target: friend, since: this.now, resume }, `friend ${friend.id} under attack`)
    }
  }

  private note(c: Cannon, why: string): void {
    const job = this.jobs.get(c)
    const what = job ? `${c.kind} ${job.kind === 'heal' ? 'heals' : '->'} ${job.target.id}` : `${c.kind} idle`
    this.log.push({ t: Math.round(this.now), id: c.id, job: what, why })
    if (this.log.length > LOG_SIZE) this.log.splice(0, this.log.length - LOG_SIZE)
  }
}

/** How many own cannons are healing `friend`. */
export function helpersOn(friend: Cannon, mine: Cannon[]): number {
  let n = 0
  for (const c of mine) if (c.healing === friend) n += 1
  return n
}

/** One helper for a friend under attack; two when it is a hit or two from flipping. */
export function helpersWanted(friend: Cannon): number {
  return friend.captureProgress >= TUNING.captureThreshold - 2 ? 2 : 1
}

export interface CoverOrder {
  cannon: Cannon
  kind: CannonKind
  foe: Cannon
}

/**
 * A foe that none of the side's cannons can reach as they are fitted, but one
 * could after a swap (a sniper through a headwind, say): pick the cannon with
 * the widest such lane to go after it. A machine gun counts as covering what
 * it could hit as a normal cannon (it is only a gun because something is close).
 */
export function planCover(side: Side, cannons: Cannon[], lanes: LaneTable, skip: Set<Cannon> = new Set()): CoverOrder[] {
  const mine = cannons.filter((c) => c.side === side && !skip.has(c) && !c.swapping)
  const prey = cannons.filter((c) => c.side !== side)
  const width = (c: Cannon, kind: CannonKind, foe: Cannon): number => lanes.get(laneKey(c.id, kind))?.get(foe.id)?.widthDeg ?? 0
  const hits = (c: Cannon, kind: CannonKind, foe: Cannon): boolean => width(c, kind, foe) >= MIN_LANE_DEG
  const orders: CoverOrder[] = []
  const taken = new Set<Cannon>()
  const fitted = cannons.filter((c) => c.side === side)
  for (const foe of prey) {
    if (fitted.some((c) => hits(c, c.kind, foe) || (c.kind === 'machinegun' && hits(c, 'normal', foe)))) continue
    let best: CoverOrder | null = null
    let bestW = 0
    for (const c of mine) {
      if (taken.has(c)) continue
      for (const kind of KIND_IDS) {
        if (kind === c.kind) continue
        const w = width(c, kind, foe)
        if (hits(c, kind, foe) && w > bestW) {
          best = { cannon: c, kind, foe }
          bestW = w
        }
      }
    }
    if (best) {
      orders.push(best)
      taken.add(best.cannon)
    }
  }
  return orders
}

/** Older name for planCover (the swap each cover order implies). */
export function planSwaps(side: Side, cannons: Cannon[], lanes: LaneTable, skip: Set<Cannon> = new Set()): CoverOrder[] {
  return planCover(side, cannons, lanes, skip)
}

export interface HealOrder {
  helper: Cannon
  friend: Cannon
}

/**
 * Healing: each own cannon that is close to flipping (at least
 * TUNING.aiHealAtProgress of the meter gone) gets one helper (two once it is
 * a hit or two from flipping), the nearest
 * other own cannon with a clear lane to it as some tower type (it swaps if
 * that pays off). Helpers that are about to finish their own capture are
 * left alone.
 */
export function planHeals(side: Side, cannons: Cannon[], lanes: LaneTable): HealOrder[] {
  const mine = cannons.filter((c) => c.side === side)
  if (mine.length < 2) return []
  const busy = new Set<Cannon>()
  const orders: HealOrder[] = []
  for (const c of mine) if (c.healing && c.healing.side === side && c.healing.damaged) busy.add(c)
  const hurt = mine
    .filter((c) => c.damaged && c.captureProgress >= TUNING.aiHealAtProgress)
    .sort((a, b) => b.captureProgress - a.captureProgress)
  for (const friend of hurt) {
    for (let need = helpersWanted(friend) - helpersOn(friend, mine); need > 0; need--) {
      const helper = pickHelper(friend)
      if (!helper) break
      busy.add(helper)
      orders.push({ helper, friend })
    }
  }
  return orders

  function pickHelper(friend: Cannon): Cannon | null {
    let helper: Cannon | null = null
    let best = Infinity
    for (const c of mine) {
      if (c === friend || busy.has(c)) continue
      if (!canReach(c, friend, lanes)) continue
      const prey = c.target
      if (prey && prey.side !== side && prey.captureAttacker === side && prey.captureProgress >= TUNING.captureThreshold - 2) continue
      const d = Math.hypot(c.x - friend.x, c.y - friend.y)
      if (d < best) {
        best = d
        helper = c
      }
    }
    return helper
  }
}

/** Start a heal along the helper's lane (straight if that lands). */
export function healViaLane(helper: Cannon, friend: Cannon, lane: Lane | undefined, board: Rect = BOARD): void {
  if (!lane || lane.direct) helper.startHeal(friend)
  else helper.startHeal(friend, pointAlong(helper, lane.angle, board))
}

/** Aim straight at the target if that lands, otherwise at a point along the lane. */
export function aimViaLane(cannon: Cannon, target: Cannon, lane: Lane | undefined, board: Rect = BOARD): void {
  if (!lane || lane.direct) cannon.setTarget(target)
  else cannon.setAimPoint(pointAlong(cannon, lane.angle, board))
}

/** A point on the board in direction `angle` from `origin`. */
export function pointAlong(origin: Point, angle: number, board: Rect = BOARD, preferred = 160): Point {
  const BOARD_ = board
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  let t = preferred
  const margin = 8
  if (dx > 1e-6) t = Math.min(t, (BOARD_.x + BOARD_.w - margin - origin.x) / dx)
  if (dx < -1e-6) t = Math.min(t, (BOARD_.x + margin - origin.x) / dx)
  if (dy > 1e-6) t = Math.min(t, (BOARD_.y + BOARD_.h - margin - origin.y) / dy)
  if (dy < -1e-6) t = Math.min(t, (BOARD_.y + margin - origin.y) / dy)
  t = Math.max(t, 40)
  return { x: origin.x + dx * t, y: origin.y + dy * t }
}
