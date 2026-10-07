import Phaser from 'phaser'
import { theme } from '../config/theme'
import type { Rect } from '../types'

export class Wall {
  readonly rect: Rect
  private readonly gfx: Phaser.GameObjects.Graphics

  constructor(scene: Phaser.Scene, rect: Rect) {
    this.rect = rect
    this.gfx = scene.add.graphics()
    this.gfx.setDepth(1)
    this.draw()
  }

  private draw(): void {
    const { x, y, w, h } = this.rect
    const g = this.gfx
    g.fillStyle(theme.wallEdge, 1)
    g.fillRoundedRect(x, y, w, h, 5)
    const inset = Math.min(4, w / 4, h / 4)
    g.fillStyle(theme.wall, 1)
    g.fillRoundedRect(x + inset, y + inset, Math.max(1, w - inset * 2), Math.max(1, h - inset * 2), 3)
    g.fillStyle(theme.wallShine, 0.35)
    g.fillRect(x + inset + 2, y + inset + 1, Math.max(1, w - inset * 2 - 4), 3)
  }
}
