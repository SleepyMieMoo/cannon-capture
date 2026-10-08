import Phaser from 'phaser'
import { theme } from '../config/theme'
import { VOID_TEX, VOID_W, bakeFxTextures } from '../render/vfx/fxTextures'
import { VOID_COLOURS } from '../config/obstacles'
import type { WallDef } from '../types'

/**
 * A wall block. Rotated walls (`angle`, radians) turn about their centre.
 * A void wall (kind 'void') is a dark slab that swallows shots, with a slow
 * inner swirl (a baked tile, so it costs one sprite).
 */
export class Wall {
  rect: WallDef
  readonly gfx: Phaser.GameObjects.Graphics
  private swirl: Phaser.GameObjects.TileSprite | null = null

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
    g.fillStyle(theme.wallEdge, 1)
    g.fillRoundedRect(lx, ly, w, h, Math.min(5, w / 2, h / 2))
    g.fillStyle(theme.wall, 1)
    g.fillRoundedRect(lx + inset, ly + inset, iw, ih, ir)
    g.fillStyle(theme.wallShine, 0.35)
    g.fillRect(lx + inset + 2, ly + inset + 1, Math.max(1, w - inset * 2 - 4), 3)
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
