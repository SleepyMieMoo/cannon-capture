import type { Side } from '../types'

/**
 * One cannon's capture meter. `progress` counts hits from `attacker` toward
 * flipping the cannon to that side; null attacker means untouched (full
 * ownership). There is a single meter per cannon, so it works like a tug of war.
 */
export interface CaptureState {
  side: Side
  attacker: Side | null
  progress: number
}

export interface CaptureResult {
  state: CaptureState
  flipped: boolean
  /** Progress removed by this hit: a heal from the owner, or a push-back on a contested neutral. */
  reduced: number
}

/**
 * One hit worth `damage` from `attacker`.
 * - The owner's own shots heal: they take progress back off the meter, never below zero.
 * - The side already capturing (or anyone, on an untouched cannon) adds progress, and
 *   flips the cannon at `threshold`.
 * - A third side (player vs enemy on a neutral) pushes the current attacker's
 *   progress back first; any damage left over starts its own progress.
 */
export function applyCaptureHit(
  state: CaptureState,
  attacker: Side,
  threshold: number,
  damage = 1,
): CaptureResult {
  if (attacker === state.side) {
    if (state.attacker === null || state.progress <= 0) return { state, flipped: false, reduced: 0 }
    const reduced = Math.min(damage, state.progress)
    const progress = state.progress - reduced
    return {
      flipped: false,
      reduced,
      state: { side: state.side, attacker: progress > 0 ? state.attacker : null, progress },
    }
  }

  if (state.attacker === null || state.attacker === attacker) {
    const progress = state.progress + damage
    if (progress >= threshold) {
      return { flipped: true, reduced: 0, state: { side: attacker, attacker: null, progress: 0 } }
    }
    return { flipped: false, reduced: 0, state: { side: state.side, attacker, progress } }
  }

  // Contested: push the other side back, then start our own progress with what is left.
  const reduced = Math.min(damage, state.progress)
  const left = damage - reduced
  const remaining = state.progress - reduced
  if (remaining > 0) {
    return { flipped: false, reduced, state: { side: state.side, attacker: state.attacker, progress: remaining } }
  }
  if (left <= 0) return { flipped: false, reduced, state: { side: state.side, attacker: null, progress: 0 } }
  if (left >= threshold) {
    return { flipped: true, reduced, state: { side: attacker, attacker: null, progress: 0 } }
  }
  return { flipped: false, reduced, state: { side: state.side, attacker, progress: left } }
}
