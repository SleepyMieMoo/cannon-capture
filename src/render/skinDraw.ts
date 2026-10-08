import type Phaser from 'phaser'
import { TUNING } from '../config/tuning'
import { shade } from '../config/theme'
import { SKIN_SHAPE, type SkinId } from '../config/skins'

type Pts = Phaser.Types.Math.Vector2Like[]
const spiked = SKIN_SHAPE.spiked as unknown as Pts
const hex = SKIN_SHAPE.hex as unknown as Pts
const hexInner = SKIN_SHAPE.hexInner as unknown as Pts

/**
 * A cannon's body in its skin's outline, in `color` (the capture tint is
 * already in it). Uses only the precomputed shapes: nothing is allocated.
 */
export function drawSkinBody(g: Phaser.GameObjects.Graphics, skin: SkinId, color: number): void {
  const r = TUNING.cannonRadius
  if (skin === 'plated') {
    const { half: s, corner, rivet, rivetInset } = SKIN_SHAPE.plated
    g.fillStyle(color, 1)
    g.fillRoundedRect(-s, -s, 2 * s, 2 * s, corner)
    g.fillStyle(0xffffff, 0.2)
    g.fillRoundedRect(-s + 4, -s + 4, s * 0.95, s * 0.55, 4)
    g.lineStyle(3, 0x000000, 0.3)
    g.strokeRoundedRect(-s, -s, 2 * s, 2 * s, corner)
    g.fillStyle(shade(color, 0.45), 0.9)
    const k = s - rivetInset
    g.fillCircle(-k, -k, rivet)
    g.fillCircle(k, -k, rivet)
    g.fillCircle(-k, k, rivet)
    g.fillCircle(k, k, rivet)
    return
  }
  if (skin === 'spiked') {
    g.fillStyle(color, 1)
    g.fillPoints(spiked, true, true)
    g.fillStyle(0xffffff, 0.2)
    g.fillCircle(-5, -6, r * 0.36)
    g.lineStyle(2.5, 0x000000, 0.3)
    g.strokePoints(spiked, true, true)
    return
  }
  if (skin === 'hex') {
    // A darker frame with a body-coloured hex inside: two sets of straight edges read as "hex" even small.
    g.fillStyle(shade(color, 0.66), 1)
    g.fillPoints(hex, true, true)
    g.fillStyle(color, 1)
    g.fillPoints(hexInner, true, true)
    g.fillStyle(0xffffff, 0.2)
    g.fillCircle(-5, -6, r * 0.3)
    g.lineStyle(3, 0x000000, 0.35)
    g.strokePoints(hex, true, true)
    g.lineStyle(1.5, 0x000000, 0.22)
    g.strokePoints(hexInner, true, true)
    return
  }
  g.fillStyle(color, 1)
  g.fillCircle(0, 0, r)
  g.fillStyle(0xffffff, 0.2)
  g.fillCircle(-6, -7, r * 0.42)
  g.lineStyle(3, 0x000000, 0.28)
  g.strokeCircle(0, 0, r)
}
