import type Phaser from 'phaser'
import { TUNING } from '../config/tuning'
import { lerpColor, shade, sideColor, theme } from '../config/theme'
import { aimAngle, aimShot, type Ball } from '../sim/ballistics'
import { angleDelta, turnToward } from '../sim/aim'
import { applyCaptureHit } from '../sim/capture'
import type { Point, Side } from '../types'

export interface HitOutcome {
  flipped: boolean
  /** Capture progress removed by a friendly (healing) hit. */
  healed: number
}

/** A saved aim, restored once a heal is finished. */
interface SavedAim {
  target: Cannon | null
  aimPoint: Point | null
}

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
  /** A friendly cannon this one is healing (shooting to undo enemy capture progress). */
  healing: Cannon | null = null
  private resumeAim: SavedAim | null = null
  selected = false
  hovered = false

  private readonly body?: Phaser.GameObjects.Graphics
  private readonly barrel?: Phaser.GameObjects.Graphics
  private cooldown: number
  private hitFlash = 0
  private healFlash = 0
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
    this.endHeal()
    this.target = target
    if (target) this.aimPoint = null
  }

  clearAim(): void {
    this.endHeal()
    this.target = null
    this.aimPoint = null
  }

  setAimPoint(point: Point): void {
    this.endHeal()
    this.target = null
    this.aimPoint = { x: point.x, y: point.y }
  }

  /** True while another side has capture progress on this cannon. */
  get damaged(): boolean {
    return this.captureAttacker !== null && this.captureProgress > 0
  }

  /**
   * Shoot a damaged friendly cannon to heal it. Aims straight at it, or along
   * `via` (a lane point) when a straight shot would miss. Once it is fully
   * healed this cannon goes back to whatever it was aiming at before.
   */
  startHeal(friend: Cannon, via?: Point): void {
    if (friend === this || friend.side !== this.side) return
    const resume = this.healing ? this.resumeAim : { target: this.target, aimPoint: this.aimPoint }
    if (via) this.setAimPoint(via)
    else this.setTarget(friend)
    this.healing = friend
    this.resumeAim = resume
  }

  private endHeal(): void {
    this.healing = null
    this.resumeAim = null
  }

  /** Called every frame: finish a heal once the friend is whole (or lost). */
  private checkHeal(): void {
    const friend = this.healing
    if (!friend) return
    if (friend.side !== this.side) {
      // It flipped anyway: keep shooting it, now as a capture.
      this.endHeal()
      return
    }
    if (friend.damaged) return
    const resume = this.resumeAim
    this.endHeal()
    this.target = resume?.target && resume.target !== this ? resume.target : null
    this.aimPoint = this.target ? null : (resume?.aimPoint ?? null)
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

  /**
   * A shot worth `damage` from `attacker` lands. Foes add capture progress;
   * the owner's own shots heal it off again (never past full health).
   */
  receiveHit(attacker: Side, damage = 1): HitOutcome {
    const result = applyCaptureHit(
      { side: this.side, attacker: this.captureAttacker, progress: this.captureProgress },
      attacker,
      TUNING.captureThreshold,
      damage,
    )
    const healed = attacker === this.side ? result.reduced : 0
    if (attacker === this.side && healed === 0) return { flipped: false, healed: 0 }
    this.side = result.state.side
    this.captureAttacker = result.state.attacker
    this.captureProgress = result.state.progress
    if (healed > 0) this.healFlash = 1
    else this.hitFlash = 1
    if (result.flipped) {
      this.pop = 1.24
      this.target = null
      this.aimPoint = null
      this.endHeal()
      this.cooldown = TUNING.captureKickoffMs
    }
    return { flipped: result.flipped, healed }
  }

  /**
   * Decay flashes and, unless frozen, fire when the cooldown elapses.
   * The returned ball is a new shot in world space.
   */
  update(dt: number, frozen: boolean, fireMs: number = TUNING.fireIntervalMs): Ball | null {
    this.hitFlash = Math.max(0, this.hitFlash - dt / 160)
    this.healFlash = Math.max(0, this.healFlash - dt / 420)
    this.muzzle = Math.max(0, this.muzzle - dt)
    this.pop = Math.max(1, this.pop - dt / 380)
    if (this.side === 'neutral') return null
    this.checkHeal()
    if (this.target && this.target.side === this.side && this.target !== this.healing) this.target = null

    const aim = this.aim()
    if (aim) {
      const step = ((TUNING.turnSpeedDeg * Math.PI) / 180) * (dt / 1000)
      this.angle = turnToward(this.angle, aimAngle(this, aim), step)
    }
    if (frozen || !aim) return null

    this.cooldown -= dt
    if (this.cooldown > 0) return null
    if (this.aimErrorDeg() > TUNING.aimToleranceDeg) {
      // Still turning: hold fire, stay loaded, and shoot the moment it lines up.
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

    if (this.healFlash > 0) {
      // Heal: a ring in the owner's colour swells outward and fades.
      const t = 1 - this.healFlash
      this.body.lineStyle(3, sideColor(this.side), this.healFlash * 0.9)
      this.body.strokeCircle(0, 0, TUNING.cannonRadius + 4 + t * 16)
      this.body.lineStyle(2, 0xffffff, this.healFlash * 0.5)
      this.body.strokeCircle(0, 0, TUNING.cannonRadius + 2 + t * 10)
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
