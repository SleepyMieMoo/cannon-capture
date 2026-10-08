import type { Side } from '../types'

/**
 * Team colours: eight presets for a side's cannons, shots and capture tint
 * (no free picker, so every pairing can be checked here). Gold is yours
 * until you pick another; strawberry pink is the AI's. The opponent always
 * wears one that contrasts with yours.
 *
 * The ownership rings do NOT follow the team colour: light gold-white is
 * always yours and deep red always the enemy's (config/theme.ts).
 *
 * Pure data and rules (the server uses them too); the board reads the
 * round's colours through theme.ts (setTeamColours / sideColor), the saved
 * choice is in menu/colourPref.ts.
 */
export const TEAM_COLOURS = ['gold', 'strawberry', 'tangerine', 'peach', 'lime', 'sky', 'blueberry', 'grape'] as const
export type TeamColourId = (typeof TEAM_COLOURS)[number]

/**
 * Two brightness bands, so any pair the auto-pick makes differs in
 * lightness too (it survives greyscale and colour blindness, not only hue):
 * light (OKLab L 0.80–0.87: gold, peach, lime, sky) and mid (L 0.68–0.73:
 * strawberry, tangerine, blueberry, grape). All sit well above the dark
 * board (L 0.21) and away from the warm grey neutrals (L 0.63). No
 * mint/teal (the fans are mint), no near-white (the hit flash goes white),
 * no red (the enemy's ownership ring is red).
 */
export const TEAM_COLOUR: Record<TeamColourId, { label: string; hex: number }> = {
  gold: { label: 'Gold', hex: 0xffc800 },
  strawberry: { label: 'Strawberry', hex: 0xf2637e },
  tangerine: { label: 'Tangerine', hex: 0xff7f24 },
  peach: { label: 'Peach', hex: 0xffbc94 },
  lime: { label: 'Lime', hex: 0xb8e655 },
  sky: { label: 'Sky', hex: 0x86cbff },
  blueberry: { label: 'Blueberry', hex: 0x5b9dff },
  grape: { label: 'Grape', hex: 0xb48cff },
}

/** Yours until you pick one (the game's gold). */
export const DEFAULT_COLOUR: TeamColourId = 'gold'
/** The AI's own colour, whenever it contrasts comfortably with yours. */
export const AI_COLOUR: TeamColourId = 'strawberry'

export function isTeamColour(v: unknown): v is TeamColourId {
  return typeof v === 'string' && (TEAM_COLOURS as readonly string[]).includes(v)
}

// ---- How different two colours look, in normal vision and simulated colour blindness.

/** Normal vision, the three full dichromacies (Machado et al. 2009, severity 1) and plain greyscale (lightness only). */
export const VISIONS = ['normal', 'protan', 'deutan', 'tritan', 'grey'] as const
export type Vision = (typeof VISIONS)[number]

type Mat = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]
const CVD: Record<'protan' | 'deutan' | 'tritan', Mat> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
}

const toLinear = (c: number): number => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/** OKLab [L, a, b] of an sRGB colour as seen in `vision` (greyscale keeps only L). */
export function oklab(color: number, vision: Vision = 'normal'): [number, number, number] {
  let r = toLinear((color >> 16) & 255)
  let g = toLinear((color >> 8) & 255)
  let b = toLinear(color & 255)
  if (vision === 'protan' || vision === 'deutan' || vision === 'tritan') {
    const m = CVD[vision]
    ;[r, g, b] = [clamp01(m[0][0] * r + m[0][1] * g + m[0][2] * b), clamp01(m[1][0] * r + m[1][1] * g + m[1][2] * b), clamp01(m[2][0] * r + m[2][1] * g + m[2][2] * b)]
  }
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  if (vision === 'grey') return [L, 0, 0]
  return [L, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

/** Perceptual distance (OKLab ΔE; 0.1 is a clearly visible step) as seen in `vision`. */
export function visionDistance(a: number, b: number, vision: Vision): number {
  const p = oklab(a, vision)
  const q = oklab(b, vision)
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

export type VisionFloor = Record<Vision, number>

/**
 * The least distance two team colours must keep in each vision. Normal
 * vision asks for a clearly different colour; the colour-blind and
 * greyscale views ask for a visible step (brightness alone is enough).
 * Gold vs strawberry, the pair the game always had, clears each by 1.85×
 * or more.
 */
export const PAIR_FLOOR: VisionFloor = { normal: 0.15, protan: 0.07, deutan: 0.07, tritan: 0.07, grey: 0.07 }

/**
 * Each team colour against the grey neutrals. The floor is today's pink:
 * no preset may be closer to the neutral grey than strawberry already was
 * (under protanopia pink and grey are close; neutrals also have no ring and
 * are always round, so they still stand apart).
 */
export const NEUTRAL_FLOOR: VisionFloor = { normal: 0.15, protan: 0.025, deutan: 0.025, tritan: 0.025, grey: 0.05 }

/** The enemy's red ownership ring against every body colour, in every vision (strawberry, the reddest, is 0.088). */
export const RING_FLOOR = 0.07

/**
 * Mid-capture: the body blends from its owner's colour towards the
 * attacker's (up to 85 %). Along the way it must never turn into neutral
 * grey (complementary colours meet in grey), in colour or in brightness.
 */
export const BLEND_FLOOR = { normal: 0.1, grey: 0.045 } as const

/** A pair's score: how many times over its floor the pair's weakest vision is (1 = just passes). */
export function contrastScore(a: number, b: number, floor: VisionFloor = PAIR_FLOOR): number {
  let s = Infinity
  for (const v of VISIONS) s = Math.min(s, visionDistance(a, b, v) / floor[v])
  return s
}

/** The compat matrix: score of every preset pair (computed once; symmetric, 0 on the diagonal). */
export const COMPAT: Record<TeamColourId, Record<TeamColourId, number>> = Object.fromEntries(
  TEAM_COLOURS.map((a) => [a, Object.fromEntries(TEAM_COLOURS.map((b) => [b, a === b ? 0 : contrastScore(TEAM_COLOUR[a].hex, TEAM_COLOUR[b].hex)]))]),
) as Record<TeamColourId, Record<TeamColourId, number>>

/** Two players may wear these two against each other. */
export function compatible(a: TeamColourId, b: TeamColourId): boolean {
  return COMPAT[a][b] >= 1
}

/**
 * Beyond this score a pair is comfortably apart and more contrast doesn't
 * read any better, so the opponent's choice among those goes by
 * preference (the AI's pink first, then gold) instead of by raw contrast.
 */
export const COMFORTABLE = 1.5

/** The order the opponent prefers among equally good choices. */
const PREFERENCE: readonly TeamColourId[] = [AI_COLOUR, DEFAULT_COLOUR, ...TEAM_COLOURS.filter((c) => c !== AI_COLOUR && c !== DEFAULT_COLOUR)]

/**
 * The opponent's colour when yours is `mine`: the best contrast, where every
 * pair past COMFORTABLE counts as equally good and ties go by PREFERENCE.
 * So pink whenever pink sits comfortably apart from yours (gold → pink),
 * else gold, else whichever preset contrasts most.
 */
export function bestContrast(mine: TeamColourId): TeamColourId {
  let best: TeamColourId = mine
  let bestScore = -1
  for (const c of PREFERENCE) {
    if (c === mine) continue
    const s = Math.min(COMFORTABLE, COMPAT[mine][c])
    if (s > bestScore + 1e-9) {
      best = c
      bestScore = s
    }
  }
  return best
}

/** The opponent's colour for each of yours (precomputed). */
export const CONTRAST_COLOUR: Record<TeamColourId, TeamColourId> = Object.fromEntries(TEAM_COLOURS.map((c) => [c, bestContrast(c)])) as Record<TeamColourId, TeamColourId>

/** The colours each side wears in a round (neutral is always the theme's grey). */
export type SideColours = Record<Exclude<Side, 'neutral'>, TeamColourId>

/** Against the AI (and in puzzles, playtests, the editor, the title demo): yours, and the contrasting one for pink. */
export function vsAiColours(mine: TeamColourId): SideColours {
  return { player: mine, enemy: CONTRAST_COLOUR[mine] }
}

/**
 * Two players: each always wears their own pick, even when the two clash
 * (name tags tell them apart then; see config/looks.ts). Only a seat that
 * sent no colour (an older game) gets one: gold's default, or the contrast to
 * gold's. Deterministic, so the server and every client agree.
 */
export function pvpColours(gold: TeamColourId | undefined, pink: TeamColourId | undefined): SideColours {
  const g = gold ?? DEFAULT_COLOUR
  return { player: g, enemy: pink ?? CONTRAST_COLOUR[g] }
}

/** The same colours seen from the other side (a flipped view). */
export function flipColours(c: SideColours): SideColours {
  return { player: c.enemy, enemy: c.player }
}

/** A start message's colours if they are valid (older hosts send none; a broken one is ignored). */
export function readColours(v: unknown): SideColours | undefined {
  if (!v || typeof v !== 'object') return undefined
  const c = v as Record<string, unknown>
  return isTeamColour(c.player) && isTeamColour(c.enemy) ? { player: c.player, enemy: c.enemy } : undefined
}
