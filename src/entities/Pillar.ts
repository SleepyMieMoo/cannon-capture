import Phaser from 'phaser'
import { ROCK } from '../config/obstacles'
import type { PillarDef } from '../types'

/** Most corners round the outline (bigger rocks get more). */
const POINTS = 16

/**
 * A pillar seen from above, drawn as a rock: an irregular outline with a
 * drop shadow, lighter facets towards the top-left, a few cracks, and moss
 * on the smaller ones. The outline wobbles a little *inside* the collider,
 * so shots never seem to bounce off thin air. Round or oval (see PillarDef).
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
    const cos = Math.cos(this.def.angle ?? 0)
    const sin = Math.sin(this.def.angle ?? 0)
    const rnd = seeded(Math.round(x) * 73856093 ^ Math.round(y) * 19349663 ^ Math.round(a * 7 + b * 13))
    // A low-poly, chipped outline (angular, like stone): each point 86-100% out.
    const n = Math.max(9, Math.min(POINTS, Math.round((a + b) / 6)))
    const k = Array.from({ length: n }, () => 0.86 + rnd() * 0.14)
    /** A point `s` of the way out towards outline corner `i`, in world space. */
    const at = (i: number, s: number): Phaser.Math.Vector2 => {
      const j = ((i % n) + n) % n
      const t = (j / n) * Math.PI * 2
      // Between corners (a fractional `i`), along the straight edge's reach.
      const j0 = Math.floor(j)
      const f = j - j0
      const kk = k[j0] * (1 - f) + k[(j0 + 1) % n] * f
      const lx = Math.cos(t) * a * kk * s
      const ly = Math.sin(t) * b * kk * s
      return new Phaser.Math.Vector2(x + lx * cos - ly * sin, y + lx * sin + ly * cos)
    }
    const ring = (s: number) => Array.from({ length: n }, (_, i) => at(i, s))
    const g = this.gfx
    g.clear()
    // Shadow, down-right in screen space.
    g.fillStyle(ROCK.shadow, 0.45)
    g.fillPoints(ring(1.02).map((p) => new Phaser.Math.Vector2(p.x + 3, p.y + 4)), true)
    // The stone.
    g.fillStyle(ROCK.edge, 1)
    g.fillPoints(ring(1), true)
    g.fillStyle(ROCK.base, 1)
    g.fillPoints(ring(0.86), true)
    // Facets: flat plates from an off-centre ridge out to the edge, shaded by which way they face
    // (the light comes from the top-left of the screen).
    const ridge = new Phaser.Math.Vector2(x + (rnd() - 0.5) * a * 0.3, y + (rnd() - 0.5) * b * 0.3)
    let i = Math.floor(rnd() * n)
    const end = i + n
    while (i < end) {
      const span = 2 + Math.floor(rnd() * 2)
      const pts = [ridge]
      for (let j = i; j <= Math.min(i + span, end); j++) pts.push(at(j, 0.84))
      const mid = at(i + span / 2, 1)
      const face = ((mid.x - x) * -0.7 + (mid.y - y) * -0.7) / Math.max(1, Math.hypot(mid.x - x, mid.y - y))
      if (face > 0.25) g.fillStyle(ROCK.light, 0.55 * face)
      else if (face > -0.3) g.fillStyle(ROCK.mid, 0.6)
      else g.fillStyle(ROCK.edge, 0.35)
      g.fillPoints(pts, true)
      i += span
    }
    // Speckles.
    const dots = Math.round((a + b) / 5)
    for (let d = 0; d < dots; d++) {
      const p = at(Math.floor(rnd() * n), 0.15 + rnd() * 0.65)
      g.fillStyle(rnd() < 0.5 ? ROCK.crack : ROCK.light, 0.35)
      g.fillCircle(p.x, p.y, 0.8 + rnd() * 1.2)
    }
    // A few cracks.
    g.lineStyle(Math.max(1.2, Math.min(a, b) * 0.05), ROCK.crack, 0.75)
    const cracks = 1 + Math.floor(rnd() * 2) + (Math.min(a, b) > 36 ? 1 : 0)
    for (let c = 0; c < cracks; c++) {
      const i0 = Math.floor(rnd() * n)
      const p0 = at(i0, 0.86)
      const p1 = at(i0 + 0.5, 0.55 + rnd() * 0.15)
      const p2 = at(i0 + (rnd() < 0.5 ? 0 : 1), 0.25 + rnd() * 0.2)
      g.beginPath()
      g.moveTo(p0.x, p0.y)
      g.lineTo(p1.x, p1.y)
      g.lineTo(p2.x, p2.y)
      g.strokePath()
    }
    // Moss: leafy clumps on one side (more on smaller rocks).
    const side = Math.floor(rnd() * n)
    const clumps = Math.min(a, b) < 40 ? 4 + Math.floor(rnd() * 3) : 3
    for (let m = 0; m < clumps; m++) {
      const p = at(side + (rnd() - 0.5) * 2.5, 0.5 + rnd() * 0.35)
      const r = Math.max(2.5, Math.min(a, b, 34) * (0.12 + rnd() * 0.1))
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
