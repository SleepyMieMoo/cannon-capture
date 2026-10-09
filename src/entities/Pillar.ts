import Phaser from 'phaser'
import { ROCK } from '../config/obstacles'
import type { PillarDef } from '../types'

/** Points round the ellipse (plenty, so the edge reads as a smooth curve). */
const EDGE_POINTS = 56

/**
 * A pillar seen from above, drawn as the base of a boulder: its footprint *is*
 * the collision ellipse. A dark outline band sits exactly on the edge (like a
 * wall's), and all the stone detail (facets lit from the top-left, speckles,
 * cracks, moss) stays inside it, so where it looks solid is exactly where
 * shots bounce. Round or oval (see PillarDef).
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
    const { x, y } = this.def
    const a = this.def.r
    const b = this.def.ry ?? this.def.r
    const angle = this.def.angle ?? 0
    const g = this.gfx
    g.clear()
    // Drawn in the rock's own frame: x along its long axis.
    g.setPosition(x, y).setRotation(angle)
    const rnd = seeded(Math.round(x) * 73856093 ^ Math.round(y) * 19349663 ^ Math.round(a * 7 + b * 13))
    /** The outline band, a few px wide (like a wall's edge). */
    const band = Math.max(2.5, Math.min(4, Math.min(a, b) / 6))
    const ia = Math.max(1, a - band)
    const ib = Math.max(1, b - band)
    /** A point on the inner ellipse at angle `t`, `s` of the way out (s <= 1 stays inside). */
    const at = (t: number, s: number): Phaser.Math.Vector2 => new Phaser.Math.Vector2(Math.cos(t) * ia * s, Math.sin(t) * ib * s)
    const ellipse = (rx: number, ry: number) =>
      Array.from({ length: EDGE_POINTS }, (_, i) => {
        const t = (i / EDGE_POINTS) * Math.PI * 2
        return new Phaser.Math.Vector2(Math.cos(t) * rx, Math.sin(t) * ry)
      })
    // The footprint: dark outline on the exact edge, stone inside it.
    g.fillStyle(ROCK.outline, 1)
    g.fillPoints(ellipse(a, b), true)
    g.fillStyle(ROCK.base, 1)
    g.fillPoints(ellipse(ia, ib), true)
    // The light comes from the screen's top-left; turn that into the rock's frame.
    const lx = Math.cos(-angle) * -0.7 - Math.sin(-angle) * -0.7
    const ly = Math.sin(-angle) * -0.7 + Math.cos(-angle) * -0.7
    // Facets: flat plates from an off-centre ridge out to the inner edge, shaded by which way they
    // face. Their corners sit on the inner ellipse (or just inside), so they never cross the outline.
    const ridge = new Phaser.Math.Vector2((rnd() - 0.5) * ia * 0.35, (rnd() - 0.5) * ib * 0.35)
    let t = rnd() * Math.PI * 2
    const end = t + Math.PI * 2
    while (t < end - 0.05) {
      const span = Math.min(end - t, 0.6 + rnd() * 0.7)
      const pts = [ridge]
      const steps = Math.max(2, Math.ceil(span / 0.2))
      for (let j = 0; j <= steps; j++) pts.push(at(t + (span * j) / steps, j === 0 || j === steps ? 1 : 0.97 + rnd() * 0.03))
      const mid = t + span / 2
      const nx = Math.cos(mid) / ia
      const ny = Math.sin(mid) / ib
      const face = (nx * lx + ny * ly) / Math.max(1e-6, Math.hypot(nx, ny))
      if (face > 0.25) g.fillStyle(ROCK.light, 0.5 * face)
      else if (face > -0.3) g.fillStyle(ROCK.mid, 0.55)
      else g.fillStyle(ROCK.edge, 0.3)
      g.fillPoints(pts, true)
      t += span
    }
    // A soft, off-centre highlight towards the light (keeps it reading as a lump of stone).
    const hl = at(Math.atan2(ly * ia, lx * ib), 0.35 + rnd() * 0.1)
    g.fillStyle(ROCK.light, 0.18)
    g.fillEllipse(hl.x, hl.y, ia * (0.7 + rnd() * 0.2), ib * (0.6 + rnd() * 0.2))
    // Speckles.
    const dots = Math.round((a + b) / 5)
    for (let d = 0; d < dots; d++) {
      const p = at(rnd() * Math.PI * 2, 0.1 + rnd() * 0.7)
      g.fillStyle(rnd() < 0.5 ? ROCK.crack : ROCK.light, 0.35)
      g.fillCircle(p.x, p.y, 0.8 + rnd() * 1.2)
    }
    // A few cracks, from just inside the edge inwards.
    g.lineStyle(Math.max(1.2, Math.min(a, b) * 0.05), ROCK.crack, 0.75)
    const cracks = 1 + Math.floor(rnd() * 2) + (Math.min(a, b) > 36 ? 1 : 0)
    for (let c = 0; c < cracks; c++) {
      const t0 = rnd() * Math.PI * 2
      const p0 = at(t0, 0.88)
      const p1 = at(t0 + 0.25, 0.55 + rnd() * 0.15)
      const p2 = at(t0 + (rnd() < 0.5 ? -0.1 : 0.4), 0.25 + rnd() * 0.2)
      g.beginPath()
      g.moveTo(p0.x, p0.y)
      g.lineTo(p1.x, p1.y)
      g.lineTo(p2.x, p2.y)
      g.strokePath()
    }
    // A thin lit lip just inside the outline, so the edge reads on a dark board.
    // Only on the lit side, fading round, so it reads as light on stone rather than a button's rim.
    const lip = ellipse(Math.max(1, ia - 0.6), Math.max(1, ib - 0.6))
    for (let i = 0; i < lip.length; i++) {
      const tt = ((i + 0.5) / lip.length) * Math.PI * 2
      const nx = Math.cos(tt) / ia
      const ny = Math.sin(tt) / ib
      const lit = (nx * lx + ny * ly) / Math.max(1e-6, Math.hypot(nx, ny))
      if (lit <= 0.05) continue
      const p = lip[i]
      const q = lip[(i + 1) % lip.length]
      g.lineStyle(1.3, ROCK.light, 0.6 * lit)
      g.lineBetween(p.x, p.y, q.x, q.y)
    }
    // Moss: leafy clumps on one side (more on smaller rocks), kept inside the outline.
    const side = rnd() * Math.PI * 2
    const clumps = Math.min(a, b) < 40 ? 4 + Math.floor(rnd() * 3) : 3
    for (let m = 0; m < clumps; m++) {
      const r = Math.max(2.5, Math.min(ia, ib, 34) * (0.12 + rnd() * 0.1))
      // Pull the clump in so its whole blob stays inside the inner ellipse.
      const reach = Math.max(0, 1 - (r * 1.1) / Math.min(ia, ib))
      const p = at(side + (rnd() - 0.5) * 1.2, Math.min(reach, 0.45 + rnd() * 0.4))
      g.fillStyle(ROCK.moss, 0.9)
      g.fillEllipse(p.x, p.y, r * 2, r * 1.5)
      g.fillStyle(ROCK.mossLight, 0.8)
      g.fillEllipse(p.x - r * 0.3, p.y - r * 0.3, r, r * 0.8)
    }
  }
}

/** A small seeded random (so a rock looks the same every time it's drawn). */
function seeded(seed: number): () => number {
  let s = (seed >>> 0) || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 100000) / 100000
  }
}
