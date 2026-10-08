/**
 * The newer obstacles' looks and editor sizes (kept free of Phaser so pure
 * code, tests and the server can read them).
 * - Void wall: a near-black purple slab with a faint violet rim; swallows shots.
 * - Pillar: a round stone; shots reflect off its surface normal.
 * - Glass: an icy pane (clearly not a team colour) with a bright solid rim;
 *   shots pass one way and bounce off the other.
 * - Breakable wall: old clay bricks (warmer and lighter than a plain wall)
 *   that crack as they take hits and crumble for good.
 */
export const VOID_COLOURS = { edge: 0x2a1840, fill: 0x0f0916, rim: 0x7a55b8, puff: 0x241433, spark: 0xb48cff } as const
export const GLASS = 0xcfe8ff
export const GLASS_RIM = 0xf2f9ff
/** Pillar radii the editor offers (Small, Medium, Large). */
export const PILLAR_SIZES = [18, 28, 44] as const
/**
 * Pillars are drawn as rocks (top-down): an irregular outline, faceted
 * stone and a little moss on the smaller ones, so they read as terrain and
 * never as a cannon, a neutral or a button.
 */
export const ROCK = {
  shadow: 0x0c0806,
  edge: 0x2b221c,
  base: 0x564638,
  mid: 0x6b5847,
  light: 0x8a7563,
  crack: 0x231b16,
  moss: 0x4f5d2c,
  mossLight: 0x6f7f3a,
} as const
/** Oval presets the editor offers: [half-width, half-height]. */
export const PILLAR_OVALS: readonly { name: string; r: number; ry: number }[] = [
  { name: 'Oval', r: 40, ry: 24 },
  { name: 'Long', r: 60, ry: 20 },
]
/** Breakable walls: clay bricks with dark mortar; cracks show the damage. */
export const BRICK = {
  edge: 0x3b2117,
  mortar: 0x4a2a1c,
  base: 0x9a5534,
  dark: 0x7d4228,
  light: 0xc07a4e,
  crack: 0x1a0d08,
  dust: 0xb58a68,
} as const
/** A breakable wall's crack stage for a health fraction: 0 whole, 1 cracked, 2 crumbling, 3 broken. */
export function crackStage(health: number): 0 | 1 | 2 | 3 {
  if (health <= 0) return 3
  if (health <= 1 / 3 + 1e-6) return 2
  if (health <= 2 / 3 + 1e-6) return 1
  return 0
}
