import Phaser from 'phaser'
import { theme } from '../config/theme'
import type { PillarDef } from '../types'

/**
 * A round pillar, seen from above: a dark stone disc with a lighter rim and
 * a soft highlight, so it reads as round. Shots glance off its surface.
 */
export class Pillar {
  readonly gfx: Phaser.GameObjects.Graphics

  constructor(scene: Phaser.Scene, private def: PillarDef) {
    this.gfx = scene.add.graphics().setDepth(1.2)
    this.draw()
  }

  get parts(): Phaser.GameObjects.GameObject[] {
    return [this.gfx]
  }

  set(def: PillarDef): void {
    this.def = def
    this.draw()
  }

  destroy(): void {
    this.gfx.destroy()
  }

  private draw(): void {
    const { x, y, r } = this.def
    const g = this.gfx
    g.clear()
    // A soft shadow ring, so it lifts off the board.
    g.fillStyle(0x000000, 0.35)
    g.fillCircle(x + 2, y + 3, r + 1)
    g.fillStyle(theme.wallEdge, 1)
    g.fillCircle(x, y, r)
    g.fillStyle(theme.wall, 1)
    g.fillCircle(x, y, r * 0.82)
    // A crescent highlight on the top-left, the top-down cue that it's round.
    g.fillStyle(theme.wallShine, 0.5)
    g.fillEllipse(x - r * 0.28, y - r * 0.3, r * 0.55, r * 0.34)
    g.fillStyle(0x000000, 0.18)
    g.fillCircle(x, y, r * 0.28)
  }
}
