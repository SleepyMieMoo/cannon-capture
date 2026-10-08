import type { CannonDef, LevelDef } from '../types'

/**
 * Example battle boards for the newer obstacles (not campaign levels). Both
 * are Small and mirrored left/right, so either side is fair: Play vs AI and
 * online list them, the title demo cycles them, and the editor opens them
 * (Map → Open example).
 */

/** The board's centre line on Small (x = 24 + 1152 / 2). */
const MID = 600

/** Gold's cannons as given, pink's mirrored across the centre line. */
function mirrorCannons(player: CannonDef[], neutral: CannonDef[]): CannonDef[] {
  const enemy = player.map((c, i) => ({
    ...c,
    id: `e${i + 1}`,
    name: `E${i + 1}`,
    x: 2 * MID - c.x,
    side: 'enemy' as const,
    aimAt: c.aimAt ? mirrorId(c.aimAt, neutral) : undefined,
  }))
  return [...player, ...neutral, ...enemy]
}

/** Neutrals come in mirrored pairs listed left then right (n1/n2, n3/n4, ...); a centred one maps to itself. */
function mirrorId(id: string, neutral: CannonDef[]): string {
  const c = neutral.find((n) => n.id === id)
  if (!c) return id
  const twin = neutral.find((n) => n !== c && Math.abs(n.x - (2 * MID - c.x)) < 1 && Math.abs(n.y - c.y) < 1)
  return twin?.id ?? id
}

/**
 * Glass Garden: round pillars to bank off, and two one-way panes. Each pane
 * guards one side's near neutral: your shots pass out through it, the other
 * side's bounce back, so to take it they must bank over or under the glass.
 */
export const GLASS_GARDEN: LevelDef = {
  id: 'ex-glass-garden',
  name: 'Glass Garden',
  kind: 'battle',
  size: 'small',
  cannons: mirrorCannons(
    [
      { id: 'p1', name: 'P1', x: 140, y: 210, side: 'player', aimAt: 'n1' },
      { id: 'p2', name: 'P2', x: 120, y: 392, side: 'player', aimAt: 'n3' },
      { id: 'p3', name: 'P3', x: 140, y: 574, side: 'player', aimAt: 'n5' },
    ],
    [
      { id: 'n1', name: 'N1', x: 560, y: 186, side: 'neutral' },
      { id: 'n2', name: 'N2', x: 640, y: 186, side: 'neutral' },
      { id: 'n3', name: 'N3', x: 420, y: 392, side: 'neutral' },
      { id: 'n4', name: 'N4', x: 780, y: 392, side: 'neutral' },
      { id: 'n5', name: 'N5', x: 560, y: 598, side: 'neutral' },
      { id: 'n6', name: 'N6', x: 640, y: 598, side: 'neutral' },
    ],
  ),
  walls: [],
  fans: [],
  pillars: [
    { x: 600, y: 392, r: 44 },
    { x: 330, y: 254, r: 28 },
    { x: 870, y: 254, r: 28 },
    { x: 330, y: 530, r: 28 },
    { x: 870, y: 530, r: 28 },
  ],
  glass: [
    // Solid side faces right (pink's shots bounce), open side left (gold's pass).
    { x: 500, y: 460, x2: 500, y2: 324 },
    // The mirror image: solid side faces left.
    { x: 700, y: 324, x2: 700, y2: 460 },
  ],
}

/**
 * Void Gate: a void wall splits the middle and swallows anything straight
 * through it. Round pillars beside it and plain walls above and below give
 * the bank shots that get around.
 */
export const VOID_GATE: LevelDef = {
  id: 'ex-void-gate',
  name: 'Void Gate',
  kind: 'battle',
  size: 'small',
  cannons: mirrorCannons(
    [
      { id: 'p1', name: 'P1', x: 140, y: 190, side: 'player', aimAt: 'n1' },
      { id: 'p2', name: 'P2', x: 160, y: 392, side: 'player', aimAt: 'n1' },
      { id: 'p3', name: 'P3', x: 140, y: 594, side: 'player', aimAt: 'n3' },
    ],
    [
      { id: 'n1', name: 'N1', x: 430, y: 210, side: 'neutral' },
      { id: 'n2', name: 'N2', x: 770, y: 210, side: 'neutral' },
      { id: 'n3', name: 'N3', x: 430, y: 574, side: 'neutral' },
      { id: 'n4', name: 'N4', x: 770, y: 574, side: 'neutral' },
      { id: 'n5', name: 'N5', x: 600, y: 136, side: 'neutral' },
      { id: 'n6', name: 'N6', x: 600, y: 648, side: 'neutral' },
    ],
  ),
  walls: [
    { x: 588, y: 282, w: 24, h: 220, kind: 'void' },
    { x: 250, y: 380, w: 90, h: 24, kind: 'void' },
    { x: 860, y: 380, w: 90, h: 24, kind: 'void' },
    { x: 530, y: 220, w: 140, h: 22 },
    { x: 530, y: 542, w: 140, h: 22 },
  ],
  fans: [],
  pillars: [
    { x: 430, y: 392, r: 28 },
    { x: 770, y: 392, r: 28 },
  ],
}

export const EXAMPLE_MAPS: LevelDef[] = [GLASS_GARDEN, VOID_GATE]
