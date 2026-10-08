import Phaser from 'phaser'
import { GLASS, GLASS_RIM } from '../config/obstacles'
import { theme } from '../config/theme'
import type { GlassDef } from '../types'

/** How thick the pane is drawn (px). The collision band matches the shot radius. */
const THICK = 8

/**
 * One-way glass: a clear pane with a gradient from the solid side (bright
 * edge) to the open side (fading out) and chevrons pointing the way shots
 * pass through, so the direction reads at a glance.
 */
export class Glass {
  readonly gfx: Phaser.GameObjects.Graphics
  /** Drawn still (no drift): nothing to redraw until it moves again or changes. */
  private still = false

  constructor(scene: Phaser.Scene, private def: GlassDef) {
    this.gfx = scene.add.graphics().setDepth(1.3)
    this.draw(0, false)
  }

  get parts(): Phaser.GameObjects.GameObject[] {
    return [this.gfx]
  }

  set(def: GlassDef): void {
    this.def = def
    this.still = false
    this.draw(0, false)
  }

  destroy(): void {
    this.gfx.destroy()
  }

  /** `moving`: the chevrons drift (off with Reduce motion or Effects off). */
  draw(time: number, moving: boolean): void {
    if (!moving && this.still) return
    this.still = !moving
    const { x, y, x2, y2 } = this.def
    const dx = x2 - x
    const dy = y2 - y
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    // The open side: opposite the solid normal.
    const nx = this.def.flip ? -uy : uy
    const ny = this.def.flip ? ux : -ux
    const g = this.gfx
    g.clear()
    const h = THICK / 2
    // The pane itself: a thin glassy slab.
    g.fillStyle(GLASS, 0.16)
    slab(g, x, y, ux, uy, -nx, -ny, len, THICK)
    // Solid side: a bright rim shots bounce off.
    g.lineStyle(2.5, GLASS_RIM, 0.9)
    g.lineBetween(x - nx * h, y - ny * h, x2 - nx * h, y2 - ny * h)
    // Open side: a soft gradient fading out (shots come through this way).
    for (let k = 0; k < 3; k++) {
      g.lineStyle(2, GLASS, 0.22 - k * 0.07)
      const o = h + 1 + k * 3
      g.lineBetween(x + nx * o, y + ny * o, x2 + nx * o, y2 + ny * o)
    }
    g.lineStyle(1, theme.wallShine, 0.2)
    g.lineBetween(x + nx * h, y + ny * h, x2 + nx * h, y2 + ny * h)
    // Chevrons pointing the way shots pass (from the open side through to the solid side), drifting along the pane.
    const drift = moving ? (time / 700) % 1 : 0.5
    const step = 34
    const n = Math.max(1, Math.floor(len / step))
    for (let i = 0; i < n; i++) {
      const t = (i + drift) / n
      const cx = x + ux * (t * len)
      const cy = y + uy * (t * len)
      chevron(g, cx + nx * 3, cy + ny * 3, -nx, -ny, 0.75)
    }
  }
}

function slab(g: Phaser.GameObjects.Graphics, x: number, y: number, ux: number, uy: number, px: number, py: number, len: number, thick: number): void {
  const h = thick / 2
  g.beginPath()
  g.moveTo(x - px * h, y - py * h)
  g.lineTo(x + ux * len - px * h, y + uy * len - py * h)
  g.lineTo(x + ux * len + px * h, y + uy * len + py * h)
  g.lineTo(x + px * h, y + py * h)
  g.closePath()
  g.fillPath()
}

function chevron(g: Phaser.GameObjects.Graphics, x: number, y: number, dx: number, dy: number, alpha: number): void {
  const size = 7
  const px = -dy
  const py = dx
  g.fillStyle(GLASS_RIM, alpha)
  g.fillTriangle(
    x + dx * size,
    y + dy * size,
    x - dx * size * 0.5 + px * size * 0.7,
    y - dy * size * 0.5 + py * size * 0.7,
    x - dx * size * 0.5 - px * size * 0.7,
    y - dy * size * 0.5 - py * size * 0.7,
  )
}
