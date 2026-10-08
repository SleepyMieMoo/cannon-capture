import { TUNING } from '../config/tuning'
import {
  stepBall,
  type Ball,
  type BallisticsOpts,
  type Barrier,
  type Body,
  type FanField,
  type StepResult,
} from '../sim/ballistics'
import type { CannonKind, Rect, Side } from '../types'

export class Shot {
  ball: Ball
  prevX: number
  prevY: number
  readonly side: Side
  /** Capture progress this shot adds to a foe (or heals on a friend). */
  readonly damage: number
  readonly kind: CannonKind

  constructor(ball: Ball, side: Side, damage = 1, kind: CannonKind = 'normal') {
    this.ball = ball
    this.damage = damage
    this.kind = kind
    this.prevX = ball.x
    this.prevY = ball.y
    this.side = side
  }

  step(dt: number, walls: Rect[], fans: FanField[], bodies: Body[], opts: BallisticsOpts, barriers?: Barrier[]): StepResult {
    this.prevX = this.ball.x
    this.prevY = this.ball.y
    const result = stepBall(this.ball, dt, walls, fans, bodies, opts, barriers)
    this.ball = result.ball
    if (this.ball.age > (this.ball.lifeMs ?? TUNING.shotLifetimeMs)) this.ball.alive = false
    return result
  }
}
