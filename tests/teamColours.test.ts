import { describe, expect, it } from 'vitest'
import {
  AI_COLOUR,
  BLEND_FLOOR,
  COMFORTABLE,
  COMPAT,
  CONTRAST_COLOUR,
  DEFAULT_COLOUR,
  NEUTRAL_FLOOR,
  PAIR_FLOOR,
  RING_FLOOR,
  TEAM_COLOUR,
  TEAM_COLOURS,
  VISIONS,
  compatible,
  contrastScore,
  flipColours,
  oklab,
  pvpColours,
  readColours,
  visionDistance,
  vsAiColours,
  type TeamColourId,
} from '../src/config/teamColours'
import { parseColourPref } from '../src/menu/colourPref'
import { applyTeamColours, lerpColor, ownerRing, sideColor, theme } from '../src/config/theme'
import { joinRoom, PvpHost, type HostMsg } from '../src/net/pvp'
import { mirrored } from '../src/levels/mirrored'
import type { Transport } from '../src/net/transport'

const hex = (c: TeamColourId) => TEAM_COLOUR[c].hex
const pairs = (): [TeamColourId, TeamColourId][] => TEAM_COLOURS.flatMap((a) => TEAM_COLOURS.filter((b) => b !== a).map((b) => [a, b] as [TeamColourId, TeamColourId]))
/** Every pair a round can show: the AI's pick for each colour, and every pair two players may keep. */
const shownPairs = (): [TeamColourId, TeamColourId][] => pairs().filter(([a, b]) => compatible(a, b) || CONTRAST_COLOUR[a] === b)

describe('team colours: the presets', () => {
  it('eight presets; gold (yours) and strawberry (the AI) are the game’s colours as they were', () => {
    expect(TEAM_COLOURS.length).toBe(8)
    expect(new Set(TEAM_COLOURS.map(hex)).size).toBe(8)
    expect(new Set(TEAM_COLOURS.map((c) => TEAM_COLOUR[c].label)).size).toBe(8)
    expect(DEFAULT_COLOUR).toBe('gold')
    expect(AI_COLOUR).toBe('strawberry')
    expect(hex('gold')).toBe(theme.player)
    expect(hex('strawberry')).toBe(theme.enemy)
    expect(vsAiColours('gold')).toEqual({ player: 'gold', enemy: 'strawberry' })
  })

  it('each stands out from the dark board, the grey neutrals, the mint fans, its own hit flash and both ownership rings', () => {
    for (const c of TEAM_COLOURS) {
      const x = hex(c)
      // Board: far brighter in every vision (strawberry under protanopia is the dimmest, 0.40 above it).
      for (const v of VISIONS) expect(oklab(x, v)[0] - oklab(theme.board, v)[0], `${c} vs board (${v})`).toBeGreaterThan(0.35)
      // Neutrals: no closer than today's pink, in any vision.
      for (const v of VISIONS) expect(visionDistance(x, theme.neutral, v), `${c} vs neutral (${v})`).toBeGreaterThanOrEqual(NEUTRAL_FLOOR[v])
      // The enemy's red ring reads on every body (no red preset).
      for (const v of VISIONS) expect(visionDistance(x, theme.ringEnemy, v), `${c} vs red ring (${v})`).toBeGreaterThanOrEqual(RING_FLOOR)
      // The light "yours" ring: no closer than on the gold it was made for.
      expect(visionDistance(x, theme.ringYou, 'normal'), `${c} vs light ring`).toBeGreaterThanOrEqual(visionDistance(theme.player, theme.ringYou, 'normal') - 1e-9)
      expect(visionDistance(x, theme.fan, 'normal'), `${c} vs fan`).toBeGreaterThanOrEqual(0.12)
      expect(visionDistance(x, lerpColor(x, 0xffffff, 0.55), 'normal'), `${c} hit flash`).toBeGreaterThanOrEqual(0.06)
    }
  })

  it('the floors are set by the colours the game always had: gold vs pink passes every one with room to spare, pink sets the neutral floor', () => {
    expect(COMPAT.gold.strawberry).toBeGreaterThan(1.8)
    expect(contrastScore(hex('strawberry'), theme.neutral, NEUTRAL_FLOOR)).toBeGreaterThanOrEqual(1)
    expect(contrastScore(hex('strawberry'), theme.neutral, NEUTRAL_FLOOR)).toBeLessThan(1.1)
  })
})

describe('team colours: the compat matrix', () => {
  it('is symmetric, zero on the diagonal, and the same as the scores', () => {
    for (const a of TEAM_COLOURS) {
      expect(COMPAT[a][a]).toBe(0)
      expect(compatible(a, a)).toBe(false)
      for (const b of TEAM_COLOURS) {
        expect(COMPAT[a][b]).toBeCloseTo(COMPAT[b][a], 9)
        if (a !== b) expect(COMPAT[a][b]).toBeCloseTo(contrastScore(hex(a), hex(b)), 9)
      }
    }
  })

  it('every pair a round can show is apart in normal vision, protanopia, deuteranopia, tritanopia and greyscale', () => {
    const shown = shownPairs()
    expect(shown.length).toBeGreaterThanOrEqual(TEAM_COLOURS.length)
    for (const [a, b] of shown) for (const v of VISIONS) expect(visionDistance(hex(a), hex(b), v), `${a}/${b} (${v})`).toBeGreaterThanOrEqual(PAIR_FLOOR[v])
  })

  it('mid-capture: a body blending from its owner to the attacker never turns neutral grey', () => {
    for (const [a, b] of shownPairs())
      for (let t = 0; t <= 0.85 + 1e-9; t += 0.025) {
        const mid = lerpColor(hex(a), hex(b), t)
        expect(visionDistance(mid, theme.neutral, 'normal'), `${a}→${b} at ${t.toFixed(3)}`).toBeGreaterThanOrEqual(BLEND_FLOOR.normal)
        expect(visionDistance(mid, theme.neutral, 'grey'), `${a}→${b} at ${t.toFixed(3)} (grey)`).toBeGreaterThanOrEqual(BLEND_FLOOR.grey)
      }
    // A neutral being captured: the tint heads to the attacker's colour, and two attackers' tints differ.
    for (const [a, b] of shownPairs()) expect(visionDistance(lerpColor(theme.neutral, hex(a), 0.85), lerpColor(theme.neutral, hex(b), 0.85), 'normal')).toBeGreaterThan(0.1)
  })

  it('pairs that clash fail it (two blues, gold and its neighbours)', () => {
    expect(compatible('sky', 'blueberry')).toBe(false)
    expect(compatible('gold', 'peach')).toBe(false)
    expect(compatible('gold', 'lime')).toBe(false)
    expect(compatible('strawberry', 'tangerine')).toBe(false)
  })
})

describe('team colours: who wears what', () => {
  it('the AI wears the best contrast to yours: pink against gold, gold against pink, never yours', () => {
    expect(CONTRAST_COLOUR.gold).toBe('strawberry')
    expect(CONTRAST_COLOUR.strawberry).toBe('gold')
    for (const c of TEAM_COLOURS) {
      const ai = CONTRAST_COLOUR[c]
      expect(ai).not.toBe(c)
      expect(compatible(c, ai)).toBe(true)
      expect(COMPAT[c][ai]).toBeGreaterThanOrEqual(1.3)
      // Best: nothing scores higher once everything past "comfortable" counts the same.
      for (const o of TEAM_COLOURS) if (o !== c) expect(Math.min(COMFORTABLE, COMPAT[c][o])).toBeLessThanOrEqual(Math.min(COMFORTABLE, COMPAT[c][ai]) + 1e-9)
      expect(vsAiColours(c)).toEqual({ player: c, enemy: ai })
    }
  })

  it('two players keep their picks unless they clash; then the pink seat wears the contrast (deterministically)', () => {
    for (const g of TEAM_COLOURS)
      for (const p of TEAM_COLOURS) {
        const r = pvpColours(g, p)
        expect(r.player).toBe(g)
        expect(r.enemy).toBe(compatible(g, p) ? p : CONTRAST_COLOUR[g])
        expect(compatible(r.player, r.enemy)).toBe(true)
        expect(pvpColours(g, p)).toEqual(r)
      }
    expect(pvpColours(undefined, undefined)).toEqual({ player: 'gold', enemy: 'strawberry' })
    expect(pvpColours('blueberry', undefined)).toEqual({ player: 'blueberry', enemy: 'gold' })
    expect(pvpColours(undefined, 'sky')).toEqual({ player: 'gold', enemy: 'strawberry' })
    expect(flipColours(pvpColours('grape', 'lime'))).toEqual({ player: 'lime', enemy: 'grape' })
  })

  it('saved choice and network fields: only known presets', () => {
    expect(parseColourPref('grape')).toBe('grape')
    expect(parseColourPref('GRAPE')).toBe(DEFAULT_COLOUR)
    expect(parseColourPref(null)).toBe(DEFAULT_COLOUR)
    expect(readColours({ player: 'sky', enemy: 'strawberry' })).toEqual({ player: 'sky', enemy: 'strawberry' })
    expect(readColours({ player: 'sky', enemy: 'red' })).toBeUndefined()
    expect(readColours(undefined)).toBeUndefined()
    expect(readColours('gold')).toBeUndefined()
  })

  it('the board reads the round’s colours; the ownership rings and the menu accent never change', () => {
    const before = { player: theme.player, enemy: theme.enemy, you: ownerRing('player'), them: ownerRing('enemy') }
    applyTeamColours({ player: 'grape', enemy: 'lime' })
    expect(sideColor('player')).toBe(hex('grape'))
    expect(sideColor('enemy')).toBe(hex('lime'))
    expect(sideColor('neutral')).toBe(theme.neutral)
    expect(ownerRing('player')).toBe(before.you)
    expect(ownerRing('enemy')).toBe(before.them)
    expect(theme.player).toBe(before.player)
    expect(theme.enemy).toBe(before.enemy)
    applyTeamColours(vsAiColours('gold'))
    expect(sideColor('player')).toBe(theme.player)
  })
})

describe('team colours: two tabs (LAN test mode)', () => {
  it('the host keeps both picks when they go together, swaps a clashing joiner, and the joiner says its colour', () => {
    const run = (mine: TeamColourId, theirs: TeamColourId) => {
      const out: unknown[] = []
      let handler: ((msg: unknown, from: string) => void) | null = null
      const t = { send: (m: unknown) => out.push(m), onMessage: (fn: typeof handler) => ((handler = fn), () => (handler = null)), close() {} } as unknown as Transport
      const host = new PvpHost(t, mirrored(1), 'm1')
      host.localColour = mine
      handler!({ t: 'hello', colour: theirs }, 'peer-' + mine + theirs)
      const start = out.find((m) => (m as HostMsg).t === 'start') as Extract<HostMsg, { t: 'start' }>
      host.close(false)
      return start.colours
    }
    expect(run('blueberry', 'peach')).toEqual({ player: 'blueberry', enemy: 'peach' })
    expect(run('blueberry', 'sky')).toEqual({ player: 'blueberry', enemy: 'gold' })
    const out: unknown[] = []
    const t2 = { send: (m: unknown) => out.push(m), onMessage: () => () => {}, close() {} } as unknown as Transport
    const cancel = joinRoom(t2, () => {}, () => {}, 'hex', 'lime')
    expect(out[0]).toEqual({ t: 'hello', skin: 'hex', colour: 'lime' })
    cancel()
  })
})
