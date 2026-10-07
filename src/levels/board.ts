import { BOARD } from '../config/layout'
import type { LevelDef, MapSize, Rect } from '../types'

/** Board scale per map size. Small is the original 1152x608 board. */
export const MAP_SIZES: Record<MapSize, { scale: number; label: string }> = {
  small: { scale: 1, label: 'Small' },
  medium: { scale: 1.5, label: 'Medium' },
  large: { scale: 2, label: 'Large' },
  huge: { scale: 3, label: 'Huge' },
}

export const MAP_SIZE_IDS = Object.keys(MAP_SIZES) as MapSize[]

/** The playable board for a level, in world coordinates. Always starts at BOARD.x/y. */
export function boardFor(level: Pick<LevelDef, 'size'> | MapSize | undefined): Rect {
  const size = typeof level === 'string' ? level : (level?.size ?? 'small')
  const k = MAP_SIZES[size]?.scale ?? 1
  return { x: BOARD.x, y: BOARD.y, w: Math.round(BOARD.w * k), h: Math.round(BOARD.h * k) }
}

export function insideBoard(board: Rect, x: number, y: number): boolean {
  return x >= board.x && x <= board.x + board.w && y >= board.y && y <= board.y + board.h
}
