import type Phaser from 'phaser'
import { AiController, aimViaLane } from '../ai/AiController'
import { TUNING } from '../config/tuning'
import { Cannon } from '../entities/Cannon'
import { Shot } from '../entities/Shot'
import type { LevelDef, Point, Side } from '../types'
import type { Body } from './ballistics'
import { levelFans, levelLanes, type LaneTable } from './solver'

export type Outcome = 'win' | 'lose'

/** Puzzle: lose once out of aims and no neutral has been hit for this long. */
export const PUZZLE_STALL_MS = 5000

export interface SimEvents {
  bounce?(x: number, y: number): void
  hit?(x: number, y: number, side: Side): void
  captured?(cannon: Cannon): void
  noAims?(cannon: Cannon): void
  aimed?(point: Point): void
}

/**
 * The rules of one round, independent of rendering. BattleScene drives it
 * every frame and draws the result; tests and level checks run it headless
 * (pass `scene = null`).
 */
export class BattleSim {
  readonly level: LevelDef
  readonly lanes: LaneTable
  readonly cannons: Cannon[] = []
  shots: Shot[] = []
  readonly ai = new AiController('enemy')
  clock = 0
  aimsUsed = 0
  ended: Outcome | null = null
  endReason = ''
  private lastPuzzleProgress = 0
  private readonly fans
  private readonly bodies: Body[]

  constructor(
    level: LevelDef,
    scene: Phaser.Scene | null = null,
    private readonly events: SimEvents = {},
    lanes?: LaneTable,
  ) {
    this.level = level
    this.lanes = lanes ?? levelLanes(level)
    this.fans = levelFans(level)
    this.ai.reset(this.lanes, level.ai?.retargetMs ?? TUNING.aiRetargetMs)
    level.cannons.forEach((def, index) => {
      this.cannons.push(new Cannon(scene, def.id, def.name, def.x, def.y, def.side, (index % 3) * TUNING.fireStaggerMs))
    })
    for (const def of level.cannons) {
      const cannon = this.byId(def.id)!
      if (def.aimAt) cannon.setTarget(this.byId(def.aimAt) ?? null)
      else if (def.aimPoint) cannon.setAimPoint(def.aimPoint)
      cannon.snapToAim()
    }
    this.bodies = this.cannons.map((c) => ({ id: c.id, x: c.x, y: c.y, radius: TUNING.cannonRadius }))
  }

  get isPuzzle(): boolean {
    return this.level.kind === 'puzzle'
  }

  get aimsLeft(): number {
    return this.level.aims === undefined ? Infinity : Math.max(0, this.level.aims - this.aimsUsed)
  }

  byId(id: string): Cannon | undefined {
    return this.cannons.find((cannon) => cannon.id === id)
  }

  count(side: Side): number {
    let n = 0
    for (const cannon of this.cannons) if (cannon.side === side) n += 1
    return n
  }

  /** Advance the round by `dt` ms. */
  step(dt: number): void {
    if (this.ended) return
    this.clock += dt
    if (!this.isPuzzle) this.ai.update(dt, this.cannons)
    this.stepShots(dt)
    this.checkOutcome()
  }

  /** A player aim order. Returns false when the puzzle aim budget is spent. */
  playerAim(cannon: Cannon, aim: Cannon | Point): boolean {
    if (this.ended || cannon.side !== 'player') return false
    if (this.aimsLeft <= 0) {
      this.events.noAims?.(cannon)
      return false
    }
    if (aim instanceof Cannon) cannon.setTarget(aim)
    else cannon.setAimPoint(aim)
    if (this.level.aims !== undefined) this.aimsUsed += 1
    this.events.aimed?.({ x: aim.x, y: aim.y })
    return true
  }

  private stepShots(dt: number): void {
    const enemyFire = this.level.ai?.fireMs ?? TUNING.fireIntervalMs
    for (const cannon of this.cannons) {
      const spawned = cannon.update(dt, false, cannon.side === 'enemy' ? enemyFire : TUNING.fireIntervalMs)
      if (spawned) this.shots.push(new Shot(spawned, cannon.side))
    }

    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i]
      const result = shot.step(dt, this.level.walls, this.fans, this.bodies)
      if (result.bounced) this.events.bounce?.(shot.ball.x, shot.ball.y)
      if (result.hitId && !this.ended) {
        const cannon = this.byId(result.hitId)
        this.events.hit?.(shot.ball.x, shot.ball.y, shot.side)
        if (cannon && cannon.side !== shot.side) {
          if (cannon.side === 'neutral') this.lastPuzzleProgress = this.clock
          if (cannon.receiveHit(shot.side)) this.onCaptured(cannon)
        }
      }
      if (!shot.ball.alive) this.shots.splice(i, 1)
    }
    if (this.shots.length > 80) this.shots.splice(0, this.shots.length - 80)
  }

  private onCaptured(cannon: Cannon): void {
    this.events.captured?.(cannon)
    if (this.isPuzzle) return // puzzles: every aim is yours to spend, nothing auto-aims
    for (const other of this.cannons) {
      if (other.target && other.target.side === other.side) other.setTarget(this.nearestFoe(other))
    }
    if (!cannon.aim()) {
      const foe = this.nearestFoe(cannon)
      if (foe) aimViaLane(cannon, foe, this.lanes.get(cannon.id)?.get(foe.id))
    }
    this.ai.retarget(this.cannons)
  }

  /** Nearest foe it has a lane to, falling back to the nearest foe overall. */
  nearestFoe(cannon: Cannon): Cannon | null {
    const lanes = this.lanes.get(cannon.id)
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

  private checkOutcome(): void {
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
