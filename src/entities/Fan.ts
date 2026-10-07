import Phaser from 'phaser'
import { TUNING } from '../config/tuning'
import { theme } from '../config/theme'
import type { FanField } from '../sim/ballistics'
import type { FanDef } from '../types'

export class Fan {
  readonly field: FanField
  private readonly gfx: Phaser.GameObjects.Graphics

  constructor(scene: Phaser.Scene, def: FanDef) {
    this.field = {
      x: def.x,
      y: def.y,
      radius: def.radius,
      angle: def.angle,
      force: def.force ?? TUNING.fanForce,
    }
    this.gfx = scene.add.graphics()
    this.gfx.setDepth(2)
  }

  draw(time: number): void {
    const { x, y, radius, angle } = this.field
    const g = this.gfx
    g.clear()
    g.fillStyle(theme.fan, 0.12)
    g.fillCircle(x, y, radius)
    g.lineStyle(2, theme.fan, 0.55)
    g.strokeCircle(x, y, radius)

    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    const px = -dy
    const py = dx
    for (let i = 0; i < 5; i++) {
      const t = (time / 850 + i / 5) % 1
      const along = (t - 0.5) * radius * 1.55
      const lateral = (i % 2 === 0 ? -1 : 1) * radius * 0.32
      const cx = x + dx * along + px * lateral
      const cy = y + dy * along + py * lateral
      const ox = cx - x
      const oy = cy - y
      if (ox * ox + oy * oy > (radius - 16) * (radius - 16)) continue
      chevron(g, cx, cy, angle)
    }

    const spin = time / 260
    g.fillStyle(theme.fan, 1)
    g.fillCircle(x, y, 14)
    g.fillStyle(theme.fanBlade, 0.95)
    for (let blade = 0; blade < 3; blade++) {
      const a = spin + (blade * Math.PI * 2) / 3
      g.fillTriangle(
        x + Math.cos(a + 0.45) * 5,
        y + Math.sin(a + 0.45) * 5,
        x + Math.cos(a - 0.45) * 5,
        y + Math.sin(a - 0.45) * 5,
        x + Math.cos(a) * 24,
        y + Math.sin(a) * 24,
      )
    }
    g.fillStyle(0xffffff, 0.9)
    g.fillCircle(x, y, 4)
  }
}

function chevron(g: Phaser.GameObjects.Graphics, x: number, y: number, angle: number): void {
  const size = 10
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const px = -dy
  const py = dx
  g.fillStyle(theme.fan, 0.9)
  g.fillTriangle(
    x + dx * size,
    y + dy * size,
    x - dx * size * 0.45 + px * size * 0.75,
    y - dy * size * 0.45 + py * size * 0.75,
    x - dx * size * 0.45 - px * size * 0.75,
    y - dy * size * 0.45 - py * size * 0.75,
  )
}
