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

export interface LevelDef {
  id: string
  name: string
  cannons: CannonDef[]
  walls: Rect[]
  fans: FanDef[]
}
