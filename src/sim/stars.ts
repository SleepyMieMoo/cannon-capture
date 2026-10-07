import type { LevelDef } from '../types'

/** 1-3 stars for a win. See LevelDef.par. Levels without a par always get 3. */
export function starsFor(level: LevelDef, result: { seconds: number; aimsUsed: number }): number {
  if (!level.par) return 3
  if (level.kind === 'puzzle' && level.aims !== undefined) {
    if (result.aimsUsed <= level.par) return 3
    if (result.aimsUsed <= level.par + 1) return 2
    return 1
  }
  if (result.seconds <= level.par) return 3
  if (result.seconds <= level.par * 1.5) return 2
  return 1
}

export interface Progress {
  /** Best stars per level id. A level is complete when it has at least 1. */
  stars: Record<string, number>
}

export function isUnlocked(levels: LevelDef[], index: number, progress: Progress): boolean {
  if (index <= 0) return true
  return (progress.stars[levels[index - 1].id] ?? 0) > 0
}

/** The level the map should highlight: the first unlocked one not yet beaten. */
export function currentLevelIndex(levels: LevelDef[], progress: Progress): number {
  for (let i = 0; i < levels.length; i++) {
    if (!isUnlocked(levels, i, progress)) return Math.max(0, i - 1)
    if (!(progress.stars[levels[i].id] > 0)) return i
  }
  return levels.length - 1
}

export function withWin(progress: Progress, levelId: string, stars: number): Progress {
  return { stars: { ...progress.stars, [levelId]: Math.max(progress.stars[levelId] ?? 0, stars) } }
}
