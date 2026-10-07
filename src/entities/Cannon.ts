import type Phaser from 'phaser'
import { TUNING } from '../config/tuning'
import { lerpColor, shade, sideColor, theme } from '../config/theme'
import { aimAngle, aimShot, type Ball } from '../sim/ballistics'
import { angleDelta, turnToward } from '../sim/aim'
import { applyCaptureHit } from '../sim/capture'
import type { Point, Side } from '../types'

export class Cannon {
  readonly id: string
  readonly name: string
  readonly x: number
  readonly y: number
  /** Display objects; absent when simulating headless (tests, level checks). */
  readonly root?: Phaser.GameObjects.Container
  side: Side
  /** Aim at another cannon (re-aims automatically once it becomes ours). */
  target: Cannon | null = null
  /** Or aim at a free point on the board. */
  aimPoint: Point | null = null
  /** Current barrel direction in radians. Turns toward the aim at a limited speed. */
  angle: number
  captureAttacker: Side | null = null
  captureProgress = 0
  selected = false
  hovered = false

  private readonly body?: Phaser.GameObjects.Graphics
  private readonly barrel?: Phaser.GameObjects.Graphics
  private cooldown: number
  private hitFlash = 0
  private muzzle = 0
  private pop = 1

  constructor(
    scene: Phaser.Scene | null,
    id: string,
    name: string,
    x: number,
    y: number,
    side: Side,
    staggerMs: number,
  ) {
    this.id = id
    this.name = name
    this.x = x
    this.y = y
    this.side = side
    this.cooldown = staggerMs
    this.angle = side === 'enemy' ? Math.PI : side === 'player' ? 0 : -Math.PI / 2
    if (scene) {
      this.body = scene.add.graphics()
      this.barrel = scene.add.graphics()
      this.root = scene.add.container(x, y, [this.body, this.barrel])
      this.root.setDepth(5)
    }
  }

  setTarget(target: Cannon | null): void {
    if (target === this) return
    this.target = target
    if (target) this.aimPoint = null
  }

  clearAim(): void {
    this.target = null
    this.aimPoint = null
  }

  setAimPoint(point: Point): void {
    this.target = null
    this.aimPoint = { x: point.x, y: point.y }
  }

  /** Where this cannon wants to point, or null if it has no aim. */
  aim(): Point | null {
    if (this.target) return { x: this.target.x, y: this.target.y }
    return this.aimPoint
  }

  /** Point the barrel straight at the current aim (used when a level starts). */
  snapToAim(): void {
    const aim = this.aim()
    if (aim) this.angle = aimAngle(this, aim)
  }

  /** How far the barrel still has to turn, in degrees (0 when there is no aim). */
  aimErrorDeg(): number {
    const aim = this.aim()
    if (!aim) return 0
    return Math.abs((angleDelta(this.angle, aimAngle(this, aim)) * 180) / Math.PI)
  }

  /** Returns true when this hit flips ownership. */
  receiveHit(attacker: Side): boolean {
    if (attacker === this.side) return false
    const result = applyCaptureHit(
      { side: this.side, attacker: this.captureAttacker, progress: this.captureProgress },
      attacker,
      TUNING.captureThreshold,
    )
    this.side = result.state.side
    this.captureAttacker = result.state.attacker
    this.captureProgress = result.state.progress
    this.hitFlash = 1
    if (result.flipped) {
      this.pop = 1.24
      this.target = null
      this.aimPoint = null
      this.cooldown = TUNING.captureKickoffMs
    }
    return result.flipped
  }

  /**
   * Decay flashes and, unless frozen, fire when the cooldown elapses.
   * The returned ball is a new shot in world space.
   */
  update(dt: number, frozen: boolean, fireMs: number = TUNING.fireIntervalMs): Ball | null {
    this.hitFlash = Math.max(0, this.hitFlash - dt / 160)
    this.muzzle = Math.max(0, this.muzzle - dt)
    this.pop = Math.max(1, this.pop - dt / 380)
    if (this.side === 'neutral') return null
    if (this.target && this.target.side === this.side) this.target = null

    const aim = this.aim()
    if (aim) {
      const step = ((TUNING.turnSpeedDeg * Math.PI) / 180) * (dt / 1000)
      this.angle = turnToward(this.angle, aimAngle(this, aim), step)
    }
    if (frozen || !aim) return null

    this.cooldown -= dt
    if (this.cooldown > 0) return null
    if (this.aimErrorDeg() > TUNING.holdFireAboveDeg) {
      // Mid-swing: stay loaded and fire as soon as the barrel comes round.
      this.cooldown = 0
      return null
    }
    this.cooldown = fireMs
    this.muzzle = 110
    // Fire along the barrel's current direction, not straight at the aim.
    const along = { x: this.x + Math.cos(this.angle) * 100, y: this.y + Math.sin(this.angle) * 100 }
    return aimShot(this, along, TUNING.cannonRadius + 12, TUNING.shotSpeed, this.id)
  }

  draw(time: number): void {
    if (!this.body || !this.barrel || !this.root) return
    const threatened =
      this.captureAttacker !== null
        ? lerpColor(
            sideColor(this.side),
            sideColor(this.captureAttacker),
            (this.captureProgress / TUNING.captureThreshold) * 0.85,
          )
        : sideColor(this.side)
    const color = this.hitFlash > 0 ? lerpColor(threatened, 0xffffff, this.hitFlash * 0.55) : threatened

    this.body.clear()
    this.body.fillStyle(0x000000, 0.28)
    this.body.fillEllipse(0, 16, TUNING.cannonRadius * 1.8, 12)
    this.body.fillStyle(color, 1)
    this.body.fillCircle(0, 0, TUNING.cannonRadius)
    this.body.fillStyle(0xffffff, 0.2)
    this.body.fillCircle(-6, -7, TUNING.cannonRadius * 0.42)
    this.body.lineStyle(3, 0x000000, 0.28)
    this.body.strokeCircle(0, 0, TUNING.cannonRadius)

    if (this.captureAttacker && this.captureProgress > 0) {
      const sweep = (this.captureProgress / TUNING.captureThreshold) * Math.PI * 2
      this.body.lineStyle(4, 0x000000, 0.28)
      this.body.strokeCircle(0, 0, TUNING.cannonRadius + 7)
      this.body.lineStyle(4, sideColor(this.captureAttacker), 0.95)
      this.body.beginPath()
      this.body.arc(0, 0, TUNING.cannonRadius + 7, -Math.PI / 2, -Math.PI / 2 + sweep, false)
      this.body.strokePath()
    }

    if (this.selected || this.hovered) {
      const pulse = this.selected ? 0.55 + 0.45 * Math.sin(time / 140) : 0.45
      this.body.lineStyle(2, this.selected ? theme.select : 0xffffff, pulse)
      this.body.strokeCircle(0, 0, TUNING.cannonRadius + 12)
    }

    const angle = this.facing()
    this.barrel.clear()
    this.barrel.setRotation(angle)
    this.barrel.fillStyle(shade(color, 0.62), 1)
    this.barrel.fillRoundedRect(TUNING.cannonRadius * 0.2, -5, TUNING.cannonRadius + 8, 10, 4)
    this.barrel.fillStyle(shade(color, 0.4), 1)
    this.barrel.fillCircle(TUNING.cannonRadius + 12, 0, 5)
    if (this.muzzle > 0) {
      this.barrel.fillStyle(0xfff4d2, Math.min(1, this.muzzle / 90))
      this.barrel.fillCircle(TUNING.cannonRadius + 20, 0, 7)
    }

    this.root.setScale(this.pop)
    this.root.setDepth(this.selected ? 6 : 5)
  }

  private facing(): number {
    return this.angle
  }
}
