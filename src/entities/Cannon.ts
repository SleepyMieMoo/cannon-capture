import Phaser from 'phaser'
import { TUNING } from '../config/tuning'
import { lerpColor, shade, sideColor, theme } from '../config/theme'
import { aimAngle, aimShot, type Ball } from '../sim/ballistics'
import { applyCaptureHit } from '../sim/capture'
import type { Side } from '../types'

export class Cannon {
  readonly id: string
  readonly name: string
  readonly x: number
  readonly y: number
  readonly root: Phaser.GameObjects.Container
  side: Side
  target: Cannon | null = null
  captureAttacker: Side | null = null
  captureProgress = 0
  selected = false
  hovered = false

  private readonly body: Phaser.GameObjects.Graphics
  private readonly barrel: Phaser.GameObjects.Graphics
  private cooldown: number
  private hitFlash = 0
  private muzzle = 0
  private pop = 1

  constructor(
    scene: Phaser.Scene,
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
    this.body = scene.add.graphics()
    this.barrel = scene.add.graphics()
    this.root = scene.add.container(x, y, [this.body, this.barrel])
    this.root.setDepth(5)
  }

  setTarget(target: Cannon | null): void {
    if (target === this) return
    this.target = target
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
      this.cooldown = TUNING.captureKickoffMs
    }
    return result.flipped
  }

  /**
   * Decay flashes and, unless frozen, fire when the cooldown elapses.
   * The returned ball is a new shot in world space.
   */
  update(dt: number, frozen: boolean): Ball | null {
    this.hitFlash = Math.max(0, this.hitFlash - dt / 160)
    this.muzzle = Math.max(0, this.muzzle - dt)
    this.pop = Math.max(1, this.pop - dt / 380)
    if (frozen) return null
    if (this.side === 'neutral' || !this.target || this.target.side === this.side) {
      if (this.target && this.target.side === this.side) this.target = null
      return null
    }
    this.cooldown -= dt
    if (this.cooldown > 0) return null
    this.cooldown = TUNING.fireIntervalMs
    this.muzzle = 110
    return aimShot(
      this,
      this.target,
      TUNING.cannonRadius + 12,
      TUNING.shotSpeed,
      this.id,
    )
  }

  draw(time: number): void {
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
    if (this.target) return aimAngle(this, this.target)
    if (this.side === 'enemy') return Math.PI
    if (this.side === 'player') return 0
    return -Math.PI / 2
  }
}
