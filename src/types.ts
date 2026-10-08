export const SIDES = ['player', 'enemy', 'neutral'] as const

export type Side = (typeof SIDES)[number]

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** A wall: a rectangle, optionally rotated by `angle` radians about its centre. */
export interface WallDef extends Rect {
  angle?: number
  /**
   * 'void': absorbs shots on contact instead of bouncing them. Older maps
   * leave it out (a normal wall).
   */
  kind?: 'void'
}

/** A round pillar: shots reflect off the surface normal where they hit. */
export interface PillarDef {
  x: number
  y: number
  r: number
}

/**
 * One-way glass: a segment from (x, y) to (x2, y2). Shots bounce off the
 * solid side (the normal's side) and pass through the other. `flip` swaps
 * which side is solid.
 */
export interface GlassDef {
  x: number
  y: number
  x2: number
  y2: number
  flip?: boolean
}

export type MapSize = 'small' | 'medium' | 'large' | 'huge'

/** Tower types. More can slot in later (see src/config/kinds.ts). */
/** AI difficulty levels, easiest first. */
export const AI_LEVELS = ['easy', 'normal', 'hard', 'impossible'] as const
export type AiLevel = (typeof AI_LEVELS)[number]

export const CANNON_KINDS = ['normal', 'sniper', 'machinegun', 'shield'] as const

export type CannonKind = (typeof CANNON_KINDS)[number]

export interface CannonDef {
  id: string
  name: string
  x: number
  y: number
  side: Side
  /** Tower type at the start of the level. Defaults to normal. */
  kind?: CannonKind
  /**
   * Legacy: snipers briefly had a 2 s / 3 s delay option. It is ignored now
   * (there is one sniper variant) and dropped when a map is loaded or shared.
   */
  delay?: number
  /** Id of the cannon this one aims at when the level starts. */
  aimAt?: string
  /** Or a free aim point when the level starts (ignored if aimAt is set). */
  aimPoint?: Point
}

export interface Point {
  x: number
  y: number
}

export interface FanDef {
  x: number
  y: number
  radius: number
  /** Radians. 0 points right, Math.PI / 2 points down. */
  angle: number
  force?: number
}

export type LevelKind = 'battle' | 'puzzle'

export interface LevelDef {
  id: string
  name: string
  /** One-line hint shown on the map and in the level HUD. */
  hint?: string
  /**
   * battle: beat the enemy AI. puzzle: no enemy, capture every neutral within
   * the aim budget. Defaults to battle.
   */
  kind?: LevelKind
  /** Puzzle only: how many aims you may set. Omit for unlimited. */
  aims?: number
  /**
   * Three-star target. Battles: seconds to win. Puzzles with an aim budget:
   * aims used. Two stars within 1.5x the seconds or one aim over par.
   */
  par?: number
  /**
   * The enemy AI. difficulty: how smart it is (never faster or stronger:
   * every level fires at TUNING.fireIntervalMs, like you). Older maps have
   * no difficulty but a fireMs (and retargetMs) instead; the difficulty is
   * read from those (see levelDifficulty) and they no longer change speed.
   */
  ai?: { difficulty?: AiLevel; retargetMs?: number; fireMs?: number }
  /** Board size preset (custom maps). Defaults to small, the original board. */
  size?: MapSize
  cannons: CannonDef[]
  walls: WallDef[]
  /** Round pillars (added later: older maps leave them out). */
  pillars?: PillarDef[]
  /** One-way glass segments (added later: older maps leave them out). */
  glass?: GlassDef[]
  fans: FanDef[]
}
