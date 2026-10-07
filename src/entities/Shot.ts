import { TUNING } from '../config/tuning'
import { BOARD } from '../config/layout'
import {
  stepBall,
  type Ball,
  type BallisticsOpts,
  type Body,
  type FanField,
  type StepResult,
} from '../sim/ballistics'
import type { Rect, Side } from '../types'

const OPTS: BallisticsOpts = {
  radius: TUNING.shotRadius,
  maxSpeed: TUNING.shotSpeed * TUNING.shotSpeedCap,
  maxBounces: TUNING.maxBounces,
  bounds: BOARD,
  ownerGraceMs: TUNING.ownerGraceMs,
}

export class Shot {
  ball: Ball
  prevX: number
  prevY: number
  readonly side: Side

  constructor(ball: Ball, side: Side) {
    this.ball = ball
    this.prevX = ball.x
    this.prevY = ball.y
    this.side = side
  }

  step(dt: number, walls: Rect[], fans: FanField[], bodies: Body[]): StepResult {
    this.prevX = this.ball.x
    this.prevY = this.ball.y
    const result = stepBall(this.ball, dt, walls, fans, bodies, OPTS)
    this.ball = result.ball
    if (this.ball.age > TUNING.shotLifetimeMs) this.ball.alive = false
    return result
  }
}
