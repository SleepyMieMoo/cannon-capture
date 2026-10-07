import type { Side } from '../types'

export interface TargetCandidate {
  id: string
  x: number
  y: number
  attacker: Side | null
  progress: number
}

/** Nearest prey, biased toward cannons the enemy is already capturing. */
export function pickAiTarget(
  origin: { x: number; y: number },
  candidates: TargetCandidate[],
  finishBias: number,
  currentId: string | null,
  slack: number,
): TargetCandidate | null {
  let best: TargetCandidate | null = null
  let bestScore = Infinity
  let current: TargetCandidate | null = null
  let currentScore = Infinity

  for (const candidate of candidates) {
    const dist = Math.hypot(candidate.x - origin.x, candidate.y - origin.y)
    const bonus = candidate.attacker === 'enemy' ? candidate.progress * finishBias : 0
    const score = dist - bonus
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
    if (candidate.id === currentId) {
      current = candidate
      currentScore = score
    }
  }

  if (current && currentScore <= bestScore + slack) return current
  return best
}
