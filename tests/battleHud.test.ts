import { describe, expect, it } from 'vitest'
import { VIEW_TOP, foldOrder, inkOn, matchTime, stackPlacement, stripSpan } from '../src/ui/battleHud'
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

  it('match time counts up in whole seconds', () => {
    expect(matchTime(0)).toBe('0:00')
    expect(matchTime(999)).toBe('0:00')
    expect(matchTime(61_500)).toBe('1:01')
    expect(matchTime(-5)).toBe('0:00')
  })

  it('the bar and the cannon strip end at the board view’s top when there is room, else reach past it', () => {
    // Desktop: the canvas at 16 px, 1.0667 CSS px per layout px; both fit inside the bands.
    const k = 1280 / 1200
    const roomy = stackPlacement(16, k, 0, 58, 19)
    expect(roomy.cover).toBeCloseTo(VIEW_TOP * k, 6)
    expect(roomy.stripTop).toBe(roomy.top + 58)
    // A short landscape phone: no room above the canvas, so the stack starts at the top and reaches further.
    const short = stackPlacement(0, 0.45, 0, 72, 14)
    expect(short.top).toBe(0)
    expect(short.cover).toBe(86)
    expect(short.cover).toBeGreaterThan(VIEW_TOP * 0.45)
    // A notch: never above the safe top.
    expect(stackPlacement(0, 0.45, 30, 72, 14).top).toBe(30)
  })

  it('the cannon strip spans the board’s edges, kept on the canvas', () => {
    expect(stripSpan(24, 1176)).toEqual({ x: 24, w: 1152 })
    // Zoomed in on a big map: the board runs off both sides.
    expect(stripSpan(-400, 2000)).toEqual({ x: 6, w: 1188 })
    // Never vanishes, even if the board is off to one side.
    expect(stripSpan(1300, 1500).w).toBeGreaterThanOrEqual(60)
  })
})
