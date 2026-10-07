import type { LevelDef } from '../types'
import { CAMPAIGN } from './campaign'
import { SKIRMISH } from './skirmish'

export { CAMPAIGN, SKIRMISH }

export const ALL_LEVELS: LevelDef[] = [...CAMPAIGN, SKIRMISH]

export function findLevel(id: string | null | undefined): LevelDef | undefined {
  return ALL_LEVELS.find((level) => level.id === id)
}

/** Position in the campaign (0-based), or -1 for levels outside it such as Skirmish. */
export function campaignIndex(id: string): number {
  return CAMPAIGN.findIndex((level) => level.id === id)
}
