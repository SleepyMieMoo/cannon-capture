import type { LevelDef } from '../types'
import { CAMPAIGN } from './campaign'
import { EXAMPLE_MAPS } from './examples'
import mapInfo from '../data/mapInfo.json'

/**
 * Menu facts about the built-in maps, kept apart from the maps themselves so
 * levels, editor examples, saved maps and share codes never change.
 * - retired: left out of the Play vs AI picker and the title demo. The data
 *   stays: the campaign still plays it, links and saved picks still load.
 * - impossible: the dev has beaten it on Impossible by hand (a tag on its card).
 */
export interface MapInfo {
  retired?: boolean
  impossible?: boolean
  /** Why (for us, not shown). */
  note?: string
}

export const MAP_INFO: Readonly<Record<string, MapInfo>> = Object.fromEntries(
  Object.entries(mapInfo as Record<string, unknown>).filter(([k]) => !k.startsWith('_')),
) as Record<string, MapInfo>

export const isRetired = (id: string): boolean => !!MAP_INFO[id]?.retired
export const beatableOnImpossible = (id: string): boolean => !!MAP_INFO[id]?.impossible

/**
 * The built-in boards you can pick for Play vs AI (and the title demo plays):
 * the campaign's battles, then the obstacle examples, minus retired ones.
 */
export const VS_AI_BUILT_IN: readonly LevelDef[] = [...CAMPAIGN.filter((l) => l.kind !== 'puzzle'), ...EXAMPLE_MAPS].filter((l) => !isRetired(l.id))

/** Where Play vs AI starts, and where a remembered map that is gone or retired lands. */
export const DEFAULT_VS_AI_MAP = 'crossfire'
