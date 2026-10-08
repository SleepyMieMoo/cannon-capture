import { TUNING } from '../config/tuning'
import { AI_LEVELS, type AiLevel, type LevelDef } from '../types'

export type { AiLevel }

export function isAiLevel(v: unknown): v is AiLevel {
  return typeof v === 'string' && (AI_LEVELS as readonly string[]).includes(v)
}

/**
 * The difficulty an older map meant, read from the enemy fire rate it set
 * (the old Difficulty menu's thresholds). No fireMs meant the normal rate,
 * which was Hard's.
 */
export function inferDifficulty(fireMs: number | undefined): AiLevel {
  const fire = fireMs ?? TUNING.fireIntervalMs
  if (fire >= 1300) return 'easy'
  if (fire >= 1100) return 'normal'
  return 'hard'
}

/** A level's AI difficulty: its own ai.difficulty, or inferred from an older map's fireMs. */
export function levelDifficulty(level: Pick<LevelDef, 'ai'>): AiLevel {
  const d = level.ai?.difficulty
  return isAiLevel(d) ? d : inferDifficulty(level.ai?.fireMs)
}

/** The per-level brain settings (TUNING.aiLevels). */
export function skillOf(d: AiLevel) {
  return TUNING.aiLevels[d]
}
