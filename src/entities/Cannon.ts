import type Phaser from 'phaser'
import { TUNING } from '../config/tuning'
import { lerpColor, shade, sideColor, theme } from '../config/theme'
import { aimAngle, aimShot, type Ball } from '../sim/ballistics'
import { angleDelta, turnToward } from '../sim/aim'
import { applyCaptureHit } from '../sim/capture'
import {
  KINDS,
  damageFor,
  fireMsFor,
  maxShotSpeedFor,
  shotLifetimeFor,
  shotSpeedFor,
  spreadDegFor,
  turnSpeedDegFor,
} from '../config/kinds'
import type { CannonKind, Point, Side } from '../types'

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
  /** Tower type. Kept when the cannon is captured. */
  kind: CannonKind
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
  /** Swap reload: ms total and ms left, for the reload ring. */
  private swapTotal = 0
  private swapLeft = 0
  /** The side's normal fire interval, as last seen in update(). */
  private sideMs: number = TUNING.fireIntervalMs
  private muzzle = 0
  /** Shots fired so far (machine guns alternate barrels). */
  private shotsFired = 0
  private pop = 1
  /** Seeded per cannon, so spread is random-looking but every run replays the same. */
  private readonly rng: () => number

  constructor(
    scene: Phaser.Scene | null,
    id: string,
    name: string,
    x: number,
    y: number,
    side: Side,
    staggerMs: number,
    kind: CannonKind = 'normal',
  ) {
    this.id = id
    this.name = name
    this.x = x
    this.y = y
    this.side = side
    this.kind = KINDS[kind] ? kind : 'normal'
    this.cooldown = staggerMs
    this.rng = seededRandom(id)
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

  /** Capture progress each of its shots adds (or heals). */
  get damage(): number {
    return damageFor(this.kind)
  }

  /** Milliseconds between its shots. */
  fireMs(sideMs: number = this.sideMs): number {
    return fireMsFor(this.kind, sideMs)
  }

  /** Milliseconds between shots if it were fitted as `kind` (same side rate). */
  fireMsAs(kind: CannonKind): number {
    return fireMsFor(kind, this.sideMs)
  }

  /** Still reloading after a type swap. */
  get swapping(): boolean {
    return this.swapLeft > 0
  }

  /**
   * Change tower type mid-round. The cannon then reloads for its new type's
   * full fire interval (at least TUNING.swapLockMs) before it shoots again.
   * Returns false if nothing would change.
   */
  setKind(kind: CannonKind): boolean {
    if (kind === this.kind || !KINDS[kind]) return false
    this.kind = kind
    const lock = Math.max(TUNING.swapLockMs, this.fireMs())
    this.cooldown = lock
    this.swapTotal = lock
    this.swapLeft = lock
    this.pop = Math.max(this.pop, 1.12)
    return true
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
    this.swapLeft = Math.max(0, this.swapLeft - dt)
    this.sideMs = fireMs
    this.muzzle = Math.max(0, this.muzzle - dt)
    this.pop = Math.max(1, this.pop - dt / 380)
    if (this.side === 'neutral') return null
    this.checkHeal()
    if (this.target && this.target.side === this.side && this.target !== this.healing) this.target = null

    const aim = this.aim()
    if (aim) {
      const step = ((turnSpeedDegFor(this.kind) * Math.PI) / 180) * (dt / 1000)
      this.angle = turnToward(this.angle, aimAngle(this, aim), step)
    }
    if (frozen || !aim) return null

    this.cooldown -= dt
    if (this.cooldown > 1e-6) return null
    if (this.aimErrorDeg() > TUNING.aimToleranceDeg) {
      // Still turning: hold fire, stay loaded, and shoot the moment it lines up.
      this.cooldown = 0
      return null
    }
    // Carry the overshoot (up to a frame) so the rate holds at any frame rate:
    // a 0.2 s gun at 60 fps fires every 12 or 13 frames, 5 shots a second.
    this.cooldown = this.fireMs(fireMs) + Math.max(this.cooldown, -dt)
    this.muzzle = this.kind === 'machinegun' ? 70 : 110
    this.shotsFired += 1
    // Fire along the barrel's current direction, not straight at the aim,
    // give or take this type's spread.
    const spread = spreadDegFor(this.kind)
    const dir = this.angle + (spread > 0 ? ((this.rng() * 2 - 1) * spread * Math.PI) / 180 : 0)
    const along = { x: this.x + Math.cos(dir) * 100, y: this.y + Math.sin(dir) * 100 }
    const ball = aimShot(this, along, TUNING.cannonRadius + 12, shotSpeedFor(this.kind), this.id)
    if (this.kind !== 'normal') {
      ball.maxSpeed = maxShotSpeedFor(this.kind)
      ball.lifeMs = shotLifetimeFor(this.kind)
    }
    return ball
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
    if (this.kind === 'sniper') this.drawSniperBadge(this.body, color)
    else if (this.kind === 'machinegun') this.drawGunBadge(this.body, color)

    if (this.swapLeft > 0 && this.swapTotal > 0) {
      // Swap reload: a light ring fills up until it can fire again.
      const done = 1 - this.swapLeft / this.swapTotal
      this.body.lineStyle(3, 0xffffff, 0.22)
      this.body.strokeCircle(0, 0, TUNING.cannonRadius - 4)
      this.body.lineStyle(3, 0xfff4d2, 0.9)
      this.body.beginPath()
      this.body.arc(0, 0, TUNING.cannonRadius - 4, -Math.PI / 2, -Math.PI / 2 + done * Math.PI * 2, false)
      this.body.strokePath()
    }

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
    const r = TUNING.cannonRadius
    if (this.kind === 'sniper') {
      // Long, thin barrel with a scope on top: reads as a sniper even zoomed out.
      this.barrel.fillStyle(shade(color, 0.55), 1)
      this.barrel.fillRoundedRect(r * 0.2, -3.5, r + 26, 7, 3)
      this.barrel.fillStyle(shade(color, 0.38), 1)
      this.barrel.fillRect(r + 22, -5, 6, 10)
      this.barrel.fillStyle(shade(color, 0.3), 1)
      this.barrel.fillRoundedRect(r * 0.35, -10, 16, 6, 3)
      this.barrel.fillStyle(0xfff4d2, 0.9)
      this.barrel.fillCircle(r * 0.35 + 13, -7, 2)
      if (this.muzzle > 0) {
        this.barrel.fillStyle(0xfff4d2, Math.min(1, this.muzzle / 90))
        this.barrel.fillCircle(r + 34, 0, 6)
      }
    } else if (this.kind === 'machinegun') {
      // Twin short, chunky barrels on a squat housing; the flash alternates.
      this.barrel.fillStyle(shade(color, 0.42), 1)
      this.barrel.fillRoundedRect(r * 0.1, -10, 18, 20, 4)
      this.barrel.fillStyle(shade(color, 0.6), 1)
      const len = r + 4
      this.barrel.fillRoundedRect(r * 0.3, -9, len, 7, 2.5)
      this.barrel.fillRoundedRect(r * 0.3, 2, len, 7, 2.5)
      this.barrel.fillStyle(shade(color, 0.32), 1)
      this.barrel.fillRect(r * 0.3 + len - 5, -10, 5, 9)
      this.barrel.fillRect(r * 0.3 + len - 5, 1, 5, 9)
      if (this.muzzle > 0) {
        this.barrel.fillStyle(0xfff4d2, Math.min(1, this.muzzle / 60))
        this.barrel.fillCircle(r * 0.3 + len + 4, this.shotsFired % 2 ? -5.5 : 5.5, 4.5)
      }
    } else {
      this.barrel.fillStyle(shade(color, 0.62), 1)
      this.barrel.fillRoundedRect(r * 0.2, -5, r + 8, 10, 4)
      this.barrel.fillStyle(shade(color, 0.4), 1)
      this.barrel.fillCircle(r + 12, 0, 5)
      if (this.muzzle > 0) {
        this.barrel.fillStyle(0xfff4d2, Math.min(1, this.muzzle / 90))
        this.barrel.fillCircle(r + 20, 0, 7)
      }
    }

    this.root.setScale(this.pop)
    this.root.setDepth(this.selected ? 6 : 5)
  }

  /** Sniper marking on the body: a reticle, plus one pip per point of damage. */
  private drawSniperBadge(g: Phaser.GameObjects.Graphics, color: number): void {
    const r = TUNING.cannonRadius
    const ink = shade(color, 0.35)
    g.lineStyle(2.5, ink, 0.85)
    g.strokeCircle(0, 0, r * 0.5)
    g.lineBetween(-r * 0.78, 0, -r * 0.28, 0)
    g.lineBetween(r * 0.28, 0, r * 0.78, 0)
    g.lineBetween(0, -r * 0.78, 0, -r * 0.28)
    g.lineBetween(0, r * 0.28, 0, r * 0.78)
    g.fillStyle(ink, 0.95)
    const pips = Math.max(1, Math.round(this.damage))
    for (let i = 0; i < pips; i++) g.fillCircle((i - (pips - 1) / 2) * 7, r * 0.5 + 9, 2.2)
  }

  /** Machine gun marking on the body: three short ammo-belt bars. */
  private drawGunBadge(g: Phaser.GameObjects.Graphics, color: number): void {
    const r = TUNING.cannonRadius
    g.fillStyle(shade(color, 0.35), 0.85)
    for (let i = -1; i <= 1; i++) g.fillRoundedRect(i * 8 - 2.5, r * 0.28, 5, 9, 1.5)
  }

  private facing(): number {
    return this.angle
  }
}

/** Small seeded PRNG (mulberry32) keyed on a string. */
function seededRandom(key: string): () => number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
