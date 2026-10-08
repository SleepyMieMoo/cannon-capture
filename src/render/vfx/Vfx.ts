import Phaser from 'phaser'
import { TUNING } from '../../config/tuning'
import { lerpColor, sideColor, theme } from '../../config/theme'
import type { Cannon, CannonFx } from '../../entities/Cannon'
import type { Shot } from '../../entities/Shot'
import type { Fan } from '../../entities/Fan'
import { BRICK, GLASS, GLASS_RIM, VOID_COLOURS } from '../../config/obstacles'
import type { Surface } from '../../sim/ballistics'
import type { CannonKind, Rect, Side, WallDef } from '../../types'
import { FADE_INOUT, FADE_LATE, ParticlePool, type Spawn } from './particlePool'
import { FX_TEX, FX_TEX_W, HALO_TEX, HALO_W, SWEEP_TEX, SWEEP_W, TEX, TRAIL_H, TRAIL_TEX, TRAIL_W, bakeFxTextures } from './fxTextures'
import type { FxConfig } from './fxQuality'

/** Depths: auras under everything on the board's surface, shot trails under the shots, particles over the cannons. */
const DEPTH = { aura: 1.6, trail: 2.9, smoke: 6.4, glow: 6.5, sweep: 4 }
/** The most particles either layer could ever hold (High); Low and Off just use fewer. */
const CAPACITY = 360
const R = TUNING.cannonRadius
/** Aura size (diameter, px) and strength. */
const AURA = { size: R * 2 * 2.5, alpha: 0.5, breathe: 0.1, neutral: 0.12, flipMs: 520 }
const WARM = 0xfff4d2
const SMOKE = 0x8c7b6b
const VOID_PUFF = VOID_COLOURS.puff
const VOID_SPARK = VOID_COLOURS.spark

/** One image per particle slot, made the first time the slot is used and reused ever after. */
class Layer {
  readonly pool: ParticlePool
  private readonly images: (Phaser.GameObjects.Image | null)[]
  private readonly shown: Uint8Array
  private readonly texShown: Uint8Array

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly blend: number,
    private readonly depth: number,
    private readonly register: (o: Phaser.GameObjects.GameObject) => void,
  ) {
    this.pool = new ParticlePool(CAPACITY)
    this.images = new Array(CAPACITY).fill(null)
    this.shown = new Uint8Array(CAPACITY)
    this.texShown = new Uint8Array(CAPACITY).fill(255)
  }

  draw(): void {
    const p = this.pool
    for (let i = 0; i < p.capacity; i++) {
      if (!p.alive[i]) {
        if (this.shown[i]) {
          this.images[i]!.setVisible(false)
          this.shown[i] = 0
        }
        continue
      }
      let img = this.images[i]
      if (!img) {
        img = this.scene.add.image(0, 0, FX_TEX[p.tex[i]]).setBlendMode(this.blend).setDepth(this.depth)
        this.register(img)
        this.images[i] = img
        this.texShown[i] = p.tex[i]
      } else if (this.texShown[i] !== p.tex[i]) {
        img.setTexture(FX_TEX[p.tex[i]])
        this.texShown[i] = p.tex[i]
      }
      const scale = p.size(i) / FX_TEX_W[p.tex[i]]
      const stretch = p.stretch[i]
      if (stretch > 0) img.setRotation(Math.atan2(p.vy[i], p.vx[i])).setScale(scale * stretch, scale)
      else img.setRotation(p.rot[i]).setScale(scale)
      img.setPosition(p.x[i], p.y[i]).setAlpha(p.opacity(i)).setTint(p.tint[i])
      if (!this.shown[i]) {
        img.setVisible(true)
        this.shown[i] = 1
      }
    }
  }

  destroy(): void {
    for (const img of this.images) img?.destroy()
  }
}

/** Per cannon: its aura (and halo), the colour it shows and a flip in progress. */
interface Aura {
  glow: Phaser.GameObjects.Image | null
  halo: Phaser.GameObjects.Image | null
  side: Side
  colour: number
  from: number
  to: number
  /** ms into a flip's cross-fade (≥ flipMs: none running). */
  flip: number
  phase: number
  /** ms until it may sputter sparks again (nearly captured), or puff a heal. */
  sputter: number
  heal: number
}

export interface VfxOptions {
  /** Puts a new display object on the right camera (the battle's world camera). */
  register?: (o: Phaser.GameObjects.GameObject) => void
  /** The board, for the Go ring and the end-of-round sweep. */
  board: Rect
  /** Which edge each side starts from (the sweep runs from the winner's). */
  edges?: Record<'player' | 'enemy', 'left' | 'right' | null>
  /** What's on screen now (bursts off screen are skipped); null: everything. */
  view?: () => Rect | null
}

/**
 * The battle's gameplay effects, all client side and all pooled: team
 * colour auras, muzzle flashes and smoke, shot glows and trails, impact and
 * bank sparks, barrier shimmers and debris, capture bursts, heal sparkles,
 * fan air, the Go ring, the end-of-round sweep and small camera shakes.
 * Fed by the round's events (or a network view's replay of them), so a
 * hidden tab or a catch-up, which play no events, never bursts on return.
 * Nothing is allocated per shot or per frame once the pools have grown.
 */
export class Vfx {
  cfg: FxConfig
  private readonly glows: Layer
  private readonly smoke: Layer
  private readonly auras: Aura[] = []
  private readonly byCannon = new Map<Cannon, number>()
  private readonly trails: Phaser.GameObjects.Image[] = []
  private readonly heads: Phaser.GameObjects.Image[] = []
  private trailsShown = 0
  private headsShown = 0
  private readonly fanAcc: Float32Array
  private sweep: Phaser.GameObjects.Image | null = null
  private sweepT = -1
  private sweepFrom: 'left' | 'right' = 'left'
  private sweepColour = 0xffffff
  private lastShake = -Infinity
  private now = 0
  /** What's on screen, read once a frame (bursts between frames use the last one). */
  private view0x = -Infinity
  private view0y = -Infinity
  private view1x = Infinity
  private view1y = Infinity
  private readonly register: (o: Phaser.GameObjects.GameObject) => void
  private seed = 1
  /** For the drawn cannons (recoil, jolts, wobble). */
  readonly cannonFx: CannonFx = { recoil: false, wobble: false }
  private readonly spawnArgs: Spawn = { x: 0, y: 0, lifeMs: 1, size0: 1, alpha: 1, tint: 0xffffff, tex: 0 }

  constructor(
    private readonly scene: Phaser.Scene,
    cannons: readonly Cannon[],
    fans: readonly Fan[],
    cfg: FxConfig,
    private readonly opts: VfxOptions,
  ) {
    bakeFxTextures(scene.textures)
    this.register = opts.register ?? (() => {})
    this.glows = new Layer(scene, Phaser.BlendModes.ADD, DEPTH.glow, this.register)
    this.smoke = new Layer(scene, Phaser.BlendModes.NORMAL, DEPTH.smoke, this.register)
    cannons.forEach((c, i) => {
      this.byCannon.set(c, i)
      this.auras.push({ glow: null, halo: null, side: c.side, colour: this.auraColour(c.side), from: 0, to: 0, flip: AURA.flipMs, phase: i * 1.7, sputter: 0, heal: 0 })
    })
    this.fanAcc = new Float32Array(fans.length)
    this.cfg = cfg
    this.setConfig(cfg)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy())
  }

  setConfig(cfg: FxConfig): void {
    this.cfg = cfg
    this.glows.pool.setLimits(cfg.particles, cfg.perFrame)
    this.smoke.pool.setLimits(cfg.smoke ? Math.round(cfg.particles / 3) : Math.round(cfg.particles / 6), Math.round(cfg.perFrame / 2))
    this.cannonFx.recoil = cfg.recoil
    this.cannonFx.wobble = cfg.wobble
    if (cfg.quality === 'off') {
      this.glows.pool.clear()
      this.smoke.pool.clear()
      this.glows.draw()
      this.smoke.draw()
      this.sweepT = -1
      this.sweep?.setVisible(false)
    }
    for (const a of this.auras) {
      a.glow?.setVisible(false)
      a.halo?.setVisible(false)
    }
    this.hideShots(0, 0)
  }

  /** Live particles (the perf overlay). */
  get particles(): number {
    return this.glows.pool.count + this.smoke.pool.count
  }

  // ------------------------------------------------------------------ events

  /** A cannon fired: muzzle flash, a puff of smoke. */
  fired(c: Cannon): void {
    if (!this.cfg.particles || !this.onScreen(c.x, c.y, 60)) return
    const a = c.shownAngle
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const kind = c.kind
    let reach = R + 20
    let side = 0
    if (kind === 'sniper') reach = R + 34
    else if (kind === 'machinegun') {
      reach = R * 1.3 + 8
      side = c.shotCount % 2 ? -5.5 : 5.5
    }
    const x = c.x + cos * reach - sin * side
    const y = c.y + sin * reach + cos * side
    const team = sideColor(c.side)
    const mg = kind === 'machinegun'
    this.glow(x, y, mg ? 16 : 24, mg ? 26 : 36, 0.95, WARM, mg ? 60 : 95)
    this.glow(x, y, mg ? 26 : 40, mg ? 34 : 54, 0.45, team, mg ? 80 : 130)
    if (kind === 'sniper') this.add(this.glows, { x: x + cos * 10, y: y + sin * 10, vx: cos * 60, vy: sin * 60, lifeMs: 130, size0: 26, size1: 34, alpha: 0.85, tint: WARM, tex: TEX.spark, stretch: 2.2 })
    if (this.cfg.smoke && (!mg || this.rand() < 0.25)) {
      const n = kind === 'sniper' ? 1 : mg ? 1 : 2
      for (let i = 0; i < n; i++) {
        const sp = 30 + this.rand() * 30
        const spread = (this.rand() - 0.5) * 0.8
        this.add(this.smoke, {
          x, y,
          vx: Math.cos(a + spread) * sp, vy: Math.sin(a + spread) * sp - 6,
          drag: 0.25, lifeMs: 520 + this.rand() * 260,
          size0: mg ? 10 : 14, size1: mg ? 22 : 32,
          alpha: 0.32, tint: SMOKE, tex: TEX.smoke,
          rot: this.rand() * 6.28, spin: (this.rand() - 0.5) * 1.5,
        })
      }
    }
  }

  /** A shot banked off a wall, a pillar or a pane of glass. */
  bounce(x: number, y: number, surface: Surface = 'wall'): void {
    if (!this.cfg.particles || !this.onScreen(x, y, 30)) return
    if (surface === 'glass') {
      this.glow(x, y, 8, 16, 0.7, GLASS_RIM, 110)
      this.sparks(x, y, this.count(2), GLASS, 90, 160, 12)
      return
    }
    this.glow(x, y, 10, 20, 0.6, WARM, 90)
    this.sparks(x, y, this.count(3), theme.spark, 120, 200, 16)
  }

  /** A void wall swallowed a shot: a small dark puff and a violet spark. */
  absorbed(x: number, y: number): void {
    if (!this.cfg.particles || !this.onScreen(x, y, 30)) return
    this.add(this.smoke, { x, y, lifeMs: 420, size0: 10, size1: 26, alpha: 0.5, tint: VOID_PUFF, tex: TEX.smoke })
    this.glow(x, y, 8, 14, 0.6, VOID_SPARK, 160)
    this.sparks(x, y, this.count(2), VOID_SPARK, 60, 120, 10)
  }

  /** A shot wore down a breakable wall: a puff of brick dust and a chip or two. */
  wallHit(x: number, y: number): void {
    if (!this.cfg.particles || !this.onScreen(x, y, 30)) return
    this.add(this.smoke, { x, y, lifeMs: 380, size0: 8, size1: 20, alpha: 0.4, tint: BRICK.dust, tex: TEX.smoke })
    const n = this.count(2)
    for (let i = 0; i < n; i++) {
      const a = this.rand() * 6.28
      const sp = 50 + this.rand() * 70
      this.add(this.smoke, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.08, gravity: 60,
        lifeMs: 380 + this.rand() * 200, size0: 4 + this.rand() * 3, alpha: 0.95,
        tint: i % 2 ? BRICK.light : BRICK.base, tex: TEX.chip, rot: this.rand() * 6.28, spin: (this.rand() - 0.5) * 12, fade: FADE_LATE,
      })
    }
  }

  /** A breakable wall broke for good: bricks tumble off along its length in a cloud of dust. */
  wallBroken(wall: WallDef): void {
    const cx = wall.x + wall.w / 2
    const cy = wall.y + wall.h / 2
    const len = Math.max(wall.w, wall.h)
    if (!this.cfg.particles || !this.onScreen(cx, cy, len / 2 + 60)) return
    const turn = wall.angle ?? 0
    // The long axis in world space.
    const ux = wall.w >= wall.h ? Math.cos(turn) : -Math.sin(turn)
    const uy = wall.w >= wall.h ? Math.sin(turn) : Math.cos(turn)
    const n = this.count(Math.min(26, 8 + Math.round(len / 10)))
    for (let i = 0; i < n; i++) {
      const t = (this.rand() - 0.5) * len
      const x = cx + ux * t
      const y = cy + uy * t
      const a = this.rand() * 6.28
      const sp = 60 + this.rand() * 130
      this.add(this.smoke, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.07, gravity: 80,
        lifeMs: 600 + this.rand() * 450, size0: 6 + this.rand() * 6, alpha: 1,
        tint: i % 4 === 0 ? BRICK.light : i % 3 === 0 ? BRICK.dark : BRICK.base, tex: TEX.chip, rot: this.rand() * 6.28, spin: (this.rand() - 0.5) * 14, fade: FADE_LATE,
      })
    }
    const puffs = this.count(Math.min(8, 2 + Math.round(len / 40)))
    for (let i = 0; i < puffs; i++) {
      const t = ((i + 0.5) / puffs - 0.5) * len
      this.add(this.smoke, { x: cx + ux * t, y: cy + uy * t, vx: (this.rand() - 0.5) * 30, vy: (this.rand() - 0.5) * 30, lifeMs: 700 + this.rand() * 300, size0: 18, size1: 46, alpha: 0.5, tint: BRICK.dust, tex: TEX.smoke })
    }
    if (this.cfg.rings) this.ring(cx, cy, 10, Math.min(140, len * 0.7), 0.35, BRICK.dust, 360)
    this.shake(0.0014, 100)
  }

  /** A shot struck a cannon. */
  hit(x: number, y: number, side: Side, kind: CannonKind): void {
    if (!this.cfg.particles || !this.onScreen(x, y, 40)) return
    const mg = kind === 'machinegun'
    const team = sideColor(side)
    this.glow(x, y, mg ? 14 : 22, mg ? 26 : 42, 0.8, team, mg ? 110 : 160)
    this.glow(x, y, mg ? 6 : 10, mg ? 10 : 16, 0.9, 0xffffff, 80)
    this.sparks(x, y, this.count(mg ? 2 : kind === 'sniper' ? 6 : 4), team, 150, 260, mg ? 12 : 18)
  }

  /** A barrier stopped a shot: a shimmer along the arc where it struck. */
  blocked(x: number, y: number, shield: Cannon, kind: CannonKind): void {
    if (!this.cfg.particles || !this.onScreen(x, y, 60)) return
    const team = sideColor(shield.side)
    const mg = kind === 'machinegun'
    this.glow(x, y, mg ? 16 : 26, mg ? 30 : 46, 0.75, team, 170)
    const at = Math.atan2(y - shield.y, x - shield.x)
    const reach = TUNING.shield.reach
    const n = this.count(mg ? 2 : 4)
    for (let i = 0; i < n; i++) {
      const off = (i % 2 ? 1 : -1) * (0.1 + 0.11 * (i >> 1))
      this.add(this.glows, { x: shield.x + Math.cos(at + off) * reach, y: shield.y + Math.sin(at + off) * reach, lifeMs: 200 + i * 40, size0: 12, size1: 6, alpha: 0.7, tint: lerpColor(team, 0xffffff, 0.45), tex: TEX.glow })
    }
    this.sparks(x, y, this.count(mg ? 1 : 2), 0xffffff, 120, 180, 12)
  }

  /** A barrier broke: debris chips fly off it. */
  shieldBroken(shield: Cannon): void {
    if (!this.cfg.particles || !this.onScreen(shield.x, shield.y, 120)) return
    const team = sideColor(shield.side)
    const half = (TUNING.shield.arcDeg * Math.PI) / 360
    const reach = TUNING.shield.reach
    const n = this.count(12)
    for (let i = 0; i < n; i++) {
      const a = shield.angle + (this.rand() * 2 - 1) * half
      const sp = 90 + this.rand() * 120
      this.add(this.smoke, {
        x: shield.x + Math.cos(a) * reach, y: shield.y + Math.sin(a) * reach,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.06, gravity: 70,
        lifeMs: 650 + this.rand() * 350, size0: 7 + this.rand() * 5, alpha: 0.95,
        tint: i % 3 === 0 ? 0xffffff : team, tex: TEX.chip, rot: this.rand() * 6.28, spin: (this.rand() - 0.5) * 14, fade: FADE_LATE,
      })
    }
    if (this.cfg.rings) this.ring(shield.x + Math.cos(shield.angle) * reach * 0.6, shield.y + Math.sin(shield.angle) * reach * 0.6, 20, 120, 0.55, team, 380)
    this.shake(shield.side === 'player' ? 0.0015 : 0.001, 90)
  }

  /** A cannon changed hands: a shockwave and a burst in its new colour (the aura swells into it). */
  captured(c: Cannon): void {
    const i = this.byCannon.get(c)
    const before = i === undefined ? null : this.auras[i].side
    if (!this.cfg.particles || !this.onScreen(c.x, c.y, 160)) return
    const team = sideColor(c.side)
    this.glow(c.x, c.y, R * 2.4, R * 4.2, 0.65, team, 360)
    this.glow(c.x, c.y, R * 1.2, R * 1.8, 0.7, 0xffffff, 160)
    if (this.cfg.rings) {
      this.ring(c.x, c.y, R * 1.6, R * 6.5, 0.8, team, 520)
      this.ring(c.x, c.y, R * 1.2, R * 4, 0.45, 0xffffff, 340)
    }
    const n = this.count(16)
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + this.rand() * 0.3
      const sp = 140 + this.rand() * 150
      this.add(this.glows, {
        x: c.x + Math.cos(a) * R, y: c.y + Math.sin(a) * R, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.04,
        lifeMs: 420 + this.rand() * 240, size0: 18, size1: 8, alpha: 0.95, tint: k % 4 === 0 ? 0xffffff : team, tex: TEX.spark, stretch: 1.6,
      })
    }
    if (c.side === 'player' || before === 'player') this.shake(c.side === 'player' ? 0.0022 : 0.003, 130)
  }

  /** A friendly shot healed a cannon: a few "+" rise off it. */
  healed(c: Cannon): void {
    const i = this.byCannon.get(c)
    if (!this.cfg.particles || i === undefined || !this.onScreen(c.x, c.y, 60)) return
    const a = this.auras[i]
    if (a.heal > 0) return
    a.heal = 160
    const team = lerpColor(sideColor(c.side), 0xffffff, 0.35)
    const n = this.count(3)
    for (let k = 0; k < n; k++) {
      this.add(this.glows, {
        x: c.x + (this.rand() - 0.5) * R * 1.6, y: c.y - R * 0.2 + (this.rand() - 0.5) * R,
        vx: (this.rand() - 0.5) * 12, vy: -38 - this.rand() * 18, gravity: -8,
        lifeMs: 620 + this.rand() * 220, size0: 11, size1: 9, alpha: 0.9, tint: team, tex: TEX.plus, fade: FADE_LATE,
      })
    }
    this.glow(c.x, c.y, R * 1.5, R * 2.4, 0.3, team, 260)
  }

  /** The countdown's Go: one soft ring out from the board's middle. */
  go(): void {
    if (!this.cfg.particles) return
    const b = this.opts.board
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    const big = Math.hypot(b.w, b.h)
    const tint = lerpColor(theme.player, 0xffffff, 0.5)
    if (this.cfg.rings) this.ring(cx, cy, Math.min(b.w, b.h) * 0.1, big * 0.9, 0.3, tint, 750)
    this.glow(cx, cy, Math.min(b.w, b.h) * 0.3, Math.min(b.w, b.h) * 0.6, 0.14, tint, 500)
  }

  /** The round is over: the winner's colour sweeps across the board from their side. */
  end(winner: Side | null): void {
    if (!this.cfg.rings || !winner || winner === 'neutral') return
    const edge = this.opts.edges?.[winner] ?? (winner === 'player' ? 'left' : 'right')
    if (!edge) return
    this.sweepFrom = edge
    this.sweepColour = sideColor(winner)
    this.sweepT = 0
    if (!this.sweep) {
      this.sweep = this.scene.add.image(0, 0, SWEEP_TEX).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.sweep).setOrigin(0, 0)
      this.register(this.sweep)
    }
  }

  // ------------------------------------------------------------------ per frame

  /** Move and draw everything. `cannons` and `fans` are the round's (same order as at the start). */
  update(dtMs: number, time: number, cannons: readonly Cannon[], shots: readonly Shot[], fans: readonly Fan[]): void {
    this.now = time
    const v = this.opts.view?.()
    if (v) {
      this.view0x = v.x
      this.view0y = v.y
      this.view1x = v.x + v.w
      this.view1y = v.y + v.h
    }
    const cfg = this.cfg
    this.glows.pool.step(dtMs)
    this.smoke.pool.step(dtMs)
    if (cfg.quality !== 'off') {
      this.updateAuras(dtMs, time, cannons)
      this.updateFans(dtMs, fans)
      this.drawShots(shots)
      this.updateSweep(dtMs)
    }
    this.glows.draw()
    this.smoke.draw()
  }

  private auraColour(side: Side): number {
    return side === 'neutral' ? theme.neutral : sideColor(side)
  }

  private updateAuras(dtMs: number, time: number, cannons: readonly Cannon[]): void {
    const cfg = this.cfg
    for (let i = 0; i < cannons.length && i < this.auras.length; i++) {
      const c = cannons[i]
      const a = this.auras[i]
      a.heal = Math.max(0, a.heal - dtMs)
      const target = this.auraColour(c.side)
      if (c.side !== a.side) {
        // Changed hands: cross-fade from what it showed into the new colour, and swell.
        a.from = a.colour
        a.to = target
        a.flip = 0
        a.side = c.side
      } else if (a.flip >= AURA.flipMs) a.colour = target
      let swell = 0
      if (a.flip < AURA.flipMs) {
        a.flip += dtMs
        const t = Math.min(1, a.flip / AURA.flipMs)
        a.colour = lerpColor(a.from, a.to, t * t * (3 - 2 * t))
        swell = Math.sin(Math.PI * t)
      }
      const neutral = c.side === 'neutral'
      const show = cfg.aura && (!neutral || cfg.quality === 'high' || swell > 0) && this.onScreen(c.x, c.y, AURA.size)
      if (!show) {
        if (a.glow?.visible) a.glow.setVisible(false)
        if (a.halo?.visible) a.halo.setVisible(false)
        continue
      }
      if (!a.glow) {
        a.glow = this.scene.add.image(c.x, c.y, FX_TEX[TEX.glow]).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.aura)
        this.register(a.glow)
      }
      const breathe = cfg.auraMotion ? Math.sin(time / 1300 + a.phase) : 0
      const base = neutral && swell === 0 ? AURA.neutral : AURA.alpha + AURA.breathe * breathe
      const grow = 1 + (cfg.auraMotion ? 0.04 * breathe + 0.45 * swell : 0)
      a.glow.setVisible(true).setPosition(c.x, c.y).setTint(a.colour).setAlpha(Math.min(1, base + 0.35 * swell)).setScale((AURA.size * grow) / FX_TEX_W[TEX.glow])
      const halo = cfg.quality === 'high' && cfg.auraMotion && !neutral
      if (halo) {
        if (!a.halo) {
          a.halo = this.scene.add.image(c.x, c.y, HALO_TEX).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.aura)
          this.register(a.halo)
        }
        a.halo.setVisible(true).setPosition(c.x, c.y).setTint(a.colour).setAlpha(0.3 + 0.07 * breathe + 0.3 * swell)
          .setRotation(time / 4200 + a.phase).setScale((AURA.size * 1.05 * grow) / HALO_W)
      } else if (a.halo?.visible) a.halo.setVisible(false)
      // Nearly captured: it sputters sparks in the attacker's colour.
      if (c.captureAttacker && c.captureAttacker !== c.side && cfg.particles) {
        const k = c.captureProgress / TUNING.captureThreshold
        a.sputter -= dtMs
        if (k > 0.66 && a.sputter <= 0) {
          a.sputter = (cfg.quality === 'high' ? 260 : 700) * (1.4 - k)
          const ang = this.rand() * Math.PI * 2
          this.sparks(c.x + Math.cos(ang) * R * 0.9, c.y + Math.sin(ang) * R * 0.9, 2, sideColor(c.captureAttacker), 90, 200, 12)
        }
      }
    }
  }

  private updateFans(dtMs: number, fans: readonly Fan[]): void {
    const rate = this.cfg.fanAir
    if (!rate) return
    for (let i = 0; i < fans.length && i < this.fanAcc.length; i++) {
      const f = fans[i].field
      if (!this.onScreen(f.x, f.y, f.radius)) continue
      this.fanAcc[i] += (dtMs / 1000) * rate * Math.min(2, f.radius / 120)
      while (this.fanAcc[i] >= 1) {
        this.fanAcc[i] -= 1
        const dx = Math.cos(f.angle)
        const dy = Math.sin(f.angle)
        const lat = (this.rand() * 2 - 1) * f.radius * 0.6
        const back = f.radius * (0.55 + this.rand() * 0.2) * Math.sqrt(1 - (lat / f.radius) ** 2)
        const sp = f.radius * (1.3 + this.rand() * 0.5)
        this.add(this.glows, {
          x: f.x - dx * back - dy * lat, y: f.y - dy * back + dx * lat, vx: dx * sp, vy: dy * sp,
          lifeMs: ((back * 1.7) / sp) * 1000, size0: 14, size1: 22, alpha: 0.32, tint: lerpColor(theme.fan, 0xffffff, 0.35), tex: TEX.spark, stretch: 2.4, fade: FADE_INOUT,
        })
      }
    }
  }

  /** Each shot: a fading trail in its owner's colour (cut short after a bank), and a glow on the head. */
  private drawShots(shots: readonly Shot[]): void {
    const cap = this.cfg.shotFx
    const glow = this.cfg.shotGlow
    let t = 0
    let g = 0
    for (let i = 0; i < shots.length && t < cap; i++) {
      const s = shots[i]
      const b = s.ball
      if (!b.alive) continue
      if (b.bounces !== s.fxBounces) {
        s.fxBounces = b.bounces
        s.fxSince = b.age
      }
      if (!this.onScreen(b.x, b.y, 140)) continue
      const v = Math.hypot(b.vx, b.vy)
      if (v < 1) continue
      const kind = s.kind
      const want = kind === 'sniper' ? 120 : kind === 'machinegun' ? 18 : 36
      const len = Math.min(want, (v * Math.max(0, b.age - s.fxSince)) / 1000)
      const colour = sideColor(s.side)
      if (len > 2) {
        const img = this.trails[t] ?? this.makeShotImage(this.trails, TRAIL_TEX, 1, 0.5)
        const thick = kind === 'sniper' ? 4 : kind === 'machinegun' ? 5 : 8
        img.setPosition(b.x, b.y).setRotation(Math.atan2(b.vy, b.vx)).setScale(len / TRAIL_W, thick / TRAIL_H)
          .setTint(kind === 'sniper' ? lerpColor(colour, 0xffffff, 0.35) : colour).setAlpha(kind === 'sniper' ? 0.75 : 0.55)
        if (!img.visible) img.setVisible(true)
        t++
      }
      if (glow && kind !== 'machinegun') {
        const img = this.heads[g] ?? this.makeShotImage(this.heads, FX_TEX[TEX.glow], 0.5, 0.5)
        img.setPosition(b.x, b.y).setScale((kind === 'sniper' ? 22 : 28) / FX_TEX_W[TEX.glow]).setTint(kind === 'sniper' ? 0xffffff : colour).setAlpha(0.5)
        if (!img.visible) img.setVisible(true)
        g++
      }
    }
    this.hideShots(t, g)
  }

  private makeShotImage(list: Phaser.GameObjects.Image[], key: string, ox: number, oy: number): Phaser.GameObjects.Image {
    const img = this.scene.add.image(0, 0, key).setOrigin(ox, oy).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.trail).setVisible(false)
    this.register(img)
    list.push(img)
    return img
  }

  private hideShots(trails: number, heads: number): void {
    for (let i = trails; i < this.trailsShown; i++) this.trails[i]?.setVisible(false)
    for (let i = heads; i < this.headsShown; i++) this.heads[i]?.setVisible(false)
    this.trailsShown = trails
    this.headsShown = heads
  }

  private updateSweep(dtMs: number): void {
    if (this.sweepT < 0 || !this.sweep) return
    const DUR = 1500
    this.sweepT += dtMs
    const t = Math.min(1, this.sweepT / DUR)
    const b = this.opts.board
    const w = b.w * 0.35
    // Eased across the board, staying inside it; fades in and out at the ends.
    const e = t * t * (3 - 2 * t)
    const x = this.sweepFrom === 'left' ? b.x + (b.w - w) * e : b.x + (b.w - w) * (1 - e)
    this.sweep.setVisible(true).setPosition(x, b.y).setScale(w / SWEEP_W, b.h / 4).setTint(this.sweepColour).setAlpha(0.2 * Math.sin(Math.PI * t))
    if (t >= 1) {
      this.sweepT = -1
      this.sweep.setVisible(false)
    }
  }

  // ------------------------------------------------------------------ helpers

  /** A burst's particle count at this quality (at least 1). */
  private count(n: number): number {
    return Math.max(1, Math.round(n * this.cfg.burst))
  }

  private add(layer: Layer, s: Spawn): void {
    layer.pool.spawn(s)
  }

  /** A short glow that grows from `s0` to `s1` px while it fades. */
  private glow(x: number, y: number, s0: number, s1: number, alpha: number, tint: number, ms: number): void {
    const a = this.spawnArgs
    a.x = x; a.y = y; a.vx = 0; a.vy = 0; a.drag = 1; a.gravity = 0; a.lifeMs = ms; a.size0 = s0; a.size1 = s1
    a.alpha = alpha; a.tint = tint; a.tex = TEX.glow; a.rot = 0; a.spin = 0; a.stretch = 0; a.fade = undefined
    this.glows.pool.spawn(a)
  }

  /** An expanding ring (shockwave). */
  private ring(x: number, y: number, s0: number, s1: number, alpha: number, tint: number, ms: number): void {
    const a = this.spawnArgs
    a.x = x; a.y = y; a.vx = 0; a.vy = 0; a.drag = 1; a.gravity = 0; a.lifeMs = ms; a.size0 = s0 * 2; a.size1 = s1 * 2
    a.alpha = alpha; a.tint = tint; a.tex = TEX.ring; a.rot = 0; a.spin = 0; a.stretch = 0; a.fade = undefined
    this.glows.pool.spawn(a)
  }

  /** `n` sparks flying out in all directions. */
  private sparks(x: number, y: number, n: number, tint: number, sp0: number, sp1: number, size: number): void {
    const a = this.spawnArgs
    for (let k = 0; k < n; k++) {
      const ang = this.rand() * Math.PI * 2
      const sp = sp0 + this.rand() * (sp1 - sp0)
      a.x = x; a.y = y; a.vx = Math.cos(ang) * sp; a.vy = Math.sin(ang) * sp; a.drag = 0.02; a.gravity = 0
      a.lifeMs = 160 + this.rand() * 120; a.size0 = size; a.size1 = size * 0.5; a.alpha = 0.95
      a.tint = k % 3 === 2 ? 0xffffff : tint; a.tex = TEX.spark; a.rot = 0; a.spin = 0; a.stretch = 1.4; a.fade = undefined
      this.glows.pool.spawn(a)
    }
  }

  /** A small camera shake for a big moment (not too often). */
  private shake(intensity: number, ms: number): void {
    if (!this.cfg.shake || this.now - this.lastShake < 450) return
    this.lastShake = this.now
    this.scene.cameras.main.shake(ms, intensity)
  }

  private onScreen(x: number, y: number, margin: number): boolean {
    return x > this.view0x - margin && x < this.view1x + margin && y > this.view0y - margin && y < this.view1y + margin
  }

  /** Cheap repeatable noise for particle variety (no Math.random per particle needed, but it's fine either way). */
  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647
    return (this.seed - 1) / 2147483646
  }

  destroy(): void {
    this.glows.destroy()
    this.smoke.destroy()
    for (const a of this.auras) {
      a.glow?.destroy()
      a.halo?.destroy()
    }
    for (const img of this.trails) img.destroy()
    for (const img of this.heads) img.destroy()
    this.sweep?.destroy()
  }
}
