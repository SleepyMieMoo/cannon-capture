import Phaser from 'phaser'
import { theme } from '../config/theme'
import type { WallDef } from '../types'

/** A wall block. Rotated walls (`angle`, radians) turn about their centre. */
export class Wall {
  rect: WallDef
  readonly gfx: Phaser.GameObjects.Graphics

  constructor(scene: Phaser.Scene, rect: WallDef) {
    this.rect = rect
    this.gfx = scene.add.graphics()
    this.gfx.setDepth(1)
    this.draw()
  }

  /** Replace the shape (used by the editor) and redraw. */
  set(rect: WallDef): void {
    this.rect = rect
    this.draw()
  }

  destroy(): void {
    this.gfx.destroy()
  }

  private draw(): void {
    const { x, y, w, h } = this.rect
    const g = this.gfx
    g.clear()
    g.setPosition(x + w / 2, y + h / 2)
    g.setRotation(this.rect.angle ?? 0)
    const lx = -w / 2
    const ly = -h / 2
    g.fillStyle(theme.wallEdge, 1)
    g.fillRoundedRect(lx, ly, w, h, Math.min(5, w / 2, h / 2))
    const inset = Math.min(4, w / 4, h / 4)
    g.fillStyle(theme.wall, 1)
    g.fillRoundedRect(lx + inset, ly + inset, Math.max(1, w - inset * 2), Math.max(1, h - inset * 2), Math.min(3, w / 4, h / 4))
    g.fillStyle(theme.wallShine, 0.35)
    g.fillRect(lx + inset + 2, ly + inset + 1, Math.max(1, w - inset * 2 - 4), 3)
  }
}
