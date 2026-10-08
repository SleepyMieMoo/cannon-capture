import type Phaser from 'phaser'
import { lerpColor, theme } from '../config/theme'
import { TEAM_COLOUR, compatible, type SideColours } from '../config/teamColours'
import type { Rect, Side } from '../types'

/**
 * Side glow: each team's side of the board gets a soft wash of its colour
 * from its edge, fading to nothing a quarter of the way across. It sits on
 * the board (over the dot grid) and under walls, fans and cannons.
 *
 * When the two team colours clash (they fail the compat matrix: the colour
 * part of the name-tag rule), the enemy side glows red instead (the enemy
 * ring's red, softened), so "my side / their side" still reads. Watchers'
 * enemy side is the pink seat's, matching their red name tags and rings.
 *
 * Each side is one canvas texture drawn once (again only when its colour
 * changes) and shown as one image: nothing happens per frame.
 */
export const GLOW = {
  /** Opacity at the edge (it falls off smoothly to 0). */
  alpha: 0.2,
  /** How far it reaches, as a share of the board width. */
  reach: 0.25,
  /** The board's corner radius (render/boardSurface.ts), so the glow keeps to the rounded panel. */
  radius: 18,
  depth: 0.5,
  /** The glow texture is drawn at most this many px tall (it is scaled up: a gradient has no detail to lose). */
  maxTexPx: 360,
}

export type Edge = 'left' | 'right'

/**
 * Which edge is each side's home, from where its cannons start: the side
 * whose cannons sit further left gets the left edge. A side with no cannons
 * gets no glow; a lone side (a puzzle) gets the edge nearer its cannons.
 */
export function glowEdges(cannons: readonly { x: number; side: Side }[], board: Rect): Record<'player' | 'enemy', Edge | null> {
  const mean = (side: Side): number | null => {
    let n = 0
    let sum = 0
    for (const c of cannons)
      if (c.side === side) {
        n++
        sum += c.x
      }
    return n ? sum / n : null
  }
  const p = mean('player')
  const e = mean('enemy')
  const mid = board.x + board.w / 2
  if (p !== null && e !== null) {
    const pLeft = p < e || (p === e && p <= mid)
    return { player: pLeft ? 'left' : 'right', enemy: pLeft ? 'right' : 'left' }
  }
  return { player: p === null ? null : p <= mid ? 'left' : 'right', enemy: e === null ? null : e <= mid ? 'left' : 'right' }
}

/** The red the enemy side glows when the colours clash: the enemy ring's, a touch lighter so it glows rather than stains. */
export const CLASH_GLOW = lerpColor(theme.ringEnemy, 0xff6a5a, 0.35)

/** Each side's glow colour in this view: its team colour, or red for the enemy when the two clash. */
export function glowColours(c: SideColours): Record<'player' | 'enemy', number> {
  return {
    player: TEAM_COLOUR[c.player].hex,
    enemy: compatible(c.player, c.enemy) ? TEAM_COLOUR[c.enemy].hex : CLASH_GLOW,
  }
}

/** Opacity at `t` (0 at the edge, 1 at the far end of the glow): eases out to exactly 0. */
export function glowAlpha(t: number, alpha = GLOW.alpha): number {
  const u = Math.min(1, Math.max(0, 1 - t))
  return alpha * u * u
}

let serial = 0
/** How dim the glow rests between bars while it pulses to the music. */
const BREATHE_REST = 0.8

export class SideGlow {
  private readonly parts: { edge: Edge; key: string; tex: Phaser.Textures.CanvasTexture; img: Phaser.GameObjects.Image; colour: number | null }[] = []
  private readonly id = ++serial

  constructor(
    private readonly scene: Phaser.Scene,
    board: Rect,
    edges: Record<'player' | 'enemy', Edge | null>,
    private readonly alpha: number = GLOW.alpha,
  ) {
    // Inside the board's 2 px edge line.
    const x0 = board.x + 1
    const y0 = board.y + 1
    const h = board.h - 2
    const w = Math.round(board.w * GLOW.reach)
    const s = Math.max(1, h / GLOW.maxTexPx)
    const cw = Math.max(8, Math.ceil(w / s))
    const ch = Math.max(8, Math.ceil(h / s))
    for (const side of ['player', 'enemy'] as const) {
      const edge = edges[side]
      if (!edge) {
        this.parts.push(null as never)
        continue
      }
      const key = `side-glow-${this.id}-${side}`
      if (scene.textures.exists(key)) scene.textures.remove(key)
      const tex = scene.textures.createCanvas(key, cw, ch)!
      const img = scene.add
        .image(edge === 'left' ? x0 : x0 + board.w - 2 - w, y0, key)
        .setOrigin(0, 0)
        .setDisplaySize(w, h)
        .setDepth(GLOW.depth)
      this.parts.push({ edge, key, tex, img, colour: null })
    }
    scene.events.once('shutdown', () => this.destroy())
  }

  private shown = 1

  /**
   * Breathe with the music: while the beat clock is live the glow rests a
   * touch dimmer and swells back to full on each bar's first beat (`level`
   * 0..1). Not pulsing: as drawn. Cheap enough for every frame.
   */
  breathe(pulsing: boolean, level: number): void {
    const a = pulsing ? BREATHE_REST + (1 - BREATHE_REST) * level : 1
    if (Math.abs(a - this.shown) < 0.004) return
    this.shown = a
    for (const p of this.parts) if (p) p.img.setAlpha(a)
  }

  /** Every glow image (to hand to a camera). */
  get images(): Phaser.GameObjects.Image[] {
    return this.parts.filter(Boolean).map((p) => p.img)
  }

  /** Colour the glows ('player' is this view's own side). Redraws only a side whose colour changed. */
  paint(colours: Record<'player' | 'enemy', number>): void {
    const sides = ['player', 'enemy'] as const
    for (let i = 0; i < 2; i++) {
      const part = this.parts[i]
      if (!part || part.colour === colours[sides[i]]) continue
      part.colour = colours[sides[i]]
      this.draw(part.tex, part.edge, part.colour)
    }
  }

  private draw(tex: Phaser.Textures.CanvasTexture, edge: Edge, colour: number): void {
    const ctx = tex.context
    const { width: cw, height: ch } = tex
    const r = Math.min(cw / 2, ch / 2, (GLOW.radius - 1) * (ch / Math.max(1, this.scaleH(tex))))
    ctx.clearRect(0, 0, cw, ch)
    ctx.save()
    // The board's rounded corners on the glowing edge only.
    ctx.beginPath()
    if (edge === 'left') {
      ctx.moveTo(cw, 0)
      ctx.lineTo(r, 0)
      ctx.arcTo(0, 0, 0, r, r)
      ctx.lineTo(0, ch - r)
      ctx.arcTo(0, ch, r, ch, r)
      ctx.lineTo(cw, ch)
    } else {
      ctx.moveTo(0, 0)
      ctx.lineTo(cw - r, 0)
      ctx.arcTo(cw, 0, cw, r, r)
      ctx.lineTo(cw, ch - r)
      ctx.arcTo(cw, ch, cw - r, ch, r)
      ctx.lineTo(0, ch)
    }
    ctx.closePath()
    ctx.clip()
    const g = edge === 'left' ? ctx.createLinearGradient(0, 0, cw, 0) : ctx.createLinearGradient(cw, 0, 0, 0)
    const rr = (colour >> 16) & 255
    const gg = (colour >> 8) & 255
    const bb = colour & 255
    for (let i = 0; i <= 10; i++) g.addColorStop(i / 10, `rgba(${rr},${gg},${bb},${glowAlpha(i / 10, this.alpha).toFixed(4)})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, cw, ch)
    ctx.restore()
    tex.refresh()
  }

  /** The glow's height in world px for this texture (to scale the corner radius). */
  private scaleH(tex: Phaser.Textures.CanvasTexture): number {
    const img = this.parts.find((p) => p && p.tex === tex)?.img
    return img ? img.displayHeight : tex.height
  }

  destroy(): void {
    for (const p of this.parts) {
      if (!p) continue
      p.img.destroy()
      if (this.scene.textures.exists(p.key)) this.scene.textures.remove(p.key)
    }
    this.parts.length = 0
  }
}
