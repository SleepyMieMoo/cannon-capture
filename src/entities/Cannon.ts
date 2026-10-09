import type Phaser from 'phaser'
import { TUNING } from '../config/tuning'
import { lerpColor, ownerRing, shade, sideColor, theme } from '../config/theme'
import { aimAngle, aimShot, type Ball, type Barrier } from '../sim/ballistics'
import { angleDelta, turnToward } from '../sim/aim'
import { applyCaptureHit } from '../sim/capture'
import { seededRandom } from '../sim/random'
import {
  KINDS,
  damageFor,
  firesAs,
  fireMsFor,
  maxShotSpeedFor,
  shotRangeFor,
  shotSpeedFor,
  spreadDegFor,
  turnSpeedDegFor,
} from '../config/kinds'
import type { CannonKind, Point, Side } from '../types'
import type { SideSkins, SkinId } from '../config/skins'
import { drawSkinBody } from '../render/skinDraw'

/** What a shot did to a barrier. */
export interface AbsorbOutcome {
  /** It broke the barrier. */
  broke: boolean
}

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

/**
 * The ownership ring: a solid ring hugging the body, gold-white on cannons you
 * own (you can steer them), red on the enemy's, none on neutrals. It shows
 * the current owner only, so a capture tint can't mislead. Its width (world
 * px) follows the on-screen scale so it stays about `cssPx` CSS px wide on a
 * phone; the scene sets it once a frame (setRingScale). Everything drawn
 * outside it (capture track, selection halo) sits just past it.
 */
export const RING = { cssPx: 2.4, minPx: 5, maxPx: 8, width: 5 }

/** Set the ring width for this many CSS px per world px (camera zoom and screen fit). */
export function setRingScale(cssPerWorld: number): void {
  const w = RING.cssPx / Math.max(cssPerWorld, 1e-3)
  RING.width = Math.min(RING.maxPx, Math.max(RING.minPx, w))
}

/** Centre radius of the ownership ring (its dark edge runs from the body's rim outward). */
export function ownRingR(): number {
  return TUNING.cannonRadius + 1 + RING.width / 2
}

/** Radius of the capture track, just outside the ownership ring. */
export function trackR(): number {
  return TUNING.cannonRadius + RING.width + 5.5
}

/** Radius of the selection / target halo, outside the capture track. */
export function haloR(): number {
  return trackR() + 5
}

/**
 * Drawing touches a scene can ask for (Effects quality, Reduce motion): the
 * barrel eases into its turns and kicks back when it fires, the cannon
 * jitters when hit, and wobbles when nearly captured. All off by default.
 */
export interface CannonFx {
  recoil: boolean
  wobble: boolean
}

/** How far each barrel kicks back when it fires (px), and the muzzle flash time it follows. */
const RECOIL_PX: Record<CannonKind, number> = { normal: 5, sniper: 6, machinegun: 2.5, shield: 0 }

/** A cannon's drawable state, as sent to a network view (net/snapshot.ts). Cannons are named by id. */
export interface CannonNet {
  side: Side
  kind: CannonKind
  angle: number
  target: string | null
  aimPoint: Point | null
  attacker: Side | null
  progress: number
  healing: string | null
  autoTarget: boolean
  hitFlash: number
  healFlash: number
  swapTotal: number
  swapLeft: number
  muzzle: number
  shotsFired: number
  pop: number
  shieldHp: number
  shieldDown: number
  shieldFlash: number
  shieldBreakFx: number
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
  /**
   * Your per-cannon auto-target toggle (see BattleSim.autoTargets): when off,
   * this cannon never picks a target by itself. Only matters on your side.
   */
  autoTarget = true
  /** Drawn: show the "manual" badge (auto-target is off for this cannon right now). */
  manualBadge = false

  /**
   * The skins each side wears this round (shared by the round's cannons).
   * A cannon wears its current owner's, so the shape flips on capture. Null: Classic.
   */
  skins: SideSkins | null = null
  /**
   * Asked when a heal finishes (the friend is whole). Returning true means it
   * re-aimed this cannon itself (auto-target); otherwise the saved aim comes back.
   */
  healHook: { healDone(cannon: Cannon): boolean } | null = null

  /** The skin this cannon wears now: its current owner's (neutral: Classic). */
  get skin(): SkinId {
    return this.side === 'neutral' || !this.skins ? 'classic' : this.skins[this.side]
  }
  private readonly body?: Phaser.GameObjects.Graphics
  private readonly barrel?: Phaser.GameObjects.Graphics
  private cooldown: number
  /** This cannon's offset in a volley (ms), so a side's cannons don't all fire on one frame. */
  private stagger: number
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
  /**
   * Barrier state (see TUNING.shield). Kept whatever the type, so swapping
   * away and back doesn't refill a broken barrier.
   */
  shieldHp: number = TUNING.shield.hp
  /** Ms until a broken barrier comes back (0 when it isn't broken). */
  shieldDown = 0
  /** Ms since the barrier was last hit. */
  shieldCalm = Infinity
  /** Set when a broken barrier comes back; the sim reads and clears it. */
  shieldReturned = false
  private shieldFlash = 0
  private shieldBreakFx = 0
  /** The barrel's drawn direction (eases after `angle` when effects are on); NaN: not drawn yet. */
  private shown = NaN
  private lastDraw = -1

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
    this.stagger = staggerMs
    this.rng = seededRandom(id)
    this.angle = side === 'enemy' ? Math.PI : side === 'player' ? 0 : -Math.PI / 2
    if (scene) {
      this.body = scene.add.graphics()
      this.barrel = scene.add.graphics()
      this.root = scene.add.container(x, y, [this.body, this.barrel])
      this.root.setDepth(5)
    }
  }

  /**
   * A headless copy for look-ahead simulations: same side, type, barrel,
   * capture meter, reload and aim. Aims at other cannons are remapped
   * through `byId` (call linkCopy once every copy exists).
   */
  copy(): Cannon {
    const c = new Cannon(null, this.id, this.name, this.x, this.y, this.side, 0, this.kind)
    c.angle = this.angle
    c.captureAttacker = this.captureAttacker
    c.captureProgress = this.captureProgress
    c.aimPoint = this.aimPoint ? { ...this.aimPoint } : null
    c.cooldown = this.cooldown
    c.stagger = this.stagger
    c.swapTotal = this.swapTotal
    c.swapLeft = this.swapLeft
    c.sideMs = this.sideMs
    c.shotsFired = this.shotsFired
    c.shieldHp = this.shieldHp
    c.shieldDown = this.shieldDown
    c.shieldCalm = this.shieldCalm
    c.autoTarget = this.autoTarget
    return c
  }

  /** Everything a network view needs to draw this cannon as it is now (see net/snapshot.ts). */
  netState(): CannonNet {
    return {
      side: this.side,
      kind: this.kind,
      angle: this.angle,
      target: this.target?.id ?? null,
      aimPoint: this.aimPoint ? { x: this.aimPoint.x, y: this.aimPoint.y } : null,
      attacker: this.captureAttacker,
      progress: this.captureProgress,
      healing: this.healing?.id ?? null,
      autoTarget: this.autoTarget,
      hitFlash: this.hitFlash,
      healFlash: this.healFlash,
      swapTotal: this.swapTotal,
      swapLeft: this.swapLeft,
      muzzle: this.muzzle,
      shotsFired: this.shotsFired,
      pop: this.pop,
      shieldHp: this.shieldHp,
      shieldDown: this.shieldDown,
      shieldFlash: this.shieldFlash,
      shieldBreakFx: this.shieldBreakFx,
    }
  }

  /** Show a state received from the authoritative round (network views only; never stepped). */
  applyNet(s: CannonNet, byId: (id: string) => Cannon | undefined): void {
    this.side = s.side
    this.kind = s.kind
    this.angle = s.angle
    this.target = s.target ? (byId(s.target) ?? null) : null
    this.aimPoint = s.aimPoint
    this.captureAttacker = s.attacker
    this.captureProgress = s.progress
    this.healing = s.healing ? (byId(s.healing) ?? null) : null
    this.autoTarget = s.autoTarget
    this.hitFlash = s.hitFlash
    this.healFlash = s.healFlash
    this.swapTotal = s.swapTotal
    this.swapLeft = s.swapLeft
    this.muzzle = s.muzzle
    this.shotsFired = s.shotsFired
    this.pop = s.pop
    this.shieldHp = s.shieldHp
    this.shieldDown = s.shieldDown
    this.shieldFlash = s.shieldFlash
    this.shieldBreakFx = s.shieldBreakFx
  }

  /** Point a copy's cannon references (target, heal, saved aim) at the other copies. */
  linkCopy(original: Cannon, byId: (id: string) => Cannon | undefined): void {
    const map = (c: Cannon | null): Cannon | null => (c ? (byId(c.id) ?? null) : null)
    this.target = map(original.target)
    this.healing = map(original.healing)
    this.resumeAim = original.resumeAim
      ? { target: map(original.resumeAim.target), aimPoint: original.resumeAim.aimPoint ? { ...original.resumeAim.aimPoint } : null }
      : null
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

  /**
   * The countdown's Go: the fire timer starts fresh, at this cannon's volley
   * offset `stagger` (or the rest of a type swap made during the countdown).
   */
  armAtGo(stagger: number): void {
    this.stagger = stagger
    this.cooldown = Math.max(stagger, this.swapLeft)
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

  /**
   * Network views: show a tower swap made `sinceMs` ago (your own, predicted
   * before the server's picture has it), mid-reload like setKind leaves it.
   */
  showNetSwap(kind: CannonKind, sinceMs: number): void {
    if (kind === this.kind || !KINDS[kind]) return
    const lock = Math.max(TUNING.swapLockMs, fireMsFor(kind, this.sideMs))
    this.kind = kind
    this.swapTotal = lock
    this.swapLeft = Math.max(0, lock - sinceMs)
  }

  /** True while it fires shots (every type but the shield). */
  get fires(): boolean {
    return firesAs(this.kind)
  }

  /** True while its barrier is up: a manned shield, done reloading, not broken. */
  get shieldUp(): boolean {
    return this.kind === 'shield' && this.side !== 'neutral' && this.swapLeft <= 0 && this.shieldDown <= 0 && this.shieldHp > 0
  }

  /** Its barrier where it stands now (whether or not it is up). */
  barrierShape(facing: number = this.angle): Barrier {
    const s = TUNING.shield
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      r: s.reach,
      facing,
      half: (s.arcDeg * Math.PI) / 360,
      band: s.thickness / 2 + TUNING.shotRadius,
      pad: TUNING.shotRadius / s.reach,
    }
  }

  /** Its barrier, or null while it is down (or it isn't a shield). */
  barrier(): Barrier | null {
    return this.shieldUp ? this.barrierShape() : null
  }

  /** A shot worth `damage` hits the barrier. */
  absorb(damage: number): AbsorbOutcome {
    if (!this.shieldUp) return { broke: false }
    this.shieldHp = Math.max(0, this.shieldHp - damage)
    this.shieldCalm = 0
    this.shieldFlash = 1
    if (this.shieldHp > 1e-6) return { broke: false }
    this.shieldHp = 0
    this.shieldDown = TUNING.shield.downMs
    this.shieldBreakFx = 1
    return { broke: true }
  }

  /** Barrier upkeep: count down a break, regrow once it hasn't been hit for a while. */
  private tickShield(dt: number): void {
    const s = TUNING.shield
    this.shieldFlash = Math.max(0, this.shieldFlash - dt / 200)
    this.shieldBreakFx = Math.max(0, this.shieldBreakFx - dt / 650)
    if (this.shieldDown > 0) {
      this.shieldDown = Math.max(0, this.shieldDown - dt)
      if (this.shieldDown > 0) return
      this.shieldHp = s.returnHp
      this.shieldCalm = s.regenDelayMs
      this.shieldReturned = true
      return
    }
    this.shieldCalm += dt
    if (this.shieldCalm >= s.regenDelayMs && this.shieldHp < s.hp) this.shieldHp = Math.min(s.hp, this.shieldHp + (s.regenPerSec * dt) / 1000)
  }

  /** True while another side has capture progress on this cannon. */
  get damaged(): boolean {
    return this.captureAttacker !== null && this.captureProgress > 0
  }

  /**
   * Shoot a damaged friendly cannon to heal it. Aims straight at it, or along
   * `via` (a lane point) when a straight shot would miss. Once it is fully
   * healed, a cannon with auto-target on picks a fresh target (the round's
   * healHook does that); otherwise it goes back to whatever it was aiming at
   * before, or waits for orders if that's gone.
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
    if (this.healHook?.healDone(this)) return
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
    this.tickShield(dt)
    if (this.side === 'neutral') return null
    this.checkHeal()
    if (this.target && this.target.side === this.side && this.target !== this.healing) this.target = null

    const aim = this.aim()
    if (aim) {
      const step = ((turnSpeedDegFor(this.kind) * Math.PI) / 180) * (dt / 1000)
      this.angle = turnToward(this.angle, aimAngle(this, aim), step)
    }
    if (frozen || !aim || !this.fires) return null

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
    if (this.kind !== 'normal') ball.maxSpeed = maxShotSpeedFor(this.kind)
    ball.range = shotRangeFor(this.kind)
    return ball
  }

  /** Shots fired so far (a machine gun's flash alternates barrels with it). */
  get shotCount(): number {
    return this.shotsFired
  }

  /** Where the barrel is drawn pointing (it eases after `angle` with effects on). */
  get shownAngle(): number {
    return Number.isNaN(this.shown) ? this.angle : this.shown
  }

  /** Ease the drawn barrel toward the real one (a shield's barrier is never drawn off its real place). */
  private easeBarrel(time: number, fx: CannonFx | null): void {
    const dt = this.lastDraw < 0 ? 0 : Math.min(100, Math.max(0, time - this.lastDraw))
    this.lastDraw = time
    if (!fx?.recoil || Number.isNaN(this.shown) || this.kind === 'shield') {
      this.shown = this.angle
      return
    }
    const d = angleDelta(this.shown, this.angle)
    // About 30 ms behind: soft starts and stops, never visibly off where it fires.
    this.shown = Math.abs(d) < 1e-4 ? this.angle : this.shown + d * (1 - Math.exp(-dt / 30))
  }

  draw(time: number, fx: CannonFx | null = null): void {
    if (!this.body || !this.barrel || !this.root) return
    this.easeBarrel(time, fx)
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
    drawSkinBody(this.body, this.skin, color)
    if (this.kind === 'sniper') this.drawSniperBadge(this.body, color)
    else if (this.kind === 'machinegun') this.drawGunBadge(this.body, color)
    else if (this.kind === 'shield') this.drawShieldBadge(this.body, color)

    const ring = ownerRing(this.side)
    if (ring !== null) {
      // Ownership ring: the current owner only, never the tint. A dark edge on both sides keeps it apart from the body and the board.
      const rr = ownRingR()
      this.body.lineStyle(RING.width + 3, theme.ringEdge, 0.85)
      this.body.strokeCircle(0, 0, rr)
      this.body.lineStyle(RING.width, ring, 1)
      this.body.strokeCircle(0, 0, rr)
    }

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
      const tr = trackR()
      this.body.lineStyle(4, 0x000000, 0.28)
      this.body.strokeCircle(0, 0, tr)
      this.body.lineStyle(4, sideColor(this.captureAttacker), 0.95)
      this.body.beginPath()
      this.body.arc(0, 0, tr, -Math.PI / 2, -Math.PI / 2 + sweep, false)
      this.body.strokePath()
    }

    if (this.healFlash > 0) {
      // Heal: a ring in the owner's colour swells outward and fades.
      const t = 1 - this.healFlash
      const from = ownRingR() + RING.width / 2
      this.body.lineStyle(3, sideColor(this.side), this.healFlash * 0.9)
      this.body.strokeCircle(0, 0, from + 2 + t * 16)
      this.body.lineStyle(2, 0xffffff, this.healFlash * 0.5)
      this.body.strokeCircle(0, 0, from + t * 10)
    }

    if (this.manualBadge) this.drawManualBadge(this.body)

    if (this.selected || this.hovered) {
      const pulse = this.selected ? 0.55 + 0.45 * Math.sin(time / 140) : 0.45
      this.body.lineStyle(2, this.selected ? theme.select : 0xffffff, pulse)
      this.body.strokeCircle(0, 0, haloR())
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
    } else if (this.kind === 'shield') {
      // A short, wide emitter instead of a barrel, and the barrier in front of it.
      this.barrel.fillStyle(shade(color, 0.5), 1)
      this.barrel.fillRoundedRect(r * 0.35, -11, 14, 22, 5)
      this.barrel.fillStyle(shade(color, 0.32), 1)
      this.barrel.fillRoundedRect(r * 0.35 + 10, -13, 6, 26, 3)
      this.drawBarrier(this.barrel, color)
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

    // Effects: the barrel kicks back as it fires, a hit jolts the cannon, and one nearly captured wobbles.
    let kick = 0
    if (fx?.recoil && this.muzzle > 0) {
      const k = this.muzzle / (this.kind === 'machinegun' ? 70 : 110)
      kick = RECOIL_PX[this.kind] * k * k
    }
    this.barrel.setPosition(-Math.cos(angle) * kick, -Math.sin(angle) * kick)
    const jolt = fx?.recoil ? this.hitFlash * 1.8 : 0
    this.root.setPosition(this.x + (jolt ? Math.sin(time * 0.13 + this.x) * jolt : 0), this.y + (jolt ? Math.cos(time * 0.17 + this.y) * jolt : 0))
    const danger = fx?.wobble && this.captureAttacker && this.captureAttacker !== this.side ? this.captureProgress / TUNING.captureThreshold : 0
    this.body.setRotation(danger > 0.6 ? Math.sin(time / 85) * 0.05 * ((danger - 0.6) / 0.4) : 0)
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

  /**
   * Auto-target off: a small badge at the cannon's top left, a crosshair
   * with a slash through it ("picks no targets by itself").
   */
  private drawManualBadge(g: Phaser.GameObjects.Graphics): void {
    const r = TUNING.cannonRadius
    const x = -r * 0.78
    const y = -r * 0.78
    g.fillStyle(theme.hud, 0.95)
    g.fillCircle(x, y, 9)
    g.lineStyle(1.5, sideColor(this.side), 1)
    g.strokeCircle(x, y, 9)
    g.lineStyle(1.5, 0xfff4d2, 0.95)
    g.strokeCircle(x, y, 4)
    g.lineBetween(x - 7, y, x - 5, y)
    g.lineBetween(x + 5, y, x + 7, y)
    g.lineBetween(x, y - 7, x, y - 5)
    g.lineBetween(x, y + 5, x, y + 7)
    g.lineStyle(2, theme.enemy, 1)
    g.lineBetween(x - 5.5, y + 5.5, x + 5.5, y - 5.5)
  }

  /** Shield marking on the body: a little crest, plus the barrier's health bar under the cannon. */
  private drawShieldBadge(g: Phaser.GameObjects.Graphics, color: number): void {
    const ink = shade(color, 0.35)
    g.fillStyle(ink, 0.85)
    g.beginPath()
    g.moveTo(-8, -9)
    g.lineTo(8, -9)
    g.lineTo(8, 1)
    g.lineTo(0, 10)
    g.lineTo(-8, 1)
    g.closePath()
    g.fillPath()
    g.fillStyle(color, 0.9)
    g.fillRect(-1.5, -6, 3, 11)
    if (this.side === 'neutral') return
    // Health bar under the cannon: the barrier's hp in the team colour (one notch per hp), or a
    // pale refill while it is down. Dark-edged like the rings, and it grows with them when zoomed out.
    const s = TUNING.shield
    const k = RING.width / 5
    const w = 46 * k
    const h = 6 * k
    const y = trackR() + 5 * k
    const team = this.shieldFlash > 0 ? lerpColor(sideColor(this.side), 0xffffff, this.shieldFlash * 0.6) : sideColor(this.side)
    const fill = this.shieldDown > 0 ? 1 - this.shieldDown / s.downMs : this.shieldHp / s.hp
    hpBar(g, -w / 2, y, w, h, fill, this.shieldDown > 0 ? 0xfff4d2 : team, this.shieldDown > 0 ? 0.6 : 1, this.shieldDown > 0 ? 0 : s.hp)
  }

  /**
   * The barrier, drawn in barrel space (0 rad = facing). Up: thicker and
   * more solid the more hp it has. Down: a faint outline that refills. While
   * reloading into a shield it fades in; a neutral (unmanned) one is dashed.
   */
  private drawBarrier(g: Phaser.GameObjects.Graphics, color: number): void {
    const s = TUNING.shield
    const R = s.reach
    const half = (s.arcDeg * Math.PI) / 360
    const team = this.side === 'neutral' ? color : sideColor(this.side)
    const arc = (width: number, c: number, alpha: number, from = -half, to = half) => {
      if (alpha <= 0 || to <= from) return
      g.lineStyle(width, c, alpha)
      g.beginPath()
      g.arc(0, 0, R, from, to, false)
      g.strokePath()
    }
    const dashed = (width: number, c: number, alpha: number) => {
      const n = 9
      for (let i = 0; i < n; i++) {
        const a = -half + ((2 * half) / n) * i
        arc(width, c, alpha, a, a + ((2 * half) / n) * 0.55)
      }
    }
    if (this.shieldBreakFx > 0) {
      // Break: shards fly outward and fade.
      const t = 1 - this.shieldBreakFx
      for (let i = 0; i < 7; i++) {
        const a = -half + ((2 * half) / 6) * i + Math.sin(i * 2.3) * 0.08
        const d = R + t * (18 + (i % 3) * 8)
        g.fillStyle(i % 2 ? 0xffffff : team, this.shieldBreakFx * 0.9)
        g.fillTriangle(
          Math.cos(a) * d,
          Math.sin(a) * d,
          Math.cos(a + 0.09) * (d + 6),
          Math.sin(a + 0.09) * (d + 6),
          Math.cos(a - 0.06) * (d + 4),
          Math.sin(a - 0.06) * (d + 4),
        )
      }
    }
    if (this.side === 'neutral') return dashed(3, team, 0.35)
    const t = s.thickness
    // Which way it faces: a faint chevron just outside the middle of the arc, in the team colour,
    // like the aim line: stronger while you hover or select the cannon.
    const k = RING.width / 5
    const cue = this.selected ? 0.8 : this.hovered ? 0.65 : 0.3
    const cx = R + t / 2 + 8 * k
    g.lineStyle(2.5 * k, theme.ringEdge, cue * 0.6)
    g.beginPath()
    g.moveTo(cx, -6 * k)
    g.lineTo(cx + 6 * k, 0)
    g.lineTo(cx, 6 * k)
    g.strokePath()
    g.lineStyle(1.6 * k, team, cue)
    g.strokePath()
    if (this.swapLeft > 0) {
      const p = this.swapTotal > 0 ? 1 - this.swapLeft / this.swapTotal : 0
      return arc(t * (0.35 + 0.65 * p), team, 0.2 + 0.35 * p)
    }
    if (this.shieldDown > 0) {
      // Down: a dashed band where it will stand, refilling from one end.
      const back = 1 - this.shieldDown / s.downMs
      arc(t + 2, theme.ringEdge, 0.35)
      dashed(t - 2, team, 0.3)
      arc(t - 4, 0xfff4d2, 0.55, -half, -half + 2 * half * back)
      this.barrierBar(g, R + t / 2 + 3.5, half, back, 0xfff4d2, 0.6, 0)
      return
    }
    // Up: the full band it blocks shots with, dark-edged so it reads on any board. It looks
    // solid at any hp; the small bar along it shows how much it has left.
    const f = Math.max(0, Math.min(1, this.shieldHp / s.hp))
    const c = this.shieldFlash > 0 ? lerpColor(team, 0xffffff, this.shieldFlash * 0.7) : team
    arc(t + 3, theme.ringEdge, 0.7)
    arc(t, c, 0.55 + 0.4 * f)
    arc(1.5, 0xffffff, 0.3 + 0.4 * f, -half * 0.85, half * 0.85)
    this.barrierBar(g, R + t / 2 + 3.5, half, f, c, 1, s.hp)
  }

  /** The barrier's own tiny hp bar: a thin curved bar along the outside of its middle. */
  private barrierBar(g: Phaser.GameObjects.Graphics, radius: number, half: number, fill: number, color: number, alpha: number, notches: number): void {
    const span = half * 0.55
    g.lineStyle(4.5, theme.ringEdge, 0.85)
    g.beginPath()
    g.arc(0, 0, radius, -span, span, false)
    g.strokePath()
    const f = Math.max(0, Math.min(1, fill))
    if (f > 0) {
      g.lineStyle(2.5, color, alpha)
      g.beginPath()
      g.arc(0, 0, radius, -span, -span + 2 * span * f, false)
      g.strokePath()
    }
    g.lineStyle(1, theme.ringEdge, 0.9)
    for (let i = 1; i < notches; i++) {
      const a = -span + (2 * span * i) / notches
      g.lineBetween(Math.cos(a) * (radius - 2), Math.sin(a) * (radius - 2), Math.cos(a) * (radius + 2), Math.sin(a) * (radius + 2))
    }
  }

  /** Machine gun marking on the body: three short ammo-belt bars. */
  private drawGunBadge(g: Phaser.GameObjects.Graphics, color: number): void {
    const r = TUNING.cannonRadius
    g.fillStyle(shade(color, 0.35), 0.85)
    for (let i = -1; i <= 1; i++) g.fillRoundedRect(i * 8 - 2.5, r * 0.28, 5, 9, 1.5)
  }

  private facing(): number {
    return this.shownAngle
  }
}

/** A small health bar (dark edge, fill from the left, a notch per point when `notches` > 1). */
function hpBar(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, fill: number, color: number, alpha: number, notches: number): void {
  const f = Math.max(0, Math.min(1, fill))
  g.fillStyle(theme.ringEdge, 0.9)
  g.fillRoundedRect(x - 1.5, y - 1.5, w + 3, h + 3, (h + 3) / 2)
  g.fillStyle(0x000000, 0.35)
  g.fillRoundedRect(x, y, w, h, h / 2)
  if (f > 0) {
    g.fillStyle(color, alpha)
    g.fillRoundedRect(x, y, Math.max(h, w * f), h, h / 2)
  }
  g.fillStyle(theme.ringEdge, 0.9)
  for (let i = 1; i < notches; i++) g.fillRect(x + (w * i) / notches - 0.6, y, 1.2, h)
}
