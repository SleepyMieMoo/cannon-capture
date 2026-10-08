import type Phaser from 'phaser'

/**
 * The effects' textures, drawn once per game on small canvases (white, so
 * any tint works; glows are meant for additive blending). Sizes are the
 * textures' widths, for turning a size in world px into a scale.
 */
export const FX_TEX = ['fx-glow', 'fx-ring', 'fx-spark', 'fx-smoke', 'fx-plus', 'fx-chip'] as const
export const TEX = { glow: 0, ring: 1, spark: 2, smoke: 3, plus: 4, chip: 5 } as const
export const FX_TEX_W = [64, 128, 32, 32, 16, 8]
export const TRAIL_TEX = 'fx-trail'
export const TRAIL_W = 64
export const TRAIL_H = 8
export const HALO_TEX = 'fx-halo'
export const HALO_W = 128
export const SWEEP_TEX = 'fx-sweep'
export const SWEEP_W = 128

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void

function bake(textures: Phaser.Textures.TextureManager, key: string, w: number, h: number, draw: Draw): void {
  if (textures.exists(key)) return
  const tex = textures.createCanvas(key, w, h)
  if (!tex) return
  draw(tex.context, w, h)
  tex.refresh()
}

function radial(ctx: CanvasRenderingContext2D, w: number, stops: [number, number][]): void {
  const r = w / 2
  const g = ctx.createRadialGradient(r, r, 0, r, r, r)
  for (const [at, a] of stops) g.addColorStop(at, `rgba(255,255,255,${a})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, w)
}

/** Make every effects texture (once per game: the texture manager is shared by all scenes). */
export function bakeFxTextures(textures: Phaser.Textures.TextureManager): void {
  // A soft glow: bright middle, long gentle falloff to exactly nothing at the edge.
  bake(textures, 'fx-glow', 64, 64, (ctx, w) => radial(ctx, w, [[0, 1], [0.18, 0.78], [0.42, 0.32], [0.7, 0.08], [1, 0]]))
  // A shockwave ring: a thin bright band near the edge, soft on both sides.
  bake(textures, 'fx-ring', 128, 128, (ctx, w) => radial(ctx, w, [[0, 0], [0.7, 0], [0.86, 0.85], [0.92, 1], [0.97, 0.3], [1, 0]]))
  // A spark: a short soft streak (stretched along its flight).
  bake(textures, 'fx-spark', 32, 8, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.7, 'rgba(255,255,255,0.9)')
    g.addColorStop(1, 'rgba(255,255,255,0.4)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2 - 0.5, 0, 0, Math.PI * 2)
    ctx.fill()
  })
  // A puff of smoke: a few overlapping soft blobs (not a perfect disc).
  bake(textures, 'fx-smoke', 32, 32, (ctx) => {
    for (const [x, y, r, a] of [[16, 16, 13, 0.5], [11, 13, 8, 0.35], [21, 14, 8, 0.35], [15, 21, 9, 0.3]]) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, `rgba(255,255,255,${a})`)
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 32, 32)
    }
  })
  // A heal "+".
  bake(textures, 'fx-plus', 16, 16, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,1)'
    ctx.beginPath()
    ctx.roundRect(6, 1.5, 4, 13, 1.5)
    ctx.roundRect(1.5, 6, 13, 4, 1.5)
    ctx.fill()
  })
  // A debris chip.
  bake(textures, 'fx-chip', 8, 8, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,1)'
    ctx.beginPath()
    ctx.moveTo(1, 2)
    ctx.lineTo(7, 0.5)
    ctx.lineTo(6, 7.5)
    ctx.lineTo(0.5, 6)
    ctx.closePath()
    ctx.fill()
  })
  // A shot's trail: nothing at the tail, full at the head (the right edge), soft top and bottom.
  bake(textures, TRAIL_TEX, TRAIL_W, TRAIL_H, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.65, 'rgba(255,255,255,0.45)')
    g.addColorStop(1, 'rgba(255,255,255,1)')
    ctx.fillStyle = g
    ctx.fillRect(0, 1, w, h - 2)
    ctx.globalCompositeOperation = 'destination-in'
    const v = ctx.createLinearGradient(0, 0, 0, h)
    v.addColorStop(0, 'rgba(255,255,255,0)')
    v.addColorStop(0.5, 'rgba(255,255,255,1)')
    v.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = v
    ctx.fillRect(0, 0, w, h)
  })
  // An aura's slow-turning halo: a soft ring with three brighter lobes.
  bake(textures, HALO_TEX, HALO_W, HALO_W, (ctx, w) => {
    radial(ctx, w, [[0, 0], [0.42, 0], [0.62, 0.7], [0.82, 0.12], [1, 0]])
    const c = w / 2
    ctx.globalCompositeOperation = 'destination-in'
    if (typeof ctx.createConicGradient === 'function') {
      const g = ctx.createConicGradient(0, c, c)
      for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `rgba(255,255,255,${i % 2 ? 0.25 : 1})`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, w)
    }
  })
  // The end-of-round sweep: a soft vertical band (stretched to the board's height).
  bake(textures, SWEEP_TEX, SWEEP_W, 4, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.5, 'rgba(255,255,255,1)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  })
}
