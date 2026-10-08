import { describe, expect, it } from 'vitest'
import { foldOrder, inkOn } from '../src/ui/battleHud'
import { TEAM_COLOUR } from '../src/config/teamColours'
import { CLASH_GLOW } from '../src/render/sideGlow'
import { theme } from '../src/config/theme'

describe('battle top bar', () => {
  it('folds the least used buttons into the Menu first; Menu never folds', () => {
    const order = foldOrder([
      { id: 'surrender', keep: 3 },
      { id: 'pause', keep: 5 },
      { id: 'settings', keep: 2 },
      { id: 'restart', keep: 1 },
      { id: 'menu', keep: Infinity },
    ])
    expect(order).toEqual(['restart', 'settings', 'surrender', 'pause'])
  })

  it('counts on the cannon bar are readable on every team colour, the clash red and neutral grey', () => {
    const lum = (c: number) => 0.2126 * ((c >> 16) & 255) / 255 + 0.7152 * ((c >> 8) & 255) / 255 + 0.0722 * (c & 255) / 255
    for (const c of [...Object.values(TEAM_COLOUR).map((t) => t.hex), CLASH_GLOW, theme.neutral]) {
      const ink = inkOn(c)
      // Dark ink on light colours, white on dark ones.
      expect(ink).toBe(lum(c) > 0.5 ? '#1a120e' : '#ffffff')
    }
    expect(inkOn(TEAM_COLOUR.gold.hex)).toBe('#1a120e')
    expect(inkOn(CLASH_GLOW)).toBe('#ffffff')
  })
})
