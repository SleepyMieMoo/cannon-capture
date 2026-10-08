import { afterEach, describe, expect, it } from 'vitest'
import { BRAND } from '../src/config/brand'
import { CAMPAIGN, EXAMPLE_MAPS, SKIRMISH } from '../src/levels'
import { DEFAULT_PREFS, DIFFICULTY, loadMenuPrefs, nextPuzzle, pickMap, puzzleChoices, saveMenuPrefs, vsAiMaps } from '../src/menu/menuModel'
import { PauseHold } from '../src/menu/pauseHold'
import { EDITOR_KEY, MAIN_MENU, MenuNav, backLabel, backRoute, editorReturn, vsAiLevel } from '../src/menu/routes'
import { isTypingTarget } from '../src/ui/typing'
import { BattleSim } from '../src/sim/BattleSim'
import { levelLanes } from '../src/sim/solver'
import { AI_LEVELS, type LevelDef } from '../src/types'
import type { SavedMap } from '../src/editor/maps'

const saved = (level: LevelDef): SavedMap => ({ level, updated: 0 })
const myBattle: LevelDef = { ...SKIRMISH, id: 'map-mine', name: 'Mine' }
const myPuzzle: LevelDef = { ...CAMPAIGN[0], id: 'map-puz', name: 'My puzzle', kind: 'puzzle', aims: 3, hint: undefined }
const broken: LevelDef = { ...SKIRMISH, id: 'map-broken', name: 'Broken', cannons: SKIRMISH.cannons.filter((c) => c.side !== 'enemy') }

describe('menu navigation', () => {
  it('Back (or Esc) goes up one screen; nothing above home', () => {
    const nav = new MenuNav()
    expect(nav.screen).toBe('home')
    expect(nav.back()).toBe(false)
    nav.open('play')
    expect(nav.screen).toBe('play')
    nav.open('play')
    expect(nav.depth).toBe(2)
    expect(nav.back()).toBe(true)
    expect(nav.screen).toBe('home')
    nav.open('settings')
    nav.open('howto')
    nav.home()
    expect(nav.screen).toBe('home')
    expect(nav.depth).toBe(1)
  })

  it('coming back from a battle opens its screen, with home underneath', () => {
    const nav = new MenuNav('puzzles')
    expect(nav.screen).toBe('puzzles')
    expect(nav.back()).toBe(true)
    expect(nav.screen).toBe('home')
  })
})

describe('battle routes', () => {
  const ctx = (o: Partial<Parameters<typeof backRoute>[0]>) => ({ levelId: 'x', levelIndex: -1, custom: false, ...o })
  it('Back returns to where the battle started', () => {
    expect(backRoute(ctx({ from: 'menu', custom: true }))).toEqual({ scene: 'title', data: { screen: 'play' } })
    expect(backRoute(ctx({ from: 'puzzles', levelIndex: 0 }))).toEqual({ scene: 'title', data: { screen: 'puzzles' } })
    expect(backRoute(ctx({ from: 'editor', custom: true }))).toEqual({ scene: 'editor', data: { resume: true } })
    expect(backRoute(ctx({ from: 'maps', custom: true }))).toEqual({ scene: 'maps' })
    expect(backRoute(ctx({ levelIndex: 3, levelId: 'walls' }))).toEqual({ scene: 'map', data: { focus: 'walls' } })
    expect(backRoute(ctx({ custom: true }))).toEqual({ scene: 'maps' })
    expect(backRoute(ctx({}))).toEqual({ scene: 'title' })
    expect(MAIN_MENU).toEqual({ scene: 'title', data: { screen: 'home' } })
  })

  it('labels match', () => {
    expect(backLabel(ctx({ from: 'menu' }), false)).toBe('Change map or difficulty')
    expect(backLabel(ctx({ from: 'puzzles' }), true)).toBe('Puzzles')
    expect(backLabel(ctx({ levelIndex: 2 }), false)).toBe('Back to map')
    expect(backLabel(ctx({ from: 'editor' }), true)).toBe('Editor')
    expect(backLabel(ctx({ custom: true }), false)).toBe('My maps')
  })

  it('the playtest shortcut (top bar button and E) only exists for battles from the editor, and goes back to its working copy', () => {
    expect(EDITOR_KEY).toBe('E')
    expect(editorReturn(ctx({ from: 'editor', custom: true }))).toEqual({ scene: 'editor', data: { resume: true } })
    for (const o of [{ from: 'menu' as const, custom: true }, { from: 'puzzles' as const, levelIndex: 0 }, { from: 'maps' as const, custom: true }, { levelIndex: 3 }, { custom: true }, {}]) {
      expect(editorReturn(ctx(o))).toBeNull()
    }
  })

  it('shortcuts skip text fields', () => {
    expect(isTypingTarget({ tagName: 'INPUT', type: 'text' })).toBe(true)
    expect(isTypingTarget({ tagName: 'input' })).toBe(true)
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(isTypingTarget({ tagName: 'INPUT', type: 'range' })).toBe(false)
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false)
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isTypingTarget({ tagName: 'CANVAS' })).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('Play vs AI', () => {
  it('offers Skirmish first, the campaign battle boards, the obstacle examples, then your playable battle maps', () => {
    const maps = vsAiMaps([saved(myBattle), saved(myPuzzle), saved(broken)])
    expect(maps[0].id).toBe('skirmish')
    expect(maps.filter((m) => m.group === 'Built-in').map((m) => m.id)).toEqual(['skirmish', ...CAMPAIGN.filter((l) => l.kind !== 'puzzle').map((l) => l.id), ...EXAMPLE_MAPS.map((l) => l.id)])
    expect(maps.filter((m) => m.group === 'My maps').map((m) => m.id)).toEqual(['map-mine'])
  })

  it('plays the map unchanged except for the picked difficulty (no campaign hint or par)', () => {
    const maps = vsAiMaps([])
    const campaignBattle = maps.find((m) => m.level.hint)!
    for (const d of AI_LEVELS) {
      const level = vsAiLevel(campaignBattle, d)
      expect(level.ai).toEqual({ difficulty: d })
      expect(level.hint).toBeUndefined()
      expect(level.par).toBeUndefined()
      expect(level.cannons).toEqual(campaignBattle.level.cannons)
      expect(level.walls).toEqual(campaignBattle.level.walls)
      expect(level.kind).toBe('battle')
    }
    // The campaign level itself is untouched.
    expect(campaignBattle.level.hint).toBeTruthy()
  })

  it('falls back to the first map when the remembered one is gone', () => {
    const maps = vsAiMaps([saved(myBattle)])
    expect(pickMap(maps, 'map-mine').id).toBe('map-mine')
    expect(pickMap(maps, 'deleted').id).toBe('skirmish')
  })

  it('has a one-line description for every difficulty', () => {
    for (const d of AI_LEVELS) expect(DIFFICULTY[d].blurb.length).toBeGreaterThan(10)
  })
})

describe('Puzzles', () => {
  it('lists the campaign puzzles in order with their stars, then your puzzle maps', () => {
    const list = puzzleChoices({ stars: { 'first-shots': 3 } }, [saved(myPuzzle), saved(myBattle)])
    const campaign = CAMPAIGN.filter((l) => l.kind === 'puzzle')
    expect(list.slice(0, campaign.length).map((p) => p.id)).toEqual(campaign.map((l) => l.id))
    expect(list[0]).toMatchObject({ label: 'Puzzle 1', stars: 3, custom: false })
    expect(list[1].stars).toBe(0)
    expect(list.at(-1)).toMatchObject({ id: 'map-puz', custom: true, label: '3 aims' })
    expect(list).toHaveLength(campaign.length + 1)
  })

  it('"Next puzzle" walks the campaign puzzles only', () => {
    const campaign = CAMPAIGN.filter((l) => l.kind === 'puzzle')
    expect(nextPuzzle(campaign[0].id)?.id).toBe(campaign[1].id)
    expect(nextPuzzle(campaign.at(-1)!.id)).toBeNull()
    expect(nextPuzzle('skirmish')).toBeNull()
  })
})

describe('remembered choices', () => {
  const g = globalThis as unknown as { window?: unknown }
  const had = 'window' in g
  const before = g.window
  afterEach(() => {
    if (had) g.window = before
    else delete g.window
  })

  it('saves the last difficulty and map, with safe fallbacks', () => {
    const store = new Map<string, string>()
    g.window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } }
    expect(loadMenuPrefs()).toEqual(DEFAULT_PREFS)
    saveMenuPrefs({ difficulty: 'impossible', mapId: 'map-mine' })
    expect(loadMenuPrefs()).toEqual({ difficulty: 'impossible', mapId: 'map-mine' })
    store.set('cannon-capture:menu:v1', '{"difficulty":"godlike","mapId":7}')
    expect(loadMenuPrefs()).toEqual(DEFAULT_PREFS)
    store.set('cannon-capture:menu:v1', '{oops')
    expect(loadMenuPrefs()).toEqual(DEFAULT_PREFS)
  })
})

describe('in-battle menu pause', () => {
  const sim = () => {
    const level = { ...SKIRMISH, ai: { difficulty: 'normal' as const } }
    return new BattleSim(level, null, {}, levelLanes(level))
  }

  it('pauses while open and resumes on close', () => {
    const s = sim()
    const hold = new PauseHold(() => s)
    hold.hold()
    expect(s.paused).toBe(true)
    const t = s.clock
    for (let i = 0; i < 30; i++) s.step(16)
    expect(s.clock).toBe(t)
    hold.release()
    expect(s.paused).toBe(false)
  })

  it('leaves your own tactical pause on', () => {
    const s = sim()
    s.pause()
    const hold = new PauseHold(() => s)
    hold.hold()
    hold.release()
    expect(s.paused).toBe(true)
  })

  it('does nothing to a finished round, and double open/close is safe', () => {
    const s = sim()
    s.ended = 'win'
    const hold = new PauseHold(() => s)
    hold.hold()
    hold.hold()
    expect(s.paused).toBe(false)
    hold.release()
    hold.release()
    expect(s.paused).toBe(false)
  })
})

describe('brand', () => {
  it('names live in one place', () => {
    expect(BRAND.title).toBe('Cannon Capture')
    expect(BRAND.byline).toBe('by SleepyMie')
    expect(BRAND.levelsLabel).toBe('Levels')
  })
})
