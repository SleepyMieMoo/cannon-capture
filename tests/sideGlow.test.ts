import { describe, expect, it } from 'vitest'
import { theme } from '../src/config/theme'
import { TEAM_COLOUR, TEAM_COLOURS, compatible, flipColours, vsAiColours } from '../src/config/teamColours'
import { CLASH_GLOW, GLOW, glowAlpha, glowColours, glowEdges } from '../src/render/sideGlow'
import { PVP_MAPS } from '../src/net/online'
import { netLine } from '../src/net/onlineView'
import { flipLevel } from '../src/net/pvp'
import { CAMPAIGN } from '../src/levels'
import { boardFor } from '../src/levels/board'

const board = { x: 0, y: 0, w: 1200, h: 600 }

describe('side glow', () => {
  it('each side glows from the edge its cannons start nearer; a lone side gets its nearer edge; no cannons, no glow', () => {
    expect(glowEdges([{ x: 100, side: 'player' }, { x: 1100, side: 'enemy' }, { x: 600, side: 'neutral' }], board)).toEqual({ player: 'left', enemy: 'right' })
    expect(glowEdges([{ x: 1000, side: 'player' }, { x: 300, side: 'enemy' }], board)).toEqual({ player: 'right', enemy: 'left' })
    expect(glowEdges([{ x: 900, side: 'player' }, { x: 300, side: 'neutral' }], board)).toEqual({ player: 'right', enemy: null })
    expect(glowEdges([{ x: 300, side: 'neutral' }], board)).toEqual({ player: null, enemy: null })
  })

  it('follows the view: the second player (flipped sides) glows their own side, on the right, in their colour', () => {
    for (const l of PVP_MAPS) {
      const b = boardFor(l)
      expect(glowEdges(l.cannons, b)).toEqual({ player: 'left', enemy: 'right' })
      expect(glowEdges(flipLevel(l).cannons, b)).toEqual({ player: 'right', enemy: 'left' })
    }
    for (const l of CAMPAIGN) {
      const e = glowEdges(l.cannons, boardFor(l))
      expect(e.player).not.toBeNull()
      if (e.enemy) expect(e.enemy).not.toBe(e.player)
    }
  })

  it('team colours, and red on the enemy side when the colours clash (the colour part of the name-tag rule)', () => {
    for (const a of TEAM_COLOURS)
      for (const b of TEAM_COLOURS) {
        const g = glowColours({ player: a, enemy: b })
        expect(g.player).toBe(TEAM_COLOUR[a].hex)
        expect(g.enemy).toBe(compatible(a, b) ? TEAM_COLOUR[b].hex : CLASH_GLOW)
      }
    // Against the AI there is never a clash.
    for (const c of TEAM_COLOURS) expect(glowColours(vsAiColours(c)).enemy).toBe(TEAM_COLOUR[vsAiColours(c).enemy].hex)
    // Watchers see the gold seat as 'player': on a clash the pink seat's side is red; the gold seat's keeps its colour.
    const c = { player: 'sky', enemy: 'blueberry' } as const
    expect(glowColours(c)).toEqual({ player: TEAM_COLOUR.sky.hex, enemy: CLASH_GLOW })
    expect(glowColours(flipColours(c))).toEqual({ player: TEAM_COLOUR.blueberry.hex, enemy: CLASH_GLOW })
    // A red near the enemy ring's.
    const ch = (v: number, s: number) => (v >> s) & 255
    expect(ch(CLASH_GLOW, 16)).toBeGreaterThan(ch(CLASH_GLOW, 8) + 120)
    expect(Math.abs(ch(CLASH_GLOW, 16) - ch(theme.ringEnemy, 16))).toBeLessThan(40)
  })

  it('fades smoothly from the edge to exactly nothing a quarter of the way across', () => {
    expect(GLOW.reach).toBe(0.25)
    expect(glowAlpha(0)).toBeCloseTo(GLOW.alpha)
    expect(glowAlpha(1)).toBe(0)
    expect(glowAlpha(2)).toBe(0)
    let prev = Infinity
    for (let t = 0; t <= 1; t += 0.05) {
      const a = glowAlpha(t)
      expect(a).toBeLessThanOrEqual(prev)
      prev = a
    }
    expect(GLOW.alpha).toBeGreaterThan(0.1)
    expect(GLOW.alpha).toBeLessThanOrEqual(0.25)
  })
})

describe('online: pauses off', () => {
  it('the HUD line says so instead of counting pauses', () => {
    const x = { pl: [0, 0] } as never
    expect(netLine(x, 0, 80, true)).toBe('pauses off  ·  80 ms')
    expect(netLine(x, 0, 80)).toBe('0 pauses left  ·  80 ms')
  })
})
