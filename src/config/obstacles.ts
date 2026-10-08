/**
 * The newer obstacles' looks and editor sizes (kept free of Phaser so pure
 * code, tests and the server can read them).
 * - Void wall: a near-black purple slab with a faint violet rim; swallows shots.
 * - Pillar: a round stone; shots reflect off its surface normal.
 * - Glass: an icy pane (clearly not a team colour) with a bright solid rim;
 *   shots pass one way and bounce off the other.
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
