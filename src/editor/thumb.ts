import { TUNING } from '../config/tuning'
import { cssHex, sideColor, theme } from '../config/theme'
import { boardFor } from '../levels/board'
import type { LevelDef } from '../types'
import { GLASS, ROCK, VOID_COLOURS, BRICK, PORTAL, portalColour } from '../config/obstacles'

/** Draws a small preview of a map onto a 2D canvas (My maps list). */
export function drawThumb(canvas: HTMLCanvasElement, level: LevelDef, width = 150): void {
  const b = boardFor(level)
  const height = Math.round((width * b.h) / b.w)
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const k = (width / b.w) * dpr
  ctx.setTransform(k, 0, 0, k, -b.x * k, -b.y * k)
  const px = 1 / (width / b.w) // one CSS pixel, in world units
  ctx.fillStyle = cssHex(theme.hud)
  ctx.fillRect(b.x, b.y, b.w, b.h)
  ctx.strokeStyle = cssHex(theme.boardEdge)
  ctx.lineWidth = 2 * px
  ctx.strokeRect(b.x + px, b.y + px, b.w - 2 * px, b.h - 2 * px)
  ctx.fillStyle = cssHex(theme.fan)
  ctx.globalAlpha = 0.18
  for (const f of level.fans) {
    ctx.beginPath()
    ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  for (const w of level.walls) {
    ctx.fillStyle = w.kind === 'void' ? cssHex(VOID_COLOURS.rim) : w.kind === 'breakable' ? cssHex(BRICK.base) : cssHex(theme.wall)
    ctx.save()
    ctx.translate(w.x + w.w / 2, w.y + w.h / 2)
    ctx.rotate(w.angle ?? 0)
    const t = Math.max(w.h, 2 * px)
    ctx.fillRect(-w.w / 2, -t / 2, w.w, t)
    ctx.restore()
  }
  ctx.fillStyle = cssHex(ROCK.base)
  for (const p of level.pillars ?? []) {
    ctx.beginPath()
    ctx.ellipse(p.x, p.y, Math.max(p.r, 2 * px), Math.max(p.ry ?? p.r, 2 * px), p.angle ?? 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.strokeStyle = cssHex(GLASS)
  ctx.lineWidth = Math.max(6, 2 * px)
  for (const g of level.glass ?? []) {
    ctx.beginPath()
    ctx.moveTo(g.x, g.y)
    ctx.lineTo(g.x2, g.y2)
    ctx.stroke()
  }
  ctx.lineWidth = Math.max(5, 1.6 * px)
  ;(level.portals ?? []).forEach((p, i) => {
    ctx.strokeStyle = cssHex(portalColour(i))
    for (const e of [p.a, p.b]) {
      ctx.beginPath()
      ctx.arc(e.x, e.y, Math.max(PORTAL.radius, 2.6 * px), 0, Math.PI * 2)
      ctx.stroke()
    }
  })
  const r = Math.max(TUNING.cannonRadius, 3.2 * px)
  for (const c of level.cannons) {
    ctx.fillStyle = cssHex(sideColor(c.side))
    ctx.beginPath()
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
    ctx.fill()
  }
}
