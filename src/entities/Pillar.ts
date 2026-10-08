import Phaser from 'phaser'
import { ROCK } from '../config/obstacles'
import type { PillarDef } from '../types'

/** Points round the outline (more on bigger rocks). */
const POINTS = 20

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
    // A wobbly outline: each point 90-101% out, smoothed so it reads as stone, not a star.
    const raw = Array.from({ length: POINTS }, () => 0.9 + rnd() * 0.11)
    const k = raw.map((v, i) => (raw[(i + POINTS - 1) % POINTS] + 2 * v + raw[(i + 1) % POINTS]) / 4)
    /** A point at outline fraction `i`, scaled by `s`, shifted by (ox, oy) in the rock's own frame. */
    const at = (i: number, s: number, ox = 0, oy = 0): Phaser.Math.Vector2 => {
      const t = (i / POINTS) * Math.PI * 2
      const lx = Math.cos(t) * a * k[i % POINTS] * s + ox
      const ly = Math.sin(t) * b * k[i % POINTS] * s + oy
      return new Phaser.Math.Vector2(x + lx * cos - ly * sin, y + lx * sin + ly * cos)
    }
    const ring = (s: number, ox = 0, oy = 0) => Array.from({ length: POINTS }, (_, i) => at(i, s, ox, oy))
    const g = this.gfx
    g.clear()
    // Shadow, down-right in screen space.
    g.fillStyle(ROCK.shadow, 0.45)
    g.fillPoints(ring(1.02).map((p) => new Phaser.Math.Vector2(p.x + 3, p.y + 4)), true)
    // The stone.
    g.fillStyle(ROCK.edge, 1)
    g.fillPoints(ring(1), true)
    g.fillStyle(ROCK.base, 1)
    g.fillPoints(ring(0.88), true)
    // Lit facets towards the top-left (the light is fixed in screen space, so undo the turn).
    const lx = -0.16 * cos - 0.18 * sin
    const ly = 0.16 * sin - 0.18 * cos
    g.fillStyle(ROCK.mid, 1)
    g.fillPoints(ring(0.66, lx * a, ly * b), true)
    g.fillStyle(ROCK.light, 0.55)
    g.fillPoints(facet(ring(0.4, lx * a * 1.8, ly * b * 1.8), rnd), true)
    // A few cracks.
    g.lineStyle(Math.max(1.2, Math.min(a, b) * 0.06), ROCK.crack, 0.75)
    const cracks = 2 + Math.floor(rnd() * 2)
    for (let c = 0; c < cracks; c++) {
      const i = Math.floor(rnd() * POINTS)
      const p0 = at(i, 0.9)
      const p1 = at(i + 1, 0.55 + rnd() * 0.15)
      const p2 = at(i + (rnd() < 0.5 ? 0 : 2), 0.25 + rnd() * 0.2)
      g.beginPath()
      g.moveTo(p0.x, p0.y)
      g.lineTo(p1.x, p1.y)
      g.lineTo(p2.x, p2.y)
      g.strokePath()
    }
    // Moss on the smaller rocks: a few leafy clumps on one side.
    if (Math.min(a, b) < 40) {
      const side = Math.floor(rnd() * POINTS)
      const clumps = 4 + Math.floor(rnd() * 3)
      for (let m = 0; m < clumps; m++) {
        const p = at(side + Math.floor((rnd() - 0.5) * 5), 0.55 + rnd() * 0.3)
        const s = Math.max(2.5, Math.min(a, b) * (0.12 + rnd() * 0.1))
        g.fillStyle(ROCK.moss, 0.9)
        g.fillEllipse(p.x, p.y, s * 2, s * 1.5)
        g.fillStyle(ROCK.mossLight, 0.8)
        g.fillEllipse(p.x - s * 0.3, p.y - s * 0.3, s, s * 0.8)
      }
    }
  }
}

/** Knock a few points of a ring inwards, for an angular, chipped facet. */
function facet(points: Phaser.Math.Vector2[], rnd: () => number): Phaser.Math.Vector2[] {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  return points.filter((_, i) => i % 2 === 0).map((p) => {
    const k = 0.75 + rnd() * 0.3
    return new Phaser.Math.Vector2(cx + (p.x - cx) * k, cy + (p.y - cy) * k)
  })
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
