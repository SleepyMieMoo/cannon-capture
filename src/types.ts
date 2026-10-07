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
}

export type MapSize = 'small' | 'medium' | 'large' | 'huge'

/** Tower types. More can slot in later (see src/config/kinds.ts). */
export const CANNON_KINDS = ['normal', 'sniper'] as const

export type CannonKind = (typeof CANNON_KINDS)[number]

export interface CannonDef {
  id: string
  name: string
  x: number
  y: number
  side: Side
  /** Tower type at the start of the level. Defaults to normal. */
  kind?: CannonKind
  /** Sniper only: seconds between shots, which is also its damage (2 or 3). Defaults to 2. */
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
   * Enemy AI overrides. retargetMs: how often it re-aims. fireMs: time between
   * enemy shots (yours are always TUNING.fireIntervalMs), to ease early levels.
   */
  ai?: { retargetMs?: number; fireMs?: number }
  /** Board size preset (custom maps). Defaults to small, the original board. */
  size?: MapSize
  cannons: CannonDef[]
  walls: WallDef[]
  fans: FanDef[]
}
