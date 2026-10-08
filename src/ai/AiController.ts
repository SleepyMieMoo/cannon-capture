import { BOARD } from '../config/layout'
import type { Rect } from '../types'
import { TUNING } from '../config/tuning'
import { MIN_LANE_DEG, laneTricks, lanesOf, type Lane, type LaneTable } from '../sim/solver'
import { KIND_IDS, laneKey, shotSpeedFor, turnSpeedDegFor } from '../config/kinds'
import { angleDelta } from '../sim/aim'
import { gaussian, hash01, seededRandom } from '../sim/random'
import type { Cannon } from '../entities/Cannon'
import type { BattleSim } from '../sim/BattleSim'
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
  const p = TUNING.aiLevels[difficulty]
  return { thinkMs, commitMs: p.commitMs, margin: p.margin, reactMs: p.reactMs }
}

/** One line of the decision log (window.__cc.sim.ai.log in ?debug builds). */
export interface Decision {
  t: number
  id: string
  job: string
  why: string
}

/** Look-ahead stats (Impossible), for tests and the debug overlay. */
export interface LookaheadStats {
  thinks: number
  sims: number
  totalMs: number
  maxThinkMs: number
  maxFrameMs: number
  /** Simulation steps run, and frames that ran any. */
  steps: number
  frames: number
  maxFrameSteps: number
}

interface Candidate {
  target: Cannon
  /** Trade jobs: this teammate takes over our current target. */
  mate?: Cannon
  /** Keep the current job as it is. */
  keep?: boolean
  score: number
}

interface Deliberation {
  cannon: Cannon
  why: string
  kept: Job | null
  /** The cannon's job entry when it started thinking (may be a finished job that `kept` dropped). */
  held: Job | undefined
  candidates: Candidate[]
  /** Each trade partner's job when the cannon started thinking (a trade is off if it changed since). */
  mates: Map<Cannon, Job | undefined>
  values: number[]
  /** The round as it was when the cannon started thinking (every candidate starts from it). */
  base: BattleSim
  /** The copy of the round being played forward for the next candidate. */
  world: BattleSim | null
  end: number
  ms: number
}

/** Barrel still this far off its aim: the cannon is mid-turn. */
const TURNING_DEG = 2
const LOG_SIZE = 400

/** Angular size (degrees) of a cannon at `dist` for a shot to hit it. */
function directWidthDeg(dist: number): number {
  return (2 * Math.atan((TUNING.cannonRadius + TUNING.shotRadius) / Math.max(dist, 1)) * 180) / Math.PI
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

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
 * - Real events get a reaction after reactMs: a friend about to be captured
 *   gets a helper; a cannon whose job ended picks a new one.
 * - Jobs are scored by estimated time to finish: swap reload, turn time,
 *   shot travel, and damage still needed at the type's real hit rate (see
 *   towerChoice.ts), plus crowdMs per teammate already on that target, so
 *   cannons split up unless the other side is capturing it (then ganging up
 *   pays).
 *
 * Difficulty is intelligence only (TUNING.aiLevels): its cannons fire, turn,
 * think and swap exactly like yours. Easy and Normal aim a little off (they
 * aim at an offset point; shots follow the same rules) and correct after a
 * miss, and skip trick shots beyond their level. Impossible plays its best
 * few options forward in a copy of the round before choosing.
 */
export class AiController {
  private now = 0
  private started = false
  private lanes: LaneTable = new Map()
  private board: Rect = BOARD
  difficulty: AiDifficulty = 'normal'
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
  /** The round, for look-ahead copies (Impossible). */
  private world: BattleSim | null = null
  /** The lanes this level is willing to use (trick shots filtered out). */
  private view: LaneTable = new Map()
  private viewOf = -1
  private readonly byId = new Map<string, Cannon>()
  /** Aim error per cannon for its current job, in lane half-widths (0 = perfect). */
  private readonly aimErr = new Map<Cannon, { job: Job; err: number }>()
  private rng: () => number = Math.random
  private seed = ''
  private readonly deliberating: Deliberation[] = []
  readonly lookahead: LookaheadStats = { thinks: 0, sims: 0, totalMs: 0, maxThinkMs: 0, maxFrameMs: 0, steps: 0, frames: 0, maxFrameSteps: 0 }

  constructor(readonly side: Side = 'enemy') {}

  reset(
    lanes: LaneTable = new Map(),
    retargetMs: number = TUNING.aiRetargetMs,
    board: Rect = BOARD,
    policy?: SwapPolicy,
    difficulty: AiDifficulty = 'normal',
    world: BattleSim | null = null,
  ): void {
    this.board = board
    this.lanes = lanes
    this.now = 0
    this.started = false
    this.difficulty = difficulty
    this.timing = planTiming(difficulty, retargetMs)
    this.world = world
    this.jobs.clear()
    this.nextThink.clear()
    this.react.clear()
    this.helpAt = null
    this.log.length = 0
    this.view = new Map()
    this.viewOf = -1
    this.byId.clear()
    this.aimErr.clear()
    this.deliberating.length = 0
    Object.assign(this.lookahead, { thinks: 0, sims: 0, totalMs: 0, maxThinkMs: 0, maxFrameMs: 0, steps: 0, frames: 0, maxFrameSteps: 0 })
    this.seed = `${world?.level.id ?? 'level'}:${this.side}:${difficulty}`
    this.rng = seededRandom(this.seed)
    this.swaps.reset(policy)
  }

  /** This level's brain settings. */
  get skill() {
    return TUNING.aiLevels[this.difficulty]
  }

  /** Controller time in ms (matches the round clock). */
  get clock(): number {
    return this.now
  }

  update(dt: number, cannons: Cannon[]): void {
    this.now += dt
    this.swaps.tick(dt)
    if (this.byId.size !== cannons.length) for (const c of cannons) this.byId.set(c.id, c)
    this.refreshView(cannons)
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
    if (this.deliberating.length) this.deliberate(cannons)
  }

  /** When `c` next thinks on its own tick (ms of controller time), if scheduled. */
  nextThinkAt(c: Cannon): number | undefined {
    return this.nextThink.get(c)
  }

  /** Make every cannon think right now (tests, debugging). Impossible still deliberates over the next frames. */
  retarget(cannons: Cannon[]): void {
    for (const c of cannons) this.byId.set(c.id, c)
    this.refreshView(cannons)
    this.assignHelpers(cannons)
    for (const c of cannons) if (c.side === this.side && !c.healing) this.think(c, cannons, 'forced')
  }

  /** The lanes this AI will use: all of them, or only those within its trick-shot level. */
  lanesInUse(): LaneTable {
    return this.view
  }

  /**
   * Rebuild the usable-lane view when new lanes arrive. Lanes it can aim
   * straight down count as plain straight shots (aimed at the cannon, as
   * wide as the cannon looks); others need their trick count within the
   * level's maxTricks.
   */
  private refreshView(cannons: Cannon[]): void {
    const max = this.skill.maxTricks
    if (max >= 99) {
      this.view = this.lanes
      return
    }
    if (this.viewOf === this.lanes.size) return
    this.viewOf = this.lanes.size
    const pos = new Map(cannons.map((c) => [c.id, c]))
    const view: LaneTable = new Map()
    for (const [key, lanes] of this.lanes) {
      const hash = key.indexOf('#')
      const from = pos.get(hash < 0 ? key : key.slice(0, hash))
      const kept = new Map<string, Lane>()
      for (const [id, lane] of lanes) {
        const to = pos.get(id)
        if (lane.direct && from && to) {
          const angle = Math.atan2(to.y - from.y, to.x - from.x)
          const width = Math.min(lane.widthDeg, directWidthDeg(Math.hypot(to.x - from.x, to.y - from.y)))
          kept.set(id, { targetId: id, angle, widthDeg: Math.max(width, MIN_LANE_DEG), direct: true, tricks: 0 })
        } else if (laneTricks(lane) <= max) {
          kept.set(id, lane)
        }
      }
      view.set(key, kept)
    }
    this.view = view
  }

  /** Cannons it no longer owns drop their jobs and ticks. */
  private forgetLost(): void {
    for (const c of this.nextThink.keys()) {
      if (c.side === this.side) continue
      this.nextThink.delete(c)
      this.jobs.delete(c)
      this.react.delete(c)
      this.aimErr.delete(c)
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

  /** Spot real events every frame and schedule reactions to them. */
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
      const next: Job = { kind: 'attack', target: job.target, since: this.now }
      this.jobs.set(c, next)
      this.aim(c, next)
      this.note(c, `friend ${job.target.id} lost: take it back`)
    } else if (job.resume && job.resume.target.side !== this.side && this.resumed(c, job.resume)) {
      this.jobs.set(c, job.resume)
      this.note(c, `${job.target.id} healed: back to plan`)
    } else {
      this.jobs.delete(c)
    }
  }

  /** The cannon went back to aiming at `job` by itself (straight at it, or at a lane or offset point). */
  private resumed(c: Cannon, job: Job): boolean {
    return c.target === job.target || (c.target === null && c.aimPoint !== null)
  }

  /** Why a job can no longer go on, or null while it still can. */
  private broken(c: Cannon, job: Job): string | null {
    const t = job.target
    if (job.kind === 'heal') return null // sync() ends heals
    if (t.side === this.side) return `${t.id} captured`
    if (this.lanesKnown(c) && !canReach(c, t, this.view)) return `no lane to ${t.id}`
    if (job.provisional && this.lanesKnown(c)) return 'lanes ready'
    return null
  }

  /** True once every tower type's lanes for this cannon are built. */
  private lanesKnown(c: Cannon): boolean {
    return KIND_IDS.every((kind) => this.lanes.has(laneKey(c.id, kind)))
  }

  private think(c: Cannon, cannons: Cannon[], why: string): void {
    this.nextThink.set(c, this.now + this.timing.thinkMs)
    if (this.deliberating.some((d) => d.cannon === c)) return
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
    if (this.skill.lookahead && this.world && this.lanesKnown(c)) {
      const candidates = this.candidates(c, cannons, kept)
      if (candidates.length > 1) {
        const mates = new Map(candidates.filter((x) => x.mate).map((x) => [x.mate!, this.jobs.get(x.mate!)]))
        this.deliberating.push({ cannon: c, why: broken ? `${why}: ${broken}` : why, kept, held: job, candidates, mates, values: [], base: this.world.fork(), world: null, end: 0, ms: 0 })
        return
      }
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
    if (this.lanesKnown(c)) this.swaps.consider(c, job.target, this.view, (x, kind) => x.setKind(kind))
    this.jobs.set(c, job)
    this.aim(c, job)
    this.react.delete(c)
    this.nextThink.set(c, this.now + this.timing.thinkMs)
    this.note(c, why)
  }

  /** Re-check the tower type for the current job (only if it can't hit at all when `stuckOnly`). */
  private refit(c: Cannon, job: Job, stuckOnly = false): void {
    if (!this.lanesKnown(c)) return
    const canHit = kindRate(c, c.kind, job.target, this.view) > 0
    if (canHit && (stuckOnly || c.aimErrorDeg() > TURNING_DEG)) return
    if (!this.swaps.consider(c, job.target, this.view, (x, kind) => x.setKind(kind))) return
    this.aimErr.delete(c) // a new type means a fresh first shot
    this.aim(c, job)
    this.note(c, `refit as ${c.kind}`)
  }

  /**
   * Aim `c` for its job along its lane. Easy and Normal aim a bit off: at a
   * point beside the lane, by their current aim error (see TUNING.aiLevels).
   */
  private aim(c: Cannon, job: Job): void {
    const lane = lanesOf(this.view, c)?.get(job.target.id)
    const err = this.errorFor(c, job, lane)
    if (err === 0) {
      if (job.kind === 'heal') healViaLane(c, job.target, lane, this.board)
      else aimViaLane(c, job.target, lane, this.board)
      return
    }
    const t = job.target
    const dist = Math.hypot(t.x - c.x, t.y - c.y)
    const straight = !lane || lane.direct
    const base = straight ? Math.atan2(t.y - c.y, t.x - c.x) : lane.angle
    const half = (lane ? lane.widthDeg : directWidthDeg(dist)) / 2
    const angle = base + (err * half * Math.PI) / 180
    const point = straight ? { x: c.x + Math.cos(angle) * dist, y: c.y + Math.sin(angle) * dist } : pointAlong(c, angle, this.board)
    if (job.kind === 'heal') c.startHeal(t, point)
    else c.setAimPoint(point)
  }

  /** The cannon's aim error for this job: drawn when the job (or type) is new, shrunk after each miss. */
  private errorFor(c: Cannon, job: Job, lane: Lane | undefined): number {
    const spread = this.skill.aimError
    if (spread <= 0) return 0
    const known = this.aimErr.get(c)
    if (known && known.job === job) return known.err
    const t = job.target
    const base = !lane || lane.direct ? Math.atan2(t.y - c.y, t.x - c.x) : lane.angle
    const turn = Math.sign(angleDelta(c.angle, base)) || (this.rng() < 0.5 ? -1 : 1)
    // Overshoot carries on past the target the way the barrel was turning; undershoot stops short.
    const side = this.rng() < this.skill.overshoot ? turn : -turn
    const err = side * Math.abs(gaussian(this.rng)) * spread
    this.aimErr.set(c, { job, err })
    return err
  }

  /**
   * One of this side's shots is gone (`hitId`: what it hit, or null). After a
   * miss on its job, a cannon that aims with an error corrects it (it sees
   * where the shot went) and re-aims.
   */
  shotLanded(ownerId: string, hitId: string | null): void {
    const c = this.byId.get(ownerId)
    if (!c || c.side !== this.side) return
    const job = this.jobs.get(c)
    const known = this.aimErr.get(c)
    if (!job || !known || known.job !== job || known.err === 0) return
    if (hitId === job.target.id) return
    known.err *= this.skill.correct
    if (Math.abs(known.err) < 0.05) known.err = 0
    this.aim(c, job)
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
   * guesses from distance alone. Easy and Normal misjudge each job a little
   * (a fixed bias per cannon and target, so it doesn't make them twitchy).
   */
  score(c: Cannon, foe: Cannon, cannons: Cannon[], crowded = true): number {
    const dist = Math.hypot(foe.x - c.x, foe.y - c.y)
    const crowd = crowded ? this.crowd(c, foe, cannons) : 0
    if (!this.lanes.has(laneKey(c.id, c.kind))) return (dist / shotSpeedFor(c.kind)) * 1000 + crowd
    const kind = this.swaps.preview(c, foe, this.view)
    const time = jobTime(c, kind, foe, this.view)
    if (!Number.isFinite(time)) return Infinity
    const lane = this.view.get(laneKey(c.id, kind))?.get(foe.id)
    const turnDeg = lane ? Math.abs((angleDelta(c.angle, lane.angle) * 180) / Math.PI) : 0
    const turn = (turnDeg / turnSpeedDegFor(kind)) * 1000
    const travel = (dist / shotSpeedFor(kind)) * 1000
    const misjudge = this.skill.misjudge ? 1 + this.skill.misjudge * (hash01(`${this.seed}:${c.id}>${foe.id}`) * 2 - 1) : 1
    return (time + turn + travel) * misjudge + crowd
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

  // ------------------------------------------------------------ look-ahead

  /**
   * Impossible's options for `c`: its best few jobs by estimate, keeping the
   * current job (if any), and trading jobs with the teammate whose target
   * suits it best.
   */
  private candidates(c: Cannon, cannons: Cannon[], kept: Job | null): Candidate[] {
    const scored: Candidate[] = []
    for (const foe of cannons) {
      if (foe.side === this.side) continue
      const score = this.score(c, foe, cannons)
      if (Number.isFinite(score)) scored.push({ target: foe, score })
    }
    scored.sort((a, b) => a.score - b.score)
    const out = scored.filter((x) => x.target !== kept?.target).slice(0, TUNING.aiLookahead.candidates)
    if (kept) {
      out.push({ target: kept.target, keep: true, score: this.score(c, kept.target, cannons) })
      let mate: Cannon | null = null
      let bestRaw = Infinity
      for (const [other, job] of this.jobs) {
        if (other === c || other.side !== this.side || job.kind !== 'attack' || job.target === kept.target) continue
        if (other.healing || other.aimErrorDeg() > TURNING_DEG || this.now - job.since < this.timing.commitMs) continue
        if (!Number.isFinite(this.score(other, kept.target, cannons, false))) continue
        const raw = this.score(c, job.target, cannons, false)
        if (raw < bestRaw) {
          bestRaw = raw
          mate = other
        }
      }
      if (mate) out.push({ target: this.jobs.get(mate)!.target, mate, score: bestRaw })
    }
    return out
  }

  /**
   * Work through pending look-aheads for at most frameBudgetMs (always at
   * least one step). A simulation can run over several frames, so even a
   * big map never stalls one.
   */
  private deliberate(cannons: Cannon[]): void {
    const start = nowMs()
    const { frameBudgetMs, frameSteps, stepMs } = TUNING.aiLookahead
    let steps = 0
    const spent = () => steps >= frameSteps || nowMs() - start >= frameBudgetMs
    while (this.deliberating.length) {
      const d = this.deliberating[0]
      if (d.cannon.side !== this.side) {
        this.deliberating.shift()
        continue
      }
      const t0 = nowMs()
      if (!d.world) {
        d.world = this.setUp(d.base, d.cannon, d.candidates[d.values.length], d.kept)
        d.end = d.world.clock + TUNING.aiLookahead.horizonMs
      }
      const w = d.world
      while (w.clock < d.end && !w.ended) {
        w.step(stepMs)
        steps += 1
        if (spent()) break
      }
      d.ms += nowMs() - t0
      if (w.clock >= d.end || w.ended) {
        d.values.push(this.value(w))
        d.world = null
        this.lookahead.sims += 1
        if (d.values.length === d.candidates.length) {
          this.deliberating.shift()
          this.decide(d, cannons)
        }
      }
      if (spent()) break
    }
    this.lookahead.steps += steps
    this.lookahead.frames += 1
    this.lookahead.maxFrameSteps = Math.max(this.lookahead.maxFrameSteps, steps)
    this.lookahead.maxFrameMs = Math.max(this.lookahead.maxFrameMs, nowMs() - start)
  }

  /** A copy of the round with this candidate (and the team's likely jobs) applied, ready to play forward. */
  private setUp(base: BattleSim, c: Cannon, cand: Candidate, kept: Job | null): BattleSim {
    const world = base.fork()
    const me = world.byId(c.id)!
    const apply = (who: Cannon, target: Cannon) => {
      const kind = this.swaps.preview(who, target, this.view)
      if (kind !== who.kind) who.setKind(kind)
      aimViaLane(who, target, lanesOf(this.view, who)?.get(target.id), this.board)
    }
    if (!cand.keep) {
      apply(me, world.byId(cand.target.id)!)
      if (cand.mate && kept) apply(world.byId(cand.mate.id)!, world.byId(kept.target.id)!)
    }
    // Teammates with nothing to do yet get the job they would most likely
    // pick, knowing this cannon has taken the candidate.
    const claimed = this.jobs.get(c)
    this.jobs.set(c, { kind: 'attack', target: cand.target, since: this.now })
    for (const mate of world.cannons) {
      if (mate === me || mate.side !== this.side || mate.aim()) continue
      const real = this.byId.get(mate.id)
      const pick = real ? this.bestJob(real, [...this.byId.values()]) : null
      if (pick) apply(mate, world.byId(pick.target.id)!)
    }
    if (claimed) this.jobs.set(c, claimed)
    else this.jobs.delete(c)
    return world
  }

  /** How good a round looks for this side: cannons held, plus capture progress either way. */
  private value(world: BattleSim): number {
    if (world.ended) return (world.count(this.side) === world.cannons.length ? 1 : -1) * 1e6
    const hold = TUNING.captureThreshold * 1.5
    let v = 0
    for (const c of world.cannons) {
      const own = c.side === this.side ? 1 : c.side === 'neutral' ? 0 : -1
      const meter = c.captureAttacker === this.side ? c.captureProgress : c.captureAttacker ? -c.captureProgress : 0
      v += own * hold + meter
    }
    return v
  }

  private decide(d: Deliberation, cannons: Cannon[]): void {
    const c = d.cannon
    this.lookahead.thinks += 1
    this.lookahead.totalMs += d.ms
    this.lookahead.maxThinkMs = Math.max(this.lookahead.maxThinkMs, d.ms)
    // The look-ahead takes a few frames. If this cannon got a new job in the meantime (an event, or a
    // teammate's trade), that newer decision stands; the next think looks again.
    if (this.jobs.get(c) !== d.held) return
    let best = -1
    for (let i = 0; i < d.candidates.length; i++) {
      const cand = d.candidates[i]
      if (cand.target.side === this.side) continue
      if (cand.mate && this.jobs.get(cand.mate) !== d.mates.get(cand.mate)) continue
      // Ties go to the quicker estimate (the list is sorted that way).
      if (best < 0 || d.values[i] > d.values[best] + 1e-6) best = i
    }
    if (best < 0) return
    // Changing plans has to win by a clear margin over keeping the current one.
    const keep = d.candidates.findIndex((x) => x.keep)
    if (keep >= 0 && keep !== best && d.values[best] < d.values[keep] + TUNING.aiLookahead.minGain) best = keep
    const pick = d.candidates[best]
    const tried = d.candidates.map((x, i) => `${x.keep ? 'keep ' : x.mate ? 'trade ' : ''}${x.target.id} ${d.values[i].toFixed(1)}`).join(', ')
    const kept = this.jobs.get(c) === d.kept ? d.kept : null
    if (pick.keep && kept) return this.refit(c, kept)
    this.commit(c, { kind: 'attack', target: pick.target, since: this.now }, `${d.why}: look-ahead picked ${pick.target.id}${pick.mate ? ` (trading with ${pick.mate.id})` : ''} [${tried}]`)
    if (pick.mate && kept && pick.mate.side === this.side && kept.target.side !== this.side) {
      this.commit(pick.mate, { kind: 'attack', target: kept.target, since: this.now }, `look-ahead: trade with ${c.id}`)
    }
    void cannons
  }

  /** Send helpers to friends close to flipping (see planHeals). */
  private assignHelpers(cannons: Cannon[]): void {
    for (const { helper, friend } of planHeals(this.side, cannons, this.view)) {
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
