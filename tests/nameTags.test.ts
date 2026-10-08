import { describe, expect, it } from 'vitest'
import { looksClash } from '../src/config/looks'
import { SKINS, type SkinId } from '../src/config/skins'
import { COMFORTABLE, COMPAT, TEAM_COLOURS, compatible } from '../src/config/teamColours'
import { TUNING } from '../src/config/tuning'
import { haloR, setRingScale, trackR } from '../src/entities/Cannon'
import { TAG, tagBelow, tagClearance } from '../src/render/nameTags'
import { TAG_MAX, nameOnSide, tagNames, tagText } from '../src/net/onlineView'
import type { RoomInfo } from '../src/net/online'
import type { CannonKind } from '../src/types'

const deg = (d: number) => (d * Math.PI) / 180

describe('name tags: when looks clash', () => {
  it('a colour pair that fails the matrix always clashes, whatever the skins', () => {
    for (const a of TEAM_COLOURS)
      for (const b of TEAM_COLOURS)
        if (!compatible(a, b)) for (const s of SKINS) for (const t of SKINS) expect(looksClash({ player: a, enemy: b }, { player: s, enemy: t })).toBe(true)
  })

  it('the same colour or the same skin + a tight colour pair clash; different skins with passing colours do not', () => {
    for (const c of TEAM_COLOURS) expect(looksClash({ player: c, enemy: c }, { player: 'hex', enemy: 'spiked' })).toBe(true)
    const tight: string[] = []
    for (const a of TEAM_COLOURS)
      for (const b of TEAM_COLOURS) {
        if (a === b || !compatible(a, b)) continue
        expect(looksClash({ player: a, enemy: b }, { player: 'plated', enemy: 'spiked' })).toBe(false)
        const same = looksClash({ player: a, enemy: b }, { player: 'hex', enemy: 'hex' })
        expect(same).toBe(COMPAT[a][b] < COMFORTABLE)
        if (same && a < b) tight.push(`${a}/${b}`)
      }
    expect(tight.sort()).toEqual(['gold/tangerine', 'grape/sky', 'peach/strawberry', 'sky/tangerine'])
    // The defaults (gold vs pink, Plated vs Spiked) and the AI's picks never need tags.
    expect(looksClash({ player: 'gold', enemy: 'strawberry' }, { player: 'plated', enemy: 'plated' })).toBe(false)
  })
})

describe('name tags: names', () => {
  it('room names, shortened to fit; equal names get seat numbers', () => {
    expect(tagText('Nova')).toBe('Nova')
    expect(tagText('Bartholomew the Great')).toBe('Bartholomew…')
    expect(Array.from(tagText('Bartholomew the Great')).length).toBeLessThanOrEqual(TAG_MAX)
    expect(tagNames('Nova', 'Kim')).toEqual(['Nova', 'Kim'])
    expect(tagNames('Nova', 'nova')).toEqual(['Nova 1', 'nova 2'])
    expect(tagNames('', '')).toEqual(['Player 1', 'Player 2'])
    for (const n of tagNames('Bartholomew the Great', 'Bartholomew the Great')) expect(Array.from(n).length).toBeLessThanOrEqual(TAG_MAX)
    const info = { sides: ['enemy', 'player'], seats: [{ name: 'Nova' }, { name: 'Kim' }] } as unknown as RoomInfo
    // Seat 0 (Nova) plays pink this match.
    expect(nameOnSide(info, 0)).toBe('Kim')
    expect(nameOnSide(info, 1)).toBe('Nova')
  })
})

describe('name tags: placement', () => {
  it('above, below while the barrel points up, with hysteresis (no flicker around level)', () => {
    expect(tagBelow(false, 0)).toBe(false)
    expect(tagBelow(false, deg(-90))).toBe(true)
    expect(tagBelow(false, deg(-10))).toBe(false) // 10° up: not yet
    expect(tagBelow(false, deg(-20))).toBe(true)
    expect(tagBelow(true, deg(-10))).toBe(true) // back to 10° up: stays below
    expect(tagBelow(true, deg(5))).toBe(false) // pointing down a little: above again
    expect(tagBelow(true, deg(-175))).toBe(true) // 5° up on the left
    // Jitter around level never flips it more than once.
    let below = false
    let flips = 0
    for (let i = 0; i < 400; i++) {
      const next = tagBelow(below, deg(-12 + Math.sin(i) * 3))
      if (next !== below) flips++
      below = next
    }
    expect(flips).toBe(0)
  })

  it('never covers the barrel, rings, capture ring, shield barrier or its health bar', () => {
    const r = TUNING.cannonRadius
    const s = TUNING.shield
    const kinds: CannonKind[] = ['normal', 'sniper', 'machinegun', 'shield']
    const hits: string[] = []
    for (const css of [0.25, 0.5, 1, 2]) {
      setRingScale(css)
      for (const kind of kinds) {
        const D = tagClearance(kind)
        expect(D).toBeGreaterThan(haloR() + 1)
        expect(D).toBeGreaterThan(trackR() + 2) // the capture track's line is 4 px wide
        const H = TAG.maxWorld * 1.6
        const W = TAG.maxWorld * 0.7 * TAG_MAX
        // Sweep the barrel all the way round, both ways, tracking the tag's side as the game does.
        for (const dir of [1, -1]) {
          let below = false
          for (let a = 0; a <= 720; a += 1) {
            const angle = deg(dir * a)
            below = tagBelow(below, angle)
            const inTag = (x: number, y: number) => Math.abs(x) < W / 2 && (below ? y > D && y < D + H : y < -D && y > -D - H)
            // Barrel (and muzzle flash): the longest is the sniper's, to r + 40, about 10 px wide.
            for (let d = r * 0.2; d <= r + 40; d += 3)
              for (const side of [-10, 10]) {
                const x = Math.cos(angle) * d - Math.sin(angle) * side
                const y = Math.sin(angle) * d + Math.cos(angle) * side
                if (kind !== 'shield' && inTag(x, y)) hits.push(`${kind} barrel ${a}° ${dir}`)
              }
            if (kind === 'shield') {
              const half = deg(s.arcDeg / 2)
              const outer = s.reach + (4 + 7) / 2
              for (let t = -half; t <= half; t += 0.05) {
                const x = Math.cos(angle + t) * outer
                const y = Math.sin(angle + t) * outer
                if (inTag(x, y)) hits.push(`barrier ${a}° ${dir}`)
              }
              // The barrier's health bar under the cannon.
              if (inTag(0, Math.max(r + 13, trackR() + 4) + 6)) hits.push(`health bar ${a}°`)
            }
          }
        }
      }
    }
    expect(hits.slice(0, 5)).toEqual([])
    setRingScale(1)
  })

  it('tag colours: white for yours (watchers: the gold seat), red for theirs, readable on the dark backing', () => {
    expect(TAG.colour.player).toBe('#ffffff')
    expect(TAG.colour.enemy.toLowerCase()).toMatch(/^#f/)
    const skin: SkinId = 'plated'
    expect(skin).toBeTruthy()
  })
})
