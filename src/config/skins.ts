import type { Side } from '../types'

/**
 * Cannon skins: a second "whose side" cue next to colour. A skin is only the
 * body's outline (and a little surface detail); the type stays on the barrel
 * and its badge, and the ownership ring stays a circle. A cannon wears the
 * skin of its CURRENT owner, so its shape flips with its ring on capture.
 * Neutrals are always grey Classic with no ring.
 *
 * Pure data and rules (the server uses them too); drawing is in
 * render/skinDraw.ts, the saved choice in menu/skinPref.ts.
 */
export const SKINS = ['classic', 'plated', 'spiked', 'hex'] as const
export type SkinId = (typeof SKINS)[number]

export const SKIN_LABEL: Record<SkinId, string> = {
  classic: 'Classic',
  plated: 'Plated',
  spiked: 'Spiked',
  hex: 'Hex',
}

/**
 * Your skin until you pick one: Plated. Neutrals are round (Classic), so a
 * round default would give your cannons and the unowned ones the same
 * shape; Plated (square) vs the AI's Spiked (star) is also the pairing that
 * stays clearest on a phone.
 */
export const DEFAULT_SKIN: SkinId = 'plated'

/**
 * The opponent's skin when yours is `mine`: the most different outline.
 * Round and hex are the closest pair, so they never face each other here.
 */
export const CONTRAST: Record<SkinId, SkinId> = {
  classic: 'spiked',
  plated: 'spiked',
  spiked: 'plated',
  hex: 'spiked',
}

export function isSkin(v: unknown): v is SkinId {
  return typeof v === 'string' && (SKINS as readonly string[]).includes(v)
}

/** The skins worn by each side in a round (neutral is always Classic). */
export type SideSkins = Record<Side, SkinId>

/** Playing the AI (or a puzzle): yours, and the contrasting one for pink. */
export function vsAiSkins(mine: SkinId): SideSkins {
  return { player: mine, enemy: CONTRAST[mine], neutral: 'classic' }
}

/**
 * Two players: each always wears their own pick, even the same one (name
 * tags tell them apart when their looks clash; see config/looks.ts). Only a
 * seat that sent no skin (an older game) gets one: the default for gold, the
 * contrast to gold's for pink. Deterministic, so the server and every client agree.
 */
export function pvpSkins(gold: SkinId | undefined, pink: SkinId | undefined): SideSkins {
  const g = gold ?? DEFAULT_SKIN
  return { player: g, enemy: pink ?? CONTRAST[g], neutral: 'classic' }
}

/** The same skins as seen from the other side (the second player's flipped view). */
export function flipSkins(s: SideSkins): SideSkins {
  return { player: s.enemy, enemy: s.player, neutral: 'classic' }
}

// ---- Shapes (world px; the cannon radius is 26). Shared by the board and the menu's SVG previews.

const poly = (n: number, r: number, start: number): { x: number; y: number }[] =>
  Array.from({ length: n }, (_, i) => ({ x: Math.cos(start + (i * 2 * Math.PI) / n) * r, y: Math.sin(start + (i * 2 * Math.PI) / n) * r }))

function star(points: number, outer: number, inner: number): { x: number; y: number }[] {
  return Array.from({ length: points * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / points
    const r = i % 2 ? inner : outer
    return { x: Math.cos(a) * r, y: Math.sin(a) * r }
  })
}

export const SKIN_SHAPE = {
  /** Plated: a rounded square, half-size `half`, corner radius `corner`, with rivets. */
  plated: { half: 20, corner: 6, rivet: 2.4, rivetInset: 4.5 },
  /** Spiked: a six-point star. */
  spiked: star(6, 26.5, 18),
  /** Hex: a flat-topped hexagon with a darker frame band and a body-coloured inner hex (bold at phone size). */
  hex: poly(6, 26, 0),
  hexInner: poly(6, 18.5, 0),
} as const
