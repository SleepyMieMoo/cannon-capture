import { describe, expect, it } from 'vitest'
import { BADGES_KEY, badgeCount, cleanBadges, earnBadge, hasBadge, loadBadges, withBadge } from '../src/menu/badges'
import { PREF_KEYS, resetPreferences } from '../src/menu/prefs'
import { settingsText } from '../src/menu/debugInfo'
import { badgeName, offlineResult } from '../src/ui/resultView'

const memStore = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  }
}

const base = { campaign: false, hasNext: false, fromPuzzles: false, pvp: false, isPuzzle: false, surrendered: false, seconds: 90, aimsUsed: 0, countsAims: false, stars: 0, backLabel: 'My maps', endReason: '' }

describe('win badges', () => {
  it('earns a badge once per map and level, and says when it is new', () => {
    const store = memStore()
    expect(earnBadge('crossfire', 'hard', store)).toBe(true)
    expect(earnBadge('crossfire', 'hard', store)).toBe(false)
    expect(earnBadge('crossfire', 'easy', store)).toBe(true)
    expect(earnBadge('map-mine-123', 'impossible', store)).toBe(true)
    const b = loadBadges(store)
    expect(b).toEqual({ crossfire: ['easy', 'hard'], 'map-mine-123': ['impossible'] })
    expect(hasBadge(b, 'crossfire', 'hard')).toBe(true)
    expect(hasBadge(b, 'crossfire', 'normal')).toBe(false)
    expect(hasBadge(b, 'last-stand', 'easy')).toBe(false)
  })

  it('counts all badges, or only on the maps listed now', () => {
    const b = { crossfire: ['easy', 'normal', 'hard', 'impossible'], 'last-stand': ['easy'], skirmish: ['easy'] } as const
    const badges = cleanBadges(b)
    expect(badgeCount(badges)).toBe(6)
    expect(badgeCount(badges, ['crossfire', 'last-stand', 'ex-void-gate'])).toBe(5)
  })

  it('keeps only real levels, in order, once each, from a damaged store', () => {
    expect(cleanBadges({ a: ['impossible', 'easy', 'easy', 'godlike', 3], b: 'hard', c: [], ['x'.repeat(65)]: ['easy'] })).toEqual({ a: ['easy', 'impossible'] })
    expect(cleanBadges(null)).toEqual({})
    expect(cleanBadges([['easy']])).toEqual({})
    expect(loadBadges(memStore({ [BADGES_KEY]: '{not json' }))).toEqual({})
    expect(loadBadges(null)).toEqual({})
  })

  it('withBadge leaves the input alone', () => {
    const b = { crossfire: ['easy' as const] }
    const next = withBadge(b, 'crossfire', 'normal')
    expect(b.crossfire).toEqual(['easy'])
    expect(next.crossfire).toEqual(['easy', 'normal'])
    expect(withBadge(next, 'crossfire', 'normal')).toBe(next)
  })

  it('still celebrates when storage is blocked', () => {
    const store = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    expect(earnBadge('crossfire', 'easy', store)).toBe(true)
  })

  it('is cleared by Profile → Reset and counted (only) in debug info', () => {
    expect(PREF_KEYS.map((k) => k.key)).toContain(BADGES_KEY)
    const store = memStore({ [BADGES_KEY]: JSON.stringify({ crossfire: ['easy'] }) })
    resetPreferences(store)
    expect(store.raw.has(BADGES_KEY)).toBe(false)
    const text = settingsText({ sound: true, volume: 1, perf: false, skin: 'classic', colour: 'gold', difficulty: 'hard', badges: 7 })
    expect(text['win badges']).toBe('7')
    expect(JSON.stringify(text)).not.toContain('crossfire')
  })

  it('names the badge and carries it to the result view', () => {
    expect(badgeName('Vex', 'Impossible')).toBe('Beat Vex (Impossible)')
    const v = offlineResult({ ...base, result: 'win', bot: { level: 'impossible', name: 'Vex', line: 'Hmph.', newBadge: 'Beat Vex (Impossible)' } })
    expect(v.bot?.newBadge).toBe('Beat Vex (Impossible)')
    const plain = offlineResult({ ...base, result: 'win', bot: { level: 'easy', name: 'Dumpling', line: 'Yay!' } })
    expect(plain.bot?.newBadge).toBeUndefined()
  })
})
