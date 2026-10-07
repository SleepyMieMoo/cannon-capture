import { describe, expect, it } from 'vitest'
import { pickAiTarget, type TargetCandidate } from '../src/sim/targeting'

const origin = { x: 0, y: 0 }

function prey(id: string, x: number, progress = 0, attacker: TargetCandidate['attacker'] = null): TargetCandidate {
  return { id, x, y: 0, attacker, progress }
}

describe('pickAiTarget', () => {
  it('picks the nearest cannon', () => {
    const choice = pickAiTarget(origin, [prey('far', 400), prey('near', 120)], 80, null, 0)
    expect(choice?.id).toBe('near')
  })

  it('finishes a cannon the enemy is already capturing', () => {
    const choice = pickAiTarget(
      origin,
      [prey('fresh', 200), prey('weak', 360, 4, 'enemy')],
      80,
      null,
      0,
    )
    expect(choice?.id).toBe('weak')
  })

  it('keeps the current target when the alternative is only slightly better', () => {
    const choice = pickAiTarget(origin, [prey('current', 210), prey('other', 180)], 80, 'current', 48)
    expect(choice?.id).toBe('current')
  })
})
