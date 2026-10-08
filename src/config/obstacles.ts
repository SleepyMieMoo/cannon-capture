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
