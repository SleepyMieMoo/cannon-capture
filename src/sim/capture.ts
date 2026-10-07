import type { Side } from '../types'

export interface CaptureState {
  side: Side
  attacker: Side | null
  progress: number
}

export interface CaptureResult {
  state: CaptureState
  flipped: boolean
}

/**
 * One hit from `attacker`. A different side spends the hit contesting the
 * current progress instead of starting its own.
 */
export function applyCaptureHit(
  state: CaptureState,
  attacker: Side,
  threshold: number,
): CaptureResult {
  if (attacker === state.side) return { state, flipped: false }

  if (state.attacker === null || state.attacker === attacker) {
    const progress = state.progress + 1
    if (progress >= threshold) {
      return {
        flipped: true,
        state: { side: attacker, attacker: null, progress: 0 },
      }
    }
    return {
      flipped: false,
      state: { side: state.side, attacker, progress },
    }
  }

  const progress = state.progress - 1
  if (progress <= 0) {
    return {
      flipped: false,
      state: { side: state.side, attacker: null, progress: 0 },
    }
  }
  return {
    flipped: false,
    state: { side: state.side, attacker: state.attacker, progress },
  }
}
