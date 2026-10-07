export const SIDES = ['player', 'enemy', 'neutral'] as const

export type Side = (typeof SIDES)[number]

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface CannonDef {
  id: string
  name: string
  x: number
  y: number
  side: Side
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
  cannons: CannonDef[]
  walls: Rect[]
  fans: FanDef[]
}
