import type Phaser from 'phaser'
import { theme } from '../config/theme'

/** At most this many segments on a bar; past that, notches mark groups of hits. */
export const HP_BAR_MAX_SEGMENTS = 8

/**
 * Hits per notch for a bar of `max` hit points: 1 when they fit, otherwise
 * the smallest friendly group (2, 3, 4, 5, 10…) that keeps it to a few segments.
 */
export function notchStep(max: number): number {
  for (const step of [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 50]) if (max / step <= HP_BAR_MAX_SEGMENTS) return step
  return Math.ceil(max / HP_BAR_MAX_SEGMENTS)
}

/**
 * A small health bar along +x from (x, y): dark edge, the fill from the left,
 * and a notch every `notchStep(max)` hits (none when `max` < 2). Shared by the
 * shield's bar and breakable walls, so they read alike.
 */
export function drawHpBar(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, fill: number, color: number, alpha: number, max: number): void {
  const f = Math.max(0, Math.min(1, fill))
  g.fillStyle(theme.ringEdge, 0.9)
  g.fillRoundedRect(x - 1.5, y - 1.5, w + 3, h + 3, (h + 3) / 2)
  g.fillStyle(0x000000, 0.35)
  g.fillRoundedRect(x, y, w, h, h / 2)
  if (f > 0) {
    g.fillStyle(color, alpha)
    g.fillRoundedRect(x, y, Math.max(h, w * f), h, h / 2)
  }
  if (max < 2) return
  const step = notchStep(max)
  g.fillStyle(theme.ringEdge, 0.9)
  for (let hp = step; hp < max; hp += step) g.fillRect(x + (w * hp) / max - 0.6, y, 1.2, h)
}
