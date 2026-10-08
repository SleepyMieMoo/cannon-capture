import { DEFAULT_SKIN, vsAiSkins, type SideSkins } from '../config/skins'
import type Phaser from 'phaser'
import { AiController, aimViaLane } from '../ai/AiController'
import { aiDifficulty, swapPolicy } from '../ai/towerChoice'
import { TUNING } from '../config/tuning'
import { Cannon } from '../entities/Cannon'
import { Shot } from '../entities/Shot'
import { boardFor } from '../levels/board'
import type { AiLevel, CannonKind, LevelDef, Point, Rect, Side } from '../types'
import { Broadphase, type BallisticsOpts, type Barrier, type Body } from './ballistics'
import { LaneBuilder, lanesOf, levelFans, shotOpts, type LaneTable } from './solver'

/** How a round ended, for gold: 'draw' only in player vs player (the time limit with equal cannons). */
export type Outcome = 'win' | 'lose' | 'draw'

/** Puzzle: lose once out of aims and no neutral has been hit for this long. */
export const PUZZLE_STALL_MS = 5000
/**
 * Safety cap on live shots; the oldest are dropped beyond it. Sized so even
 * 60 machine guns (each keeps about a dozen short-lived shots in the air)
 * stay under it, so in practice no shot is ever dropped.
 */
export const MAX_SHOTS = 800
const NO_BARRIERS: Barrier[] = []

export interface SimEvents {
  bounce?(x: number, y: number): void
  hit?(x: number, y: number, side: Side, kind: CannonKind): void
  /** A friendly shot took `amount` capture progress off one of its own cannons. */
  healed?(cannon: Cannon, amount: number): void
  /** The countdown ended: firing starts. */
  go?(): void
  captured?(cannon: Cannon): void
  noAims?(cannon: Cannon): void
  /** A cannon changed tower type mid-round. */
  swapped?(cannon: Cannon): void
  /** A shot from `side` hit `shield`'s barrier at (x, y). */
  blocked?(x: number, y: number, shield: Cannon, side: Side, kind: CannonKind): void
  /** That hit broke the barrier (it is down for TUNING.shield.downMs). */
  shieldBroken?(shield: Cannon): void
  /** A broken barrier came back. */
  shieldBack?(shield: Cannon): void
  aimed?(point: Point): void
  /** A cannon fired a shot (sound effects). */
  fired?(cannon: Cannon, shot: Shot): void
}

/**
 * The rules of one round, independent of rendering. BattleScene drives it
 * every frame and draws the result; tests and level checks run it headless
 * (pass `scene = null`).
 */
export class BattleSim {
  readonly level: LevelDef
  readonly lanes: LaneTable
  readonly board: Rect
  private readonly opts: BallisticsOpts
  private readonly builder: LaneBuilder | null = null
  readonly cannons: Cannon[] = []
  shots: Shot[] = []
  /** Pink's AI. */
  readonly ai = new AiController('enemy')
  /** Every AI playing this round (pink's, plus one for your side in AI-vs-AI tests). */
  readonly ais: AiController[] = [this.ai]
  /** Look-ahead copies run without any AI. */
  private aiOff = false
  clock = 0
  aimsUsed = 0
  ended: Outcome | null = null
  endReason = ''
  private lastPuzzleProgress = 0
  private readonly fans
  private readonly bodies: Body[]
  private readonly near: Broadphase
  /**
   * Sides played by people (orders come in through playerAim / playerSwap /
   * the auto-target toggles, or applyOrder in sim/orders.ts). Gold only,
   * unless makePvp() hands pink to a second player too.
   */
  private humans: ReadonlySet<Side> = new Set<Side>(['player'])
  /** Player vs player: no AI, and a side wins once the other holds no cannons. */
  pvp = false
  /**
   * Global auto-target per human side (the Settings toggle). On: that side's
   * cannons whose own toggle (Cannon.autoTarget) is on pick a new target by
   * themselves when theirs is captured, and newly captured cannons aim at the
   * nearest foe. Off: none of them ever does (their own toggles are kept for
   * when it comes back on). Every round starts with it on. AI sides ignore it.
   */
  private autoOn: Record<Side, boolean> = { player: true, enemy: true, neutral: true }
  /** Shots fired so far (each shot gets the next id, so a network view can follow it). */
  shotSeq = 0
  /**
   * Tactical pause: while true, step() does nothing (shots, turning, reloads,
   * barriers, meters, AI and timers all hold), and your aim and type orders
   * are queued, then all applied the instant you resume (see resume()).
   */
  paused = false
  /**
   * Countdown before the round (ms left; 0 = running). During it nothing
   * fires and the clock stands still, but barrels turn, orders apply and the
   * AI plans. Headless rounds (tests, the server before startCountdown) start at 0.
   */
  countdown = 0
  /** Performance overlay: when true, step() adds the AIs' time to aiMs (the caller resets it). */
  timeAi = false
  aiMs = 0
  private queuedAims = new Map<Cannon, Cannon | Point>()
  /** Which side gave each queued order (both players may queue during a PvP pause). */
  private queuedBy = new Map<Cannon, Side>()
  private queuedKinds = new Map<Cannon, CannonKind>()
  /** Scratch list: shields with their barrier up this step. */
  private readonly upShields: Cannon[] = []

  /** Skins per side for drawing (the scene sets them; see config/skins.ts). Shared with every cannon. */
  readonly skins: SideSkins = vsAiSkins(DEFAULT_SKIN)

  /** Change the round's skins in place (the cannons share this object). */
  setSkins(s: SideSkins): void {
    this.skins.player = s.player
    this.skins.enemy = s.enemy
    this.skins.neutral = 'classic'
  }

  constructor(
    level: LevelDef,
    scene: Phaser.Scene | null = null,
    private readonly events: SimEvents = {},
    lanes?: LaneTable | 'progressive',
  ) {
    this.level = level
    this.board = boardFor(level)
    this.opts = shotOpts(level)
    if (lanes === 'progressive') {
      // Rendering: build lanes a few ms per frame (see pumpLanes).
      this.builder = new LaneBuilder(level)
      this.lanes = this.builder.table
    } else {
      this.lanes = lanes ?? new LaneBuilder(level, 1).runAll()
    }
    this.fans = levelFans(level)
    this.ai.reset(this.lanes, TUNING.aiRetargetMs, this.board, swapPolicy(level), aiDifficulty(level), this)
    level.cannons.forEach((def, index) => {
      this.cannons.push(
        new Cannon(scene, def.id, def.name, def.x, def.y, def.side, (index % 3) * TUNING.fireStaggerMs, def.kind),
      )
    })
    for (const c of this.cannons) {
      c.skins = this.skins
      c.healHook = this
    }
    for (const def of level.cannons) {
      const cannon = this.byId(def.id)!
      if (def.aimAt) cannon.setTarget(this.byId(def.aimAt) ?? null)
      else if (def.aimPoint) cannon.setAimPoint(def.aimPoint)
      cannon.snapToAim()
    }
    this.bodies = this.cannons.map((c) => ({ id: c.id, x: c.x, y: c.y, radius: TUNING.cannonRadius }))
    // Steps are at most ~32ms at the capped shot speed (under 20px).
    this.near = new Broadphase(level.walls, this.bodies, TUNING.shotRadius, 48)
  }

  /**
   * Let an AI play your side too (AI-vs-AI tests, the mirror bot). Returns
   * it; it is updated every step like pink's.
   */
  addAi(side: Side, difficulty: AiLevel): AiController {
    const ai = new AiController(side)
    ai.reset(this.lanes, TUNING.aiRetargetMs, this.board, swapPolicy(this.level), difficulty, this)
    this.ais.push(ai)
    return ai
  }

  /**
   * Player vs player: pink is a person too. Drops pink's AI (and any other),
   * so both sides only move on orders. Call before the first step.
   */
  makePvp(): void {
    this.pvp = true
    this.humans = new Set<Side>(['player', 'enemy'])
    this.ais.length = 0
  }

  /**
   * Player vs player: hand a side to an AI (a player left) or back to its
   * person (`null`). Only one AI per side.
   */
  setController(side: Side, ai: AiLevel | null): void {
    const humans = new Set(this.humans)
    for (let i = this.ais.length - 1; i >= 0; i--) if (this.ais[i].side === side) this.ais.splice(i, 1)
    if (ai) {
      humans.delete(side)
      this.addAi(side, ai)
    } else humans.add(side)
    this.humans = humans
  }

  /** Which AI (if any) plays `side`. */
  aiFor(side: Side): AiController | null {
    return this.ais.find((ai) => ai.side === side) ?? null
  }

  /** End the round now (player vs player: the time limit). */
  endMatch(result: Outcome, reason = ''): void {
    if (!this.ended) this.finish(result, reason)
  }

  /** True for a side whose orders come from a person. */
  isHuman(side: Side): boolean {
    return this.humans.has(side)
  }

  /** Gold's global auto-target setting (the Settings toggle in single-player). */
  get autoTarget(): boolean {
    return this.autoOn.player
  }

  set autoTarget(on: boolean) {
    this.autoOn.player = on
  }

  /** A side's global auto-target setting. */
  autoTargetOf(side: Side): boolean {
    return this.autoOn[side]
  }

  /**
   * A headless copy of the round as it stands (cannons, meters, aims, reloads,
   * shots in flight) that shares the level, lanes and collision grid. No AI
   * runs in it and it reports no events: Impossible's look-ahead plays its
   * candidate plans forward in copies like this.
   */
  fork(): BattleSim {
    const f = Object.create(BattleSim.prototype) as BattleSim
    const cannons = this.cannons.map((c) => c.copy())
    const byId = (id: string) => cannons.find((c) => c.id === id)
    cannons.forEach((c, i) => {
      c.linkCopy(this.cannons[i], byId)
      c.healHook = f
    })
    Object.assign(f, {
      level: this.level,
      lanes: this.lanes,
      board: this.board,
      opts: this.opts,
      builder: null,
      cannons,
      shots: this.shots.map((s) => new Shot({ ...s.ball }, s.side, s.damage, s.kind)),
      ai: this.ai,
      ais: [],
      aiOff: true,
      clock: this.clock,
      aimsUsed: this.aimsUsed,
      humans: this.humans,
      pvp: this.pvp,
      autoOn: { ...this.autoOn },
      shotSeq: this.shotSeq,
      paused: false,
      countdown: this.countdown,
      queuedAims: new Map(),
      queuedBy: new Map(),
      queuedKinds: new Map(),
      ended: this.ended,
      endReason: '',
      lastPuzzleProgress: this.lastPuzzleProgress,
      fans: this.fans,
      bodies: this.bodies,
      near: this.near,
      upShields: [],
      events: {},
    })
    return f
  }

  get isPuzzle(): boolean {
    return this.level.kind === 'puzzle'
  }

  /** Puzzle aims still to spend (aims queued during a pause count as spent). */
  get aimsLeft(): number {
    return this.level.aims === undefined ? Infinity : Math.max(0, this.level.aims - this.aimsUsed - this.queuedAims.size)
  }

  /** Start (or restart) the pre-round countdown. Call before the first step. */
  startCountdown(ms: number): void {
    this.countdown = Math.max(0, ms)
  }

  /**
   * Pause the round (no-op once it has ended). In player vs player there is
   * no pausing during the countdown: orders already work then, and a pause
   * would only hold up the other player (and spend one of three).
   */
  pause(): boolean {
    if (this.ended || (this.pvp && this.countdown > 0)) return false
    this.paused = true
    return true
  }

  /**
   * Resume: apply every queued order at this one instant (type swaps first,
   * so their reload starts now, then aims), then let each AI react. Only
   * Impossible re-thinks at once (see AiController.afterPause); the other
   * levels keep their usual reaction time.
   */
  resume(): void {
    if (!this.paused) return
    this.paused = false
    // Sides can't change while paused, so each order is still its giver's.
    const stillTheirs = (cannon: Cannon) => this.humans.has(cannon.side) && (this.queuedBy.get(cannon) ?? 'player') === cannon.side
    for (const [cannon, kind] of this.queuedKinds) {
      if (stillTheirs(cannon) && cannon.setKind(kind)) this.events.swapped?.(cannon)
    }
    const aims = [...this.queuedAims]
    const by = new Map(this.queuedBy)
    this.queuedKinds.clear()
    this.queuedAims.clear()
    this.queuedBy.clear()
    for (const [cannon, aim] of aims) {
      if (!this.humans.has(cannon.side) || (by.get(cannon) ?? 'player') !== cannon.side) continue
      this.applyAim(cannon, aim)
      if (this.level.aims !== undefined) this.aimsUsed += 1
    }
    for (const ai of this.ais) ai.afterPause(this.cannons)
  }

  /** The aim order queued for one of your cannons during this pause, if any. */
  queuedAim(cannon: Cannon): Cannon | Point | null {
    return this.queuedAims.get(cannon) ?? null
  }

  /** The type swap queued for one of your cannons during this pause, if any. */
  queuedKind(cannon: Cannon): CannonKind | null {
    return this.queuedKinds.get(cannon) ?? null
  }

  /** Every queued order (for drawing them), or only those `side` gave (each player sees only their own). */
  queuedOrders(side?: Side): { cannon: Cannon; aim: Cannon | Point | null; kind: CannonKind | null }[] {
    const out = new Map<Cannon, { cannon: Cannon; aim: Cannon | Point | null; kind: CannonKind | null }>()
    const mine = (cannon: Cannon) => side === undefined || (this.queuedBy.get(cannon) ?? 'player') === side
    for (const [cannon, aim] of this.queuedAims) if (mine(cannon)) out.set(cannon, { cannon, aim, kind: null })
    for (const [cannon, kind] of this.queuedKinds) {
      if (!mine(cannon)) continue
      const o = out.get(cannon)
      if (o) o.kind = kind
      else out.set(cannon, { cannon, aim: null, kind })
    }
    return [...out.values()]
  }

  /** Network views: show these queued orders (the viewer's own, as the authoritative round has them). */
  setViewQueued(orders: { cannon: Cannon; aim: Cannon | Point | null; kind: CannonKind | null }[]): void {
    this.queuedAims.clear()
    this.queuedKinds.clear()
    this.queuedBy.clear()
    for (const o of orders) {
      if (o.aim) this.queuedAims.set(o.cannon, o.aim)
      if (o.kind) this.queuedKinds.set(o.cannon, o.kind)
      this.queuedBy.set(o.cannon, 'player')
    }
  }

  byId(id: string): Cannon | undefined {
    return this.cannons.find((cannon) => cannon.id === id)
  }

  count(side: Side): number {
    let n = 0
    for (const cannon of this.cannons) if (cannon.side === side) n += 1
    return n
  }

  /** Spend up to `budgetMs` building lanes (progressive mode only). */
  pumpLanes(budgetMs: number): void {
    if (this.builder && !this.builder.done) this.builder.pump(budgetMs)
  }

  get lanesReady(): boolean {
    return !this.builder || this.builder.done
  }

  /** Advance the round by `dt` ms. */
  step(dt: number): void {
    if (this.ended || this.paused) return
    const counting = this.countdown > 0
    if (!counting) this.clock += dt
    if (!this.isPuzzle && !this.aiOff) {
      if (this.timeAi) {
        const t0 = performance.now()
        for (const ai of this.ais) ai.update(dt, this.cannons)
        this.aiMs += performance.now() - t0
      } else for (const ai of this.ais) ai.update(dt, this.cannons)
    }
    this.stepShots(dt, counting)
    if (counting) {
      this.countdown -= dt
      if (this.countdown <= 1e-6) this.go()
    }
    this.checkOutcome()
  }

  /**
   * The countdown is over: every fire timer starts fresh. Each side's cannons
   * fire at the same offsets (0, 90, 180 ms by their order on that side), so
   * no side fires first and a volley isn't one frame.
   */
  private go(): void {
    this.countdown = 0
    const rank: Record<Side, number> = { player: 0, enemy: 0, neutral: 0 }
    for (const c of this.cannons) c.armAtGo((rank[c.side]++ % 3) * TUNING.fireStaggerMs)
    this.events.go?.()
  }

  /**
   * Whether `cannon` picks targets by itself right now. Your cannons: the
   * global toggle and its own toggle both on, and never in puzzles (every aim
   * there is yours to spend). Other sides without an AI (look-ahead copies)
   * always do; sides an AI plays are left to the AI.
   */
  autoTargets(cannon: Cannon): boolean {
    if (!this.humans.has(cannon.side)) return !this.isPuzzle
    return !this.isPuzzle && this.autoOn[cannon.side] && cannon.autoTarget
  }

  /** The Settings toggle: auto-target on or off for all of a side's cannons (gold by default). */
  setAutoTarget(on: boolean, side: Side = 'player'): void {
    if (this.humans.has(side)) this.autoOn[side] = on
  }

  /** Flip one of your cannons' own auto-target toggle. Returns its new value (null if it isn't yours). */
  toggleCannonAuto(cannon: Cannon, side: Side = 'player'): boolean | null {
    if (cannon.side !== side || !this.humans.has(side)) return null
    cannon.autoTarget = !cannon.autoTarget
    return cannon.autoTarget
  }

  /** A player aim order (from gold, or `side` in PvP). Returns false when the puzzle aim budget is spent. */
  playerAim(cannon: Cannon, aim: Cannon | Point, side: Side = 'player'): boolean {
    if (this.ended || cannon.side !== side || !this.humans.has(side)) return false
    // Re-aiming a cannon that already has an order queued in this pause is free.
    if (this.aimsLeft <= 0 && !(this.paused && this.queuedAims.has(cannon))) {
      this.events.noAims?.(cannon)
      return false
    }
    if (this.paused) {
      this.queuedAims.set(cannon, aim)
      this.queuedBy.set(cannon, side)
      this.events.aimed?.({ x: aim.x, y: aim.y })
      return true
    }
    this.applyAim(cannon, aim)
    if (this.level.aims !== undefined) this.aimsUsed += 1
    this.events.aimed?.({ x: aim.x, y: aim.y })
    return true
  }

  private applyAim(cannon: Cannon, aim: Cannon | Point): void {
    // A shield just turns its barrier: toward a foe (and keeps facing it), or toward any point.
    if (!cannon.fires) {
      if (aim instanceof Cannon && aim.side !== cannon.side) cannon.setTarget(aim)
      else if (aim !== cannon) cannon.setAimPoint({ x: aim.x, y: aim.y })
    } else if (aim instanceof Cannon && aim.side === cannon.side) cannon.startHeal(aim)
    else if (aim instanceof Cannon) cannon.setTarget(aim)
    else cannon.setAimPoint(aim)
  }

  /**
   * Your swap order: change one of your cannons to another tower type. It
   * then reloads for its new type's full interval (at least
   * TUNING.swapLockMs). Free in puzzles: it does not spend an aim.
   */
  playerSwap(cannon: Cannon, kind: CannonKind, side: Side = 'player'): boolean {
    if (this.ended || cannon.side !== side || !this.humans.has(side)) return false
    if (this.paused) {
      // Queued: the swap (and its reload) happens when you resume. Picking its current type cancels it.
      if (kind === cannon.kind) return this.queuedKinds.delete(cannon)
      this.queuedKinds.set(cannon, kind)
      this.queuedBy.set(cannon, side)
      return true
    }
    if (!cannon.setKind(kind)) return false
    this.events.swapped?.(cannon)
    return true
  }

  private stepShots(dt: number, frozen = false): void {
    // Every side fires at the same rate: difficulty is intelligence only.
    const shields = this.upShields
    shields.length = 0
    for (const cannon of this.cannons) {
      const spawned = cannon.update(dt, frozen, TUNING.fireIntervalMs)
      if (spawned) {
        const shot = new Shot(spawned, cannon.side, cannon.damage, cannon.kind)
        shot.id = ++this.shotSeq
        this.shots.push(shot)
        this.events.fired?.(cannon, shot)
      }
      if (cannon.shieldReturned) {
        cannon.shieldReturned = false
        this.events.shieldBack?.(cannon)
      }
      if (cannon.shieldUp) shields.push(cannon)
    }
    const barriers = shields.length ? shields.map((c) => c.barrier()!) : NO_BARRIERS

    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i]
      const near = this.near.at(shot.ball.x, shot.ball.y)
      const result = shot.step(dt, near.walls, this.fans, near.bodies, this.opts, barriers.length ? this.barriersFor(shot, shields, barriers, dt) : undefined)
      if (result.bounced) this.events.bounce?.(shot.ball.x, shot.ball.y)
      if (result.blockedBy && !this.ended) {
        const shield = this.byId(result.blockedBy)!
        this.events.blocked?.(shot.ball.x, shot.ball.y, shield, shot.side, shot.kind)
        if (shield.absorb(shot.damage).broke) this.events.shieldBroken?.(shield)
        for (const ai of this.ais) ai.sawHit(shield, shot, true)
      }
      if (result.hitId && !this.ended) {
        const cannon = this.byId(result.hitId)
        this.events.hit?.(shot.ball.x, shot.ball.y, shot.side, shot.kind)
        if (cannon) {
          if (cannon.side === 'neutral') this.lastPuzzleProgress = this.clock
          for (const ai of this.ais) ai.sawHit(cannon, shot, false)
          const hit = cannon.receiveHit(shot.side, shot.damage)
          if (hit.healed > 0) this.events.healed?.(cannon, hit.healed)
          if (hit.flipped) this.onCaptured(cannon)
        }
      }
      if (!shot.ball.alive) {
        // Let the AIs see where their shots went (every level but Impossible corrects its aim after a miss).
        for (const ai of this.ais) ai.shotLanded(shot.ball.ownerId, result.hitId, result.blockedBy)
        this.shots.splice(i, 1)
      }
    }
    if (this.shots.length > MAX_SHOTS) this.shots.splice(0, this.shots.length - MAX_SHOTS)
  }

  /** Barriers that could stop this shot this step: other sides' only, and only nearby ones. */
  private barriersFor(shot: Shot, shields: Cannon[], barriers: Barrier[], dt: number): Barrier[] | undefined {
    let out: Barrier[] | undefined
    const { x, y, vx, vy } = shot.ball
    const travel = (Math.hypot(vx, vy) * dt) / 1000 + 2
    for (let i = 0; i < shields.length; i++) {
      if (shields[i].side === shot.side) continue
      const b = barriers[i]
      const reach = b.r + b.band + travel
      const dx = x - b.x
      const dy = y - b.y
      if (dx * dx + dy * dy > reach * reach) continue
      ;(out ??= []).push(b)
    }
    return out
  }

  private onCaptured(cannon: Cannon): void {
    this.events.captured?.(cannon)
    // A cannon that just became yours starts with its own toggle on: it follows the global setting.
    if (this.humans.has(cannon.side)) cannon.autoTarget = true
    // Your cannons re-aim by themselves when their target falls (if auto-target
    // is on for them); the AI's cannons are left to the AI, which reacts after
    // its reaction time. With it off, a cannon whose target fell drops it and
    // holds its fire, barrel where it was, until you aim it.
    const aiSide = (side: Side) => this.ais.some((ai) => ai.side === side)
    for (const other of this.cannons) {
      if (aiSide(other.side) || !this.autoTargets(other)) continue
      if (other.target && other.target.side === other.side && other.target !== other.healing) other.setTarget(this.nearestFoe(other))
    }
    if (!aiSide(cannon.side) && this.autoTargets(cannon) && !cannon.aim()) {
      const foe = this.nearestFoe(cannon)
      if (foe) aimViaLane(cannon, foe, lanesOf(this.lanes, cannon)?.get(foe.id), this.board)
    }
  }

  /**
   * A heal just finished. A person's cannon with auto-target on for it (the
   * side's switch and its own) picks the best fresh target, the same way a
   * newly captured cannon does, instead of going back to its saved aim.
   * Returns false to keep the old rule (saved aim, or wait for orders):
   * auto-target off, puzzles, no foe left, and the AI's cannons (the AI
   * follows up its heals with its own plan).
   */
  healDone(cannon: Cannon): boolean {
    if (!this.humans.has(cannon.side) || this.ais.some((ai) => ai.side === cannon.side) || !this.autoTargets(cannon)) return false
    const foe = this.nearestFoe(cannon)
    if (!foe) return false
    aimViaLane(cannon, foe, lanesOf(this.lanes, cannon)?.get(foe.id), this.board)
    return true
  }

  /** Nearest foe it has a lane to, falling back to the nearest foe overall. */
  nearestFoe(cannon: Cannon): Cannon | null {
    const lanes = lanesOf(this.lanes, cannon)
    let best: Cannon | null = null
    let bestScore = Infinity
    for (const other of this.cannons) {
      if (other === cannon || other.side === cannon.side) continue
      const dist = Math.hypot(other.x - cannon.x, other.y - cannon.y)
      const score = lanes?.has(other.id) ? dist : dist + 10000
      if (score < bestScore) {
        best = other
        bestScore = score
      }
    }
    return best
  }

  /** Who won: gold for 'win', pink for 'lose', neutral for a draw, null while it is still on. */
  get winner(): Side | null {
    // A draw is "neutral" won.
    return this.ended === 'win' ? 'player' : this.ended === 'lose' ? 'enemy' : this.ended === 'draw' ? 'neutral' : null
  }

  private checkOutcome(): void {
    if (this.pvp) {
      // Player vs player: a side wins once the other holds no cannons (neutrals may be left).
      if (this.count('enemy') === 0) return this.finish('win')
      if (this.count('player') === 0) return this.finish('lose')
      return
    }
    const player = this.count('player')
    if (player === this.cannons.length) return this.finish('win')
    if (player === 0) return this.finish('lose', 'The enemy took every cannon you held.')
    if (this.isPuzzle && this.aimsLeft === 0 && this.clock - this.lastPuzzleProgress > PUZZLE_STALL_MS) {
      this.finish('lose', 'Out of aims, and the board has gone quiet.')
    }
  }

  private finish(result: Outcome, reason = ''): void {
    this.ended = result
    this.endReason = reason
  }
}
