import Phaser from 'phaser'
import { PORTAL, portalColour } from '../config/obstacles'
import { lerpColor } from '../config/theme'
import { PORTAL_TEX, PORTAL_W, bakeFxTextures } from '../render/vfx/fxTextures'
import { exitAngle } from '../sim/portals'
import type { PortalEnd } from '../types'

/**
 * One portal mouth: a dark well with a swirl in its pair's colour (a baked
 * sprite that turns slowly), a bright rim, and the pair's glyph in the middle
 * (ring, diamond or triangle) so linked mouths read as a pair. The disc is
 * exactly the mouth: a shot touching it falls in.
 *
 * The exit cue, all inside the disc: a soft beam in the well and a softly
 * brighter stretch of rim, on the side shots come *out* of this mouth (see
 * exitAngle). Colour (and glyph) is the main cue for which mouths link. Shoot straight into one mouth's beam and
 * the shot leaves its twin along the twin's beam; come in at an angle and it
 * leaves at that same angle to the beam.
 */
export class Portal {
  end: PortalEnd
  readonly pair: number
  private readonly gfx: Phaser.GameObjects.Graphics
  private readonly swirl: Phaser.GameObjects.Image
  private readonly glyph: Phaser.GameObjects.Graphics

  /** Which mouth of its pair it is ('a' or 'b'): the exit cue of 'a' faces the other way to its angle. */
  readonly which: 'a' | 'b'

  constructor(scene: Phaser.Scene, end: PortalEnd, pair: number, which: 'a' | 'b', depth = 1.2) {
    this.end = end
    this.pair = pair
    this.which = which
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
    // The dark well and the rim, all inside the disc (the disc is the hitbox).
    g.fillStyle(0x07090c, 0.92)
    g.fillCircle(x, y, r)
    // The exit beam: a soft wedge from the middle out to the rim.
    const out = exitAngle(this.which, angle)
    const spread = 0.62
    g.lineStyle(3, col, 0.95)
    g.strokeCircle(x, y, r - 1.5)
    g.lineStyle(1, lerpColor(col, 0xffffff, 0.6), 0.7)
    g.strokeCircle(x, y, r - 4)
    // A brighter lip on the rim where shots come out.
    // (soft, and fading at its ends, so it reads as light rather than an arrow).
    g.lineStyle(3, lerpColor(col, 0xffffff, 0.4), 0.45)
    g.beginPath()
    g.arc(x, y, r - 1.5, out - spread, out + spread, false)
    g.strokePath()
    g.lineStyle(3, lerpColor(col, 0xffffff, 0.4), 0.4)
    g.beginPath()
    g.arc(x, y, r - 1.5, out - spread * 0.5, out + spread * 0.5, false)
    g.strokePath()
    this.swirl.setPosition(x, y).setScale(((r - 2) * 2) / PORTAL_W).setTint(col)
    // The pair's glyph.
    const gl = this.glyph
    gl.clear()
    // The beam goes over the swirl so it reads: a soft wedge from the middle out to the rim.
    gl.fillStyle(lerpColor(col, 0xffffff, 0.3), 0.16)
    gl.slice(x, y, r - 3, out - spread, out + spread, false)
    gl.fillPath()
    gl.fillStyle(lerpColor(col, 0xffffff, 0.3), 0.14)
    gl.slice(x, y, r - 3, out - spread * 0.45, out + spread * 0.45, false)
    gl.fillPath()
    gl.lineStyle(2, 0xffffff, 0.85)
    const k = 5
    const shape = PORTAL.glyphs[this.pair % PORTAL.glyphs.length]
    if (shape === 'ring') gl.strokeCircle(x, y, k)
    else if (shape === 'diamond') gl.strokePoints([{ x, y: y - k - 1 }, { x: x + k + 1, y }, { x, y: y + k + 1 }, { x: x - k - 1, y }], true)
    else gl.strokeTriangle(x, y - k - 1, x + k + 1, y + k, x - k - 1, y + k)
  }
}

