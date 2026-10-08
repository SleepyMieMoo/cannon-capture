import Phaser from 'phaser'
import { theme } from '../config/theme'
import { VOID_TEX, VOID_W, bakeFxTextures } from '../render/vfx/fxTextures'
import { BRICK, VOID_COLOURS, crackStage } from '../config/obstacles'
import { seededRandom } from '../sim/random'
import type { WallDef } from '../types'

/**
 * A wall block. Rotated walls (`angle`, radians) turn about their centre.
 * A void wall (kind 'void') is a dark slab that swallows shots, with a slow
 * inner swirl (a baked tile, so it costs one sprite). A breakable wall is
 * clay brick: it cracks in two stages as it takes hits and is hidden once
 * it breaks (the scene plays the debris).
 */
export class Wall {
  rect: WallDef
  readonly gfx: Phaser.GameObjects.Graphics
  private swirl: Phaser.GameObjects.TileSprite | null = null
  /** Breakable walls: the crack stage drawn (0 whole … 3 broken). */
  private stage = 0

  constructor(private readonly scene: Phaser.Scene, rect: WallDef) {
    this.rect = rect
    this.gfx = scene.add.graphics()
    this.gfx.setDepth(1)
    this.draw()
  }

  /** Every display object (register them all with the world camera). */
  get parts(): Phaser.GameObjects.GameObject[] {
    return this.swirl ? [this.gfx, this.swirl] : [this.gfx]
  }

  get isVoid(): boolean {
    return this.rect.kind === 'void'
  }

  get isBreakable(): boolean {
    return this.rect.kind === 'breakable'
  }

  get broken(): boolean {
    return this.stage >= 3
  }

  /** Breakable walls: show `health` (1 whole … 0 broken). Redraws only when the crack stage changes. */
  setHealth(health: number): void {
    if (!this.isBreakable) return
    const stage = crackStage(health)
    if (stage === this.stage) return
    this.stage = stage
    this.gfx.setVisible(stage < 3)
    if (stage < 3) this.draw()
  }

  /** Replace the shape (used by the editor) and redraw. */
  set(rect: WallDef): void {
    this.rect = rect
    this.draw()
  }

  destroy(): void {
    this.gfx.destroy()
    this.swirl?.destroy()
    this.swirl = null
  }

  /** Per frame, void walls only: the swirl drifts unless `moving` is false (Reduce motion, Effects off). */
  tick(time: number, moving: boolean): void {
    if (!this.swirl || !moving) return
    this.swirl.tilePositionX = (time / 70) % VOID_W
    this.swirl.tilePositionY = 6 * Math.sin(time / 1700)
    this.swirl.setAlpha(0.42 + 0.1 * Math.sin(time / 900 + this.rect.x * 0.01))
  }

  private draw(): void {
    const { x, y, w, h } = this.rect
    const g = this.gfx
    g.clear()
    g.setPosition(x + w / 2, y + h / 2)
    g.setRotation(this.rect.angle ?? 0)
    const lx = -w / 2
    const ly = -h / 2
    const inset = Math.min(4, w / 4, h / 4)
    const iw = Math.max(1, w - inset * 2)
    const ih = Math.max(1, h - inset * 2)
    const ir = Math.min(3, w / 4, h / 4)
    if (this.rect.kind === 'void') {
      g.fillStyle(VOID_COLOURS.edge, 1)
      g.fillRoundedRect(lx, ly, w, h, Math.min(5, w / 2, h / 2))
      g.fillStyle(VOID_COLOURS.fill, 1)
      g.fillRoundedRect(lx + inset, ly + inset, iw, ih, ir)
      g.lineStyle(1.5, VOID_COLOURS.rim, 0.55)
      g.strokeRoundedRect(lx + inset, ly + inset, iw, ih, ir)
      this.layoutSwirl(iw - 2, ih - 2)
      return
    }
    this.swirl?.destroy()
    this.swirl = null
    if (this.rect.kind === 'breakable') return this.drawBricks(lx, ly, w, h, inset)
    g.fillStyle(theme.wallEdge, 1)
    g.fillRoundedRect(lx, ly, w, h, Math.min(5, w / 2, h / 2))
    g.fillStyle(theme.wall, 1)
    g.fillRoundedRect(lx + inset, ly + inset, iw, ih, ir)
    g.fillStyle(theme.wallShine, 0.35)
    g.fillRect(lx + inset + 2, ly + inset + 1, Math.max(1, w - inset * 2 - 4), 3)
  }

  /**
   * Clay bricks in courses along the wall's long side, offset every other
   * course, with cracks from stage 1 and chipped bricks from stage 2. Seeded
   * by the wall's place, so it looks the same every time.
   */
  private drawBricks(lx: number, ly: number, w: number, h: number, inset: number): void {
    const g = this.gfx
    const rand = seededRandom(`brick:${Math.round(this.rect.x)}:${Math.round(this.rect.y)}`)
    const along = w >= h
    const len = along ? w : h
    const thick = along ? h : w
    // Draw in (u along the wall, v across it); map to local x/y.
    const rect = (u: number, v: number, du: number, dv: number) => (along ? g.fillRect(lx + u, ly + v, du, dv) : g.fillRect(lx + v, ly + u, dv, du))
    const line = (u1: number, v1: number, u2: number, v2: number) => (along ? g.lineBetween(lx + u1, ly + v1, lx + u2, ly + v2) : g.lineBetween(lx + v1, ly + u1, lx + v2, ly + u2))
    g.fillStyle(BRICK.edge, 1)
    g.fillRoundedRect(lx, ly, w, h, Math.min(4, w / 2, h / 2))
    g.fillStyle(BRICK.mortar, 1)
    g.fillRect(lx + 1.5, ly + 1.5, Math.max(1, w - 3), Math.max(1, h - 3))
    const pad = Math.min(2.5, inset)
    const rows = Math.max(1, Math.round((thick - pad * 2) / 9))
    const rh = (thick - pad * 2) / rows
    const brick = Math.max(10, Math.min(22, rh * 2.1))
    const chips: [number, number, number, number][] = []
    for (let r = 0; r < rows; r++) {
      const v = pad + r * rh
      let u = pad - (r % 2 ? brick / 2 : 0)
      while (u < len - pad) {
        const u0 = Math.max(pad, u)
        const u1 = Math.min(len - pad, u + brick)
        if (u1 - u0 > 2) {
          const shade = rand()
          g.fillStyle(shade < 0.3 ? BRICK.dark : BRICK.base, 1)
          rect(u0 + 0.7, v + 0.7, u1 - u0 - 1.4, rh - 1.4)
          g.fillStyle(BRICK.light, 0.45)
          rect(u0 + 0.7, v + 0.7, u1 - u0 - 1.4, Math.min(1.6, rh / 4))
          if (this.stage >= 2 && rand() < 0.3) chips.push([u0, v, u1 - u0, rh])
        }
        u += brick
      }
    }
    // Missing chunks once it is crumbling.
    g.fillStyle(BRICK.edge, 1)
    for (const [u, v, du, dv] of chips) rect(u + du * (0.2 + rand() * 0.4), v + (rand() < 0.5 ? 0 : dv * 0.45), du * 0.35, dv * 0.55)
    if (this.stage < 1) return
    // Cracks: jagged lines across the wall, more and longer when crumbling.
    const cracks = this.stage >= 2 ? Math.max(3, Math.round(len / 40)) : Math.max(1, Math.round(len / 80))
    g.lineStyle(this.stage >= 2 ? 1.8 : 1.3, BRICK.crack, 0.95)
    for (let i = 0; i < cracks; i++) {
      let u = pad + rand() * (len - pad * 2)
      let v = rand() < 0.5 ? pad : thick - pad
      const dir = v === pad ? 1 : -1
      const steps = 3 + Math.floor(rand() * 3)
      const reach = (thick - pad * 2) * (this.stage >= 2 ? 1 : 0.65)
      for (let k = 0; k < steps; k++) {
        const nu = Math.max(pad, Math.min(len - pad, u + (rand() - 0.5) * 9))
        const nv = v + (dir * reach) / steps
        line(u, v, nu, nv)
        if (this.stage >= 2 && rand() < 0.35) line(nu, nv, nu + (rand() - 0.5) * 8, nv - dir * 3)
        u = nu
        v = nv
      }
    }
  }

  /** The swirl exactly fills the wall's inside, so it needs no mask. */
  private layoutSwirl(iw: number, ih: number): void {
    const { x, y, w, h } = this.rect
    const sw = Math.max(2, Math.round(iw))
    const sh = Math.max(2, Math.round(ih))
    if (!this.swirl || this.swirl.width !== sw || this.swirl.height !== sh) {
      this.swirl?.destroy()
      bakeFxTextures(this.scene.textures)
      this.swirl = this.scene.add.tileSprite(0, 0, sw, sh, VOID_TEX).setDepth(1.05).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.45)
    }
    this.swirl.setPosition(x + w / 2, y + h / 2).setRotation(this.rect.angle ?? 0)
  }
}
