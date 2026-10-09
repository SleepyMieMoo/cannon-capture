import { describe, expect, it } from 'vitest'
import { moveToward, spotlightSet } from '../src/render/targetDim'

type C = { id: string; side: string; target: C | null }
const mk = (id: string, side: string): C => ({ id, side, target: null })

describe('target mode dim', () => {
  const p1 = mk('p1', 'player')
  const p2 = mk('p2', 'player')
  const n1 = mk('n1', 'neutral')
  const e1 = mk('e1', 'enemy')
  const e2 = mk('e2', 'enemy')
  const all = [p1, p2, n1, e1, e2]

  it('no selection: nothing dims', () => {
    expect(spotlightSet(null, all, e1)).toBeNull()
  })

  it('lights the selected cannon, its target and every cannon aiming at it', () => {
    p1.target = n1
    e1.target = p1
    e2.target = p2
    p2.target = p1
    const lit = spotlightSet(p1, all, null)!
    expect([...lit].map((c) => c.id).sort()).toEqual(['e1', 'n1', 'p1', 'p2'])
    expect(lit.has(e2)).toBe(false)
  })

  it('also lights the cannon you point at, and works with no target', () => {
    for (const c of all) c.target = null
    expect([...spotlightSet(p2, all, e2)!].map((c) => c.id).sort()).toEqual(['e2', 'p2'])
    expect([...spotlightSet(p2, all, p2)!].map((c) => c.id)).toEqual(['p2'])
  })

  it('eases toward the goal without overshooting', () => {
    expect(moveToward(0, 1, 0.3)).toBeCloseTo(0.3)
    expect(moveToward(0.9, 1, 0.3)).toBe(1)
    expect(moveToward(0.2, 0, 0.3)).toBe(0)
  })
})
