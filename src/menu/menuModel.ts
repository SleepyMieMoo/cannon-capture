import { DIFFICULTY, validateMap, type SavedMap } from '../editor/maps'
import { CAMPAIGN, SKIRMISH } from '../levels'
import type { Progress } from '../sim/stars'
import { AI_LEVELS, type AiLevel, type LevelDef } from '../types'
import type { MapChoice } from './routes'

export { DIFFICULTY }

/** What the menu remembers on this device (last difficulty and map for Play vs AI). */
export interface MenuPrefs {
  difficulty: AiLevel
  mapId: string
}

const KEY = 'cannon-capture:menu:v1'
export const DEFAULT_PREFS: MenuPrefs = { difficulty: 'normal', mapId: SKIRMISH.id }

export function loadMenuPrefs(): MenuPrefs {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const p = JSON.parse(raw) as Partial<MenuPrefs>
    return {
      difficulty: (AI_LEVELS as readonly string[]).includes(p.difficulty as string) ? (p.difficulty as AiLevel) : DEFAULT_PREFS.difficulty,
      mapId: typeof p.mapId === 'string' && p.mapId ? p.mapId : DEFAULT_PREFS.mapId,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function saveMenuPrefs(p: MenuPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // Storage blocked: the menu just won't remember.
  }
}

/**
 * Maps for Play vs AI: Skirmish, the campaign's battle boards (played as
 * plain battles at your difficulty; the levels themselves are unchanged),
 * then your own battle maps that are playable.
 */
export function vsAiMaps(saved: SavedMap[]): MapChoice[] {
  const builtIn: LevelDef[] = [SKIRMISH, ...CAMPAIGN.filter((l) => l.kind !== 'puzzle')]
  const mine = saved.map((m) => m.level).filter((l) => l.kind !== 'puzzle' && validateMap(l).length === 0)
  return [
    ...builtIn.map((level) => ({ id: level.id, name: level.name, group: 'Built-in' as const, level })),
    ...mine.map((level) => ({ id: level.id, name: level.name, group: 'My maps' as const, level })),
  ]
}

/** The remembered map, or the first one if it is gone (deleted, say). */
export function pickMap(choices: MapChoice[], id: string): MapChoice {
  return choices.find((c) => c.id === id) ?? choices[0]
}

export interface PuzzleChoice {
  id: string
  name: string
  /** "Puzzle 3" for the campaign's, the map's size/aims for yours. */
  label: string
  stars: number
  level: LevelDef
  custom: boolean
}

/**
 * Every puzzle: the campaign's puzzles in order (all open here, whatever
 * the campaign has unlocked; wins still count toward its stars) and your
 * own playable puzzle maps.
 */
export function puzzleChoices(progress: Progress, saved: SavedMap[]): PuzzleChoice[] {
  const campaign = CAMPAIGN.filter((l) => l.kind === 'puzzle').map((level, i) => ({
    id: level.id,
    name: level.name,
    label: `Puzzle ${i + 1}`,
    stars: progress.stars[level.id] ?? 0,
    level,
    custom: false,
  }))
  const mine = saved
    .map((m) => m.level)
    .filter((l) => l.kind === 'puzzle' && validateMap(l).length === 0)
    .map((level) => ({ id: level.id, name: level.name, label: level.aims ? `${level.aims} aims` : 'My map', stars: 0, level, custom: true }))
  return [...campaign, ...mine]
}

/** The next campaign puzzle after `id` (for "Next puzzle"), if any. */
export function nextPuzzle(id: string): LevelDef | null {
  const puzzles = CAMPAIGN.filter((l) => l.kind === 'puzzle')
  const i = puzzles.findIndex((l) => l.id === id)
  return i >= 0 ? (puzzles[i + 1] ?? null) : null
}
