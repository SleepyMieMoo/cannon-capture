import { TUNING } from '../../src/config/tuning'
import type { AiLevel } from '../../src/types'

/**
 * Runs fn with the given AI level aiming perfectly (no aim error), then puts
 * the error back. For tests about planning, swaps or routes, where a sloppy
 * miss would only add noise.
 */
export function perfectAim<T>(d: AiLevel, fn: () => T): T {
  const level = TUNING.aiLevels[d] as { aimError: number }
  const was = level.aimError
  level.aimError = 0
  try {
    return fn()
  } finally {
    level.aimError = was
  }
}
