import { describe, expect, it } from 'vitest'
import { placeTip, TipRules } from '../src/ui/tipLogic'

function setup() {
  const log: string[] = []
  const rules = new TipRules<string>((t) => log.push('show ' + t), (t) => log.push('hide ' + t))
  return { rules, log }
}

describe('help tips: open and close', () => {
  it('hover shows, leaving hides', () => {
    const { rules, log } = setup()
    rules.hoverIn('a')
    expect(rules.current).toBe('a')
    rules.hoverOut('a')
    expect(rules.current).toBeNull()
    expect(log).toEqual(['show a', 'hide a'])
  })

  it('keyboard focus shows, blur hides', () => {
    const { rules } = setup()
    rules.focus('a')
    expect(rules.isOpen('a')).toBe(true)
    rules.blur('a')
    expect(rules.isOpen('a')).toBe(false)
  })

  it('a click while hovered pins it; a second click closes it', () => {
    const { rules } = setup()
    rules.hoverIn('a')
    rules.press('a')
    expect(rules.pinned).toBe(true)
    rules.hoverOut('a')
    expect(rules.current).toBe('a')
    rules.press('a')
    expect(rules.current).toBeNull()
  })

  it('tap toggles (touch never hovers)', () => {
    const { rules } = setup()
    rules.press('a')
    expect(rules.current).toBe('a')
    rules.press('a')
    expect(rules.current).toBeNull()
  })

  it('only one open at a time', () => {
    const { rules, log } = setup()
    rules.press('a')
    rules.press('b')
    expect(rules.current).toBe('b')
    rules.hoverIn('c')
    expect(rules.current).toBe('c')
    expect(rules.pinned).toBe(false)
    expect(log).toEqual(['show a', 'hide a', 'show b', 'hide b', 'show c'])
    // The old one's leave or blur no longer closes the new one.
    rules.hoverOut('b')
    rules.blur('a')
    expect(rules.current).toBe('c')
  })

  it('a press outside or Esc closes; Esc says whether it closed something', () => {
    const { rules } = setup()
    rules.press('a')
    rules.outside()
    expect(rules.current).toBeNull()
    rules.focus('a')
    expect(rules.escape()).toBe(true)
    expect(rules.current).toBeNull()
    expect(rules.escape()).toBe(false)
  })

  it('a pinned tip outlives hover and focus leaving', () => {
    const { rules } = setup()
    rules.focus('a')
    rules.press('a')
    rules.blur('a')
    rules.hoverOut('a')
    expect(rules.current).toBe('a')
  })
})

describe('help tips: placement', () => {
  const view = { w: 390, h: 844 }
  it('below the button, centred, when it fits', () => {
    const p = placeTip({ x: 180, y: 100, w: 20, h: 20 }, { w: 200, h: 80 }, view)
    expect(p.side).toBe('below')
    expect(p.y).toBe(128)
    expect(p.x).toBe(90)
    expect(p.arrowX).toBe(100)
  })

  it('flips above near the bottom', () => {
    const p = placeTip({ x: 180, y: 800, w: 20, h: 20 }, { w: 200, h: 80 }, view)
    expect(p.side).toBe('above')
    expect(p.y + 80).toBeLessThanOrEqual(800)
  })

  it('stays inside the left and right edges, arrow still on the button', () => {
    const left = placeTip({ x: 4, y: 100, w: 20, h: 20 }, { w: 300, h: 80 }, view)
    expect(left.x).toBe(8)
    expect(left.arrowX).toBe(12)
    const right = placeTip({ x: 366, y: 100, w: 20, h: 20 }, { w: 300, h: 80 }, view)
    expect(right.x + 300).toBeLessThanOrEqual(view.w - 8)
    expect(right.x + right.arrowX).toBeGreaterThanOrEqual(366)
    expect(right.x + right.arrowX).toBeLessThanOrEqual(386)
  })

  it('a tip taller than both sides stays on screen', () => {
    const p = placeTip({ x: 100, y: 200, w: 20, h: 20 }, { w: 200, h: 400 }, { w: 320, h: 360 })
    expect(p.y).toBeGreaterThanOrEqual(8)
    expect(p.y).toBe(8)
  })
})
