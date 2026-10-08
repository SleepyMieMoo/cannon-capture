import Phaser from 'phaser'
import { PORTAL, portalColour } from '../config/obstacles'
import { lerpColor } from '../config/theme'
import { PORTAL_TEX, PORTAL_W, bakeFxTextures } from '../render/vfx/fxTextures'
import type { PortalEnd } from '../types'

/**
 * One portal mouth: a dark well with a swirl in its pair's colour (a baked
 * sprite that turns slowly), a bright rim, the pair's glyph in the middle
 * (ring, diamond or triangle) so linked mouths read as a pair, and a notch
 * on the rim showing the way it faces (shots come out turned by the
 * difference between the two mouths' facings).
 */
export class Portal {
  end: PortalEnd
  readonly pair: number
  private readonly gfx: Phaser.GameObjects.Graphics
  private readonly swirl: Phaser.GameObjects.Image
  private readonly glyph: Phaser.GameObjects.Graphics

  constructor(scene: Phaser.Scene, end: PortalEnd, pair: number, depth = 1.2) {
    this.end = end
    this.pair = pair
    bakeFxTextures(scene.textures)
    this.gfx = scene.add.graphics().setDepth(depth)
    this.swirl = scene.add.image(0, 0, PORTAL_TEX).setDepth(depth + 0.02).setBlendMode(Phaser.BlendModes.ADD)
    this.glyph = scene.add.graphics().setDepth(depth + 0.04)
    this.draw()
  }

  get parts(): Phaser.GameObjects.GameObject[] {
    return [this.gfx, this.swirl, this.glyph]
  }

  get colour(): number {
    return portalColour(this.pair)
  }

  set(end: PortalEnd): void {
    this.end = end
    this.draw()
  }

  /** Per frame: the swirl turns unless `moving` is false (Reduce motion, Effects off). */
  tick(time: number, moving: boolean): void {
    if (!moving) return
    this.swirl.setRotation(-time / 520 + this.pair * 2)
    this.swirl.setAlpha(0.8 + 0.15 * Math.sin(time / 400 + this.end.x * 0.02))
  }

  destroy(): void {
    this.gfx.destroy()
    this.swirl.destroy()
    this.glyph.destroy()
  }

  setVisible(on: boolean): void {
    for (const p of this.parts) (p as unknown as Phaser.GameObjects.Components.Visible).setVisible(on)
  }

  private draw(): void {
    const { x, y, angle } = this.end
    const r = PORTAL.radius
    const col = this.colour
    const g = this.gfx
    g.clear()
    // A soft outer halo, the dark well and the rim.
    g.fillStyle(col, 0.12)
    g.fillCircle(x, y, r + 7)
    g.fillStyle(0x07090c, 0.92)
    g.fillCircle(x, y, r)
    g.lineStyle(3, col, 0.95)
    g.strokeCircle(x, y, r)
    g.lineStyle(1, lerpColor(col, 0xffffff, 0.6), 0.7)
    g.strokeCircle(x, y, r - 3)
    // The facing notch: a small arrowhead just outside the rim.
    const ca = Math.cos(angle)
    const sa = Math.sin(angle)
    const tip = r + 9
    const base = r + 2
    g.fillStyle(lerpColor(col, 0xffffff, 0.35), 1)
    g.fillTriangle(x + ca * tip, y + sa * tip, x + ca * base - sa * 5, y + sa * base + ca * 5, x + ca * base + sa * 5, y + sa * base - ca * 5)
    this.swirl.setPosition(x, y).setScale(((r - 2) * 2) / PORTAL_W).setTint(col)
    // The pair's glyph.
    const gl = this.glyph
    gl.clear()
    gl.lineStyle(2, 0xffffff, 0.85)
    const k = 5
    const shape = PORTAL.glyphs[this.pair % PORTAL.glyphs.length]
    if (shape === 'ring') gl.strokeCircle(x, y, k)
    else if (shape === 'diamond') gl.strokePoints([{ x, y: y - k - 1 }, { x: x + k + 1, y }, { x, y: y + k + 1 }, { x: x - k - 1, y }], true)
    else gl.strokeTriangle(x, y - k - 1, x + k + 1, y + k, x - k - 1, y + k)
  }
}
