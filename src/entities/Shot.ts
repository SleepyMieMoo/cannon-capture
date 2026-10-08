import {
  stepBall,
  type Ball,
  type BallisticsOpts,
  type Barrier,
  type Body,
  type FanField,
  type StepResult,
} from '../sim/ballistics'
import type { CannonKind, GlassDef, PillarDef, Rect, Side } from '../types'

export class Shot {
  ball: Ball
  prevX: number
  prevY: number
  readonly side: Side
  /** Capture progress this shot adds to a foe (or heals on a friend). */
  readonly damage: number
  readonly kind: CannonKind
  /** Set by the sim when it is fired (network views follow shots by id). 0 for copies. */
  id = 0
  /** Drawing only (effects): the bank count last seen, and the shot's age then (its trail starts there). */
  fxBounces = 0
  fxSince = 0

  constructor(ball: Ball, side: Side, damage = 1, kind: CannonKind = 'normal') {
    this.ball = ball
    this.damage = damage
    this.kind = kind
    this.prevX = ball.x
    this.prevY = ball.y
    this.side = side
  }

  step(
    dt: number,
    walls: Rect[],
    fans: FanField[],
    bodies: Body[],
    opts: BallisticsOpts,
    barriers?: Barrier[],
    pillars?: readonly PillarDef[],
    glass?: readonly GlassDef[],
  ): StepResult {
    this.prevX = this.ball.x
    this.prevY = this.ball.y
    const result = stepBall(this.ball, dt, walls, fans, bodies, opts, barriers, pillars, glass)
    this.ball = result.ball
    if (result.ported) {
      // Through a portal: no streak across the board, and the trail starts again at the exit.
      this.prevX = this.ball.x
      this.prevY = this.ball.y
      this.fxSince = this.ball.age
    }
    return result
  }
}
