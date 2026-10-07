import { describe, expect, it } from 'vitest'
import { applyCaptureHit, type CaptureState } from '../src/sim/capture'

const fresh: CaptureState = { side: 'neutral', attacker: null, progress: 0 }

describe('applyCaptureHit', () => {
  it('flips ownership once the threshold is met', () => {
    let state = fresh
    for (let hit = 0; hit < 4; hit++) {
      const step = applyCaptureHit(state, 'player', 5)
      expect(step.flipped).toBe(false)
      state = step.state
      expect(state.side).toBe('neutral')
      expect(state.progress).toBe(hit + 1)
    }
    const last = applyCaptureHit(state, 'player', 5)
    expect(last.flipped).toBe(true)
    expect(last.state).toEqual({ side: 'player', attacker: null, progress: 0 })
  })

  it('lets the other side contest progress before starting its own', () => {
    const warmed = applyCaptureHit(fresh, 'player', 5).state
    const contested = applyCaptureHit(warmed, 'enemy', 5)
    expect(contested.flipped).toBe(false)
    expect(contested.state).toEqual({ side: 'neutral', attacker: null, progress: 0 })
    const started = applyCaptureHit(contested.state, 'enemy', 5)
    expect(started.state.attacker).toBe('enemy')
    expect(started.state.progress).toBe(1)
  })

  it('ignores shots from the current owner', () => {
    const owned: CaptureState = { side: 'player', attacker: null, progress: 0 }
    expect(applyCaptureHit(owned, 'player', 5)).toEqual({ state: owned, flipped: false })
  })
})
