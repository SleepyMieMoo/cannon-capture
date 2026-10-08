import type Phaser from 'phaser'
import { sideColor } from '../config/theme'
import { TUNING } from '../config/tuning'
import type { Shot } from '../entities/Shot'

/**
 * Shared battle drawing: shots in flight, dashed aim lines and crosshairs.
 * Used by the battle scene and by the art renderer (art/, scripts/render-art.mjs),
 * so the store art is drawn exactly like the game.
 */

/**
 * Shots in flight. `trail` (px) adds a longer fading tail to normal shots, for
 * stills; `alpha` draws them that share of the way through the current step.
 */
export function drawShots(g: Phaser.GameObjects.Graphics, shots: readonly Shot[], trail = 0, alpha = 1): void {
  for (const shot of shots) {
    // Drawn `alpha` of the way from where it was a step ago to where it is now (smooth between fixed steps).
    const x = alpha >= 1 ? shot.ball.x : shot.prevX + (shot.ball.x - shot.prevX) * alpha
    const y = alpha >= 1 ? shot.ball.y : shot.prevY + (shot.ball.y - shot.prevY) * alpha
    const color = sideColor(shot.side)
    if (shot.kind === 'machinegun') {
      // Machine gun round: a small, short tracer (cheap to draw, there are lots).
      const { vx, vy } = shot.ball
      const v = Math.hypot(vx, vy) || 1
      const tx = x - (vx / v) * 11
      const ty = y - (vy / v) * 11
      g.lineStyle(5, color, 0.95)
      g.lineBetween(tx, ty, x, y)
      g.lineStyle(2, 0xffffff, 0.8)
      g.lineBetween(tx + (vx / v) * 5, ty + (vy / v) * 5, x, y)
      continue
    }
    if (shot.kind === 'sniper') {
      // Sniper round: a long, thin streak and a smaller, brighter head.
      const { vx, vy } = shot.ball
      const v = Math.hypot(vx, vy) || 1
      const len = 46
      g.lineStyle(TUNING.shotRadius * 0.9, color, 0.32)
      g.beginPath()
      g.moveTo(x - (vx / v) * len, y - (vy / v) * len)
      g.lineTo(x, y)
      g.strokePath()
      g.lineStyle(2, 0xffffff, 0.5)
      g.beginPath()
      g.moveTo(x - (vx / v) * len * 0.5, y - (vy / v) * len * 0.5)
      g.lineTo(x, y)
      g.strokePath()
      g.fillStyle(color, 1)
      g.fillCircle(x, y, TUNING.shotRadius * 0.8)
      g.fillStyle(0xffffff, 0.95)
      g.fillCircle(x, y, 2.2)
      continue
    }
    if (trail > 0) {
      // Stills only (cover art): a longer fading tail along the flight path.
      const { vx, vy } = shot.ball
      const v = Math.hypot(vx, vy) || 1
      for (let i = 3; i >= 1; i--) {
        g.lineStyle(TUNING.shotRadius * (1.9 - i * 0.3), color, 0.34 - i * 0.08)
        g.lineBetween(x - (vx / v) * trail * (i / 3), y - (vy / v) * trail * (i / 3), x, y)
      }
    }
    g.lineStyle(TUNING.shotRadius * 1.6, color, 0.28)
    g.beginPath()
    g.moveTo(shot.prevX, shot.prevY)
    g.lineTo(x, y)
    g.strokePath()
    g.fillStyle(color, 1)
    g.fillCircle(x, y, TUNING.shotRadius)
    g.fillStyle(0xffffff, 0.85)
    g.fillCircle(x, y, 2.4)
  }
}

export function crosshair(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number, alpha: number): void {
  g.lineStyle(2, color, Math.min(1, alpha))
  g.strokeCircle(x, y, r)
  g.beginPath()
  g.moveTo(x - r - 5, y)
  g.lineTo(x - r + 4, y)
  g.moveTo(x + r - 4, y)
  g.lineTo(x + r + 5, y)
  g.moveTo(x, y - r - 5)
  g.lineTo(x, y - r + 4)
  g.moveTo(x, y + r - 4)
  g.lineTo(x, y + r + 5)
  g.strokePath()
}

export function dash(
  g: Phaser.GameObjects.Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  startInset: number,
  endInset: number,
  color: number,
  alpha: number,
): void {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (len < startInset + endInset) return
  const ux = dx / len
  const uy = dy / len
  g.lineStyle(2, color, alpha)
  let traveled = startInset
  const end = len - endInset
  while (traveled < end) {
    const next = Math.min(traveled + 10, end)
    g.beginPath()
    g.moveTo(x1 + ux * traveled, y1 + uy * traveled)
    g.lineTo(x1 + ux * next, y1 + uy * next)
    g.strokePath()
    traveled = next + 8
  }
}
