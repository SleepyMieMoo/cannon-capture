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

  it('does nothing when the owner shoots a fully healthy cannon (no overheal)', () => {
    const owned: CaptureState = { side: 'player', attacker: null, progress: 0 }
    expect(applyCaptureHit(owned, 'player', 5)).toEqual({ state: owned, flipped: false, reduced: 0 })
    expect(applyCaptureHit(owned, 'player', 5, 3)).toEqual({ state: owned, flipped: false, reduced: 0 })
  })

  it("heals: the owner's shots take the enemy's progress back off", () => {
    const hurt: CaptureState = { side: 'player', attacker: 'enemy', progress: 4 }
    const once = applyCaptureHit(hurt, 'player', 8)
    expect(once).toEqual({ flipped: false, reduced: 1, state: { side: 'player', attacker: 'enemy', progress: 3 } })
    // A big heal stops at full health instead of going past it.
    const big = applyCaptureHit({ ...hurt, progress: 2 }, 'player', 8, 3)
    expect(big).toEqual({ flipped: false, reduced: 2, state: { side: 'player', attacker: null, progress: 0 } })
  })

  it('heal damage scales with the shot (a 2-damage heal removes 2)', () => {
    const hurt: CaptureState = { side: 'enemy', attacker: 'player', progress: 6 }
    expect(applyCaptureHit(hurt, 'enemy', 8, 2).state.progress).toBe(4)
    expect(applyCaptureHit(hurt, 'enemy', 8, 3).state.progress).toBe(3)
  })

  it('pushes back a rival on a neutral, and leftover damage starts your own progress', () => {
    const theirs: CaptureState = { side: 'neutral', attacker: 'enemy', progress: 1 }
    const pushed = applyCaptureHit(theirs, 'player', 8, 3)
    expect(pushed).toEqual({ flipped: false, reduced: 1, state: { side: 'neutral', attacker: 'player', progress: 2 } })
    const partial = applyCaptureHit({ ...theirs, progress: 5 }, 'player', 8, 2)
    expect(partial.state).toEqual({ side: 'neutral', attacker: 'enemy', progress: 3 })
  })

  it('bigger hits capture sooner', () => {
    let state = fresh
    for (let i = 0; i < 3; i++) state = applyCaptureHit(state, 'player', 8, 2).state
    expect(state.progress).toBe(6)
    expect(applyCaptureHit(state, 'player', 8, 2).flipped).toBe(true)
  })
})
