import { describe, expect, it } from 'vitest'
import rawWhatsNew from '../src/data/whatsNew.json'
import mainMenuSource from '../src/menu/mainMenu.ts?raw'
import { LINKS } from '../src/menu/credits'
import { debugInfo, settingsText, urlSwitches, type DebugEnv } from '../src/menu/debugInfo'
import { KEPT_KEYS, PREF_KEYS, resetPreferences } from '../src/menu/prefs'
import { WHATS_NEW, dayLabel, parseWhatsNew } from '../src/menu/whatsNew'
import { MenuNav } from '../src/menu/routes'
import { APP_VERSION, COMMIT, versionLabel } from '../src/version'
import pkg from '../package.json'
import { MUSIC_KEY } from '../src/audio/musicSettings'
import { TRACKS } from '../src/audio/musicTracks'

const env = (over: Partial<DebugEnv> = {}): DebugEnv => ({
  version: '0.1.0',
  commit: 'abc1234',
  build: 'abc1234 2026-10-08',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0 Safari/537.36',
  browser: 'Chrome 141',
  screen: { w: 1920, h: 1080 },
  viewport: { w: 1280, h: 720 },
  dpr: 1.25,
  canvas: { w: 1600, h: 900 },
  renderer: 'WebGL2',
  gpu: 'ANGLE (Test GPU)',
  fps: 59.6,
  discord: true,
  switches: urlSwitches('?debug&room=QWER&server=https%3A%2F%2Fexample.com&frame_id=abc'),
  settings: settingsText({ sound: true, volume: 0.7, perf: false, skin: 'hex', colour: 'grape', difficulty: 'hard' }),
  ...over,
})

describe('version', () => {
  it('comes from package.json, with the commit (dev in tests)', () => {
    expect(APP_VERSION).toBe(pkg.version)
    expect(COMMIT).toBe('dev')
    expect(versionLabel('0.1.0', 'abc1234')).toBe('v0.1.0 · abc1234')
    expect(versionLabel('0.1.0', '')).toBe('v0.1.0 · dev')
  })
})

describe("What's new", () => {
  it("lists today's verified features, newest first, in player words", () => {
    expect(WHATS_NEW.length).toBeGreaterThan(0)
    const titles = WHATS_NEW.flatMap((d) => d.entries.map((e) => e.title.toLowerCase())).join(' | ')
    for (const topic of ['shield', 'editor', 'difficulty', 'ownership rings', 'heal guide', 'skins', 'healers re-aim', 'countdown', 'team colours', 'name tags', 'room settings', 'side glow', 'surrender', 'profile', 'credits', 'alt-tab']) {
      expect(titles).toContain(topic)
    }
    const dates = WHATS_NEW.map((d) => d.date)
    expect([...dates].sort().reverse()).toEqual(dates)
    for (const d of WHATS_NEW) for (const e of d.entries) {
      expect(e.text.length).toBeGreaterThan(20)
      expect(e.text.length).toBeLessThan(260)
    }
    expect(dayLabel('2026-10-08')).toBe('8 Oct 2026')
  })

  it('a broken data file never breaks the view (bad entries are left out)', () => {
    expect(parseWhatsNew(null)).toEqual([])
    expect(parseWhatsNew({ days: 'x' })).toEqual([])
    const out = parseWhatsNew({ days: [{ date: '2026-10-09', entries: [{ kind: 'new', title: 'A', text: 'ok' }, { kind: 'odd', title: 'B', text: 'x' }, { title: 'C' }] }, { date: 'soon', entries: [] }] })
    expect(out).toEqual([{ date: '2026-10-09', entries: [{ kind: 'new', title: 'A', text: 'ok' }] }])
    expect(parseWhatsNew(rawWhatsNew)).toEqual(WHATS_NEW)
  })
})

describe('Copy debug info', () => {
  it('has the technical facts for a bug report', () => {
    const text = debugInfo(env())
    for (const bit of ['v0.1.0', 'abc1234', 'Chrome 141', '1920×1080', '1280×720', 'DPR 1.25', 'canvas 1600×900', 'WebGL2', 'Test GPU', '60 FPS', 'Discord Activity: yes', 'sound on, 70%', 'skin hex', 'colour grape', 'vs AI difficulty hard']) {
      expect(text).toContain(bit)
    }
    expect(debugInfo(env({ fps: null, gpu: null, discord: false, canvas: null }))).toContain('Renderer: WebGL2\n')
  })

  it('says how the music is set, when there is a jukebox', () => {
    const on = settingsText({ sound: true, volume: 0.7, perf: false, skin: 'hex', colour: 'grape', difficulty: 'hard', music: { on: true, volume: 0.35, track: 'singularity', default: 'fartysoup' } })
    expect(on.music).toBe('on, 35%, singularity (default fartysoup)')
    const off = settingsText({ sound: true, volume: 0.7, perf: false, skin: 'hex', colour: 'grape', difficulty: 'hard', music: { on: false, volume: 0.35, track: 'singularity', default: 'robotic-spaghetti' } })
    expect(off.music).toBe('off (default robotic-spaghetti)')
    expect(env().settings).not.toHaveProperty('music')
  })

  it('leaves out anything personal: names, room codes, server addresses, maps', () => {
    const text = debugInfo(env())
    expect(env().switches).toEqual(['debug', 'server', 'frame_id'])
    expect(text).not.toContain('QWER')
    expect(text).not.toContain('example.com')
    expect(text).not.toMatch(/name/i)
    expect(text).not.toMatch(/@[a-z0-9-]+\./i)
  })
})

describe('Reset all preferences', () => {
  it('forgets every preference and keeps maps, the editor draft and stars', () => {
    const store = new Map<string, string>()
    for (const { key } of [...PREF_KEYS, ...KEPT_KEYS]) store.set(key, 'x')
    const removed = resetPreferences({ removeItem: (k) => void store.delete(k) })
    expect(removed.sort()).toEqual(PREF_KEYS.map((k) => k.key).sort())
    expect([...store.keys()].sort()).toEqual(KEPT_KEYS.map((k) => k.key).sort())
    // The online name is the room screen's key (one name, two places to edit it).
    expect(PREF_KEYS.map((k) => k.key)).toEqual(expect.arrayContaining(['cc-online-name', 'cannon-capture:skin:v1', 'cannon-capture:colour:v1', 'cannon-capture:menu:v1', 'cannon-capture:audio:v1', 'cannon-capture:perf:v1']))
    expect(KEPT_KEYS.map((k) => k.key)).toEqual(expect.arrayContaining(['cannon-capture:maps:v1', 'cannon-capture:progress:v1']))
  })

  it('the music settings are a preference (reset forgets them)', () => {
    expect(PREF_KEYS.map((k) => k.key)).toContain(MUSIC_KEY)
  })

  it('a blocked storage is fine', () => {
    expect(resetPreferences({ removeItem: () => { throw new Error('blocked') } })).toEqual([])
    expect(resetPreferences(null)).toEqual(PREF_KEYS.map((k) => k.key))
  })
})

describe('menu pages', () => {
  it('Profile, Credits and What’s new open from home and Back returns', () => {
    const nav = new MenuNav()
    nav.open('profile')
    nav.open('whatsnew')
    expect(nav.back()).toBe(true)
    expect(nav.screen).toBe('profile')
    expect(nav.back()).toBe(true)
    nav.open('credits')
    expect(nav.screen).toBe('credits')
  })

  it('Credits links the theme, the sound and its licence, the repo and the site, and shows no email', () => {
    expect(LINKS.choconeko).toBe('https://sleepymiemoo.github.io/choconeko-site/')
    expect(LINKS.sleepyMie).toBe('https://sleepymiemoo.github.io')
    expect(LINKS.repo).toBe('https://github.com/SleepyMieMoo/cannon-capture')
    expect(LINKS.pixabayLicense).toContain('pixabay.com/service/license')
    for (const href of Object.values(LINKS)) expect(href).toMatch(/^https:\/\//)
    // Every song is credited, with its Pixabay page.
    expect(mainMenuSource).toContain("row('Music'")
    for (const t of TRACKS) expect(t.page).toMatch(/^https:\/\/pixabay\.com\/music\//)
    // No email address anywhere in the menu or the changelog.
    const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/
    expect(mainMenuSource).not.toMatch(email)
    expect(JSON.stringify(rawWhatsNew)).not.toMatch(email)
  })

  it('the home grid: Play vs AI first, rows of two, then Settings, How to play and Credits as a row of three', () => {
    const grid = mainMenuSource.slice(mainMenuSource.indexOf("h('div.mm-grid'"), mainMenuSource.indexOf('soon,', mainMenuSource.indexOf("h('div.mm-grid'")))
    const ids = [...grid.matchAll(/this\.button\('([a-z]+)'/g)].map((m) => m[1])
    const thirds = [...grid.matchAll(/this\.button\('([a-z]+)'[^\n]*cls: 'third'/g)].map((m) => m[1])
    expect(ids[0]).toBe('play')
    expect(thirds).toEqual(['settings', 'howto', 'credits'])
    expect((ids.length - 1 - thirds.length) % 2).toBe(0)
    // Profile moved to the top-right corner, the jukebox sits top left.
    expect(ids).not.toContain('profile')
    expect(mainMenuSource).toContain("button.mm-corner.right")
    expect(mainMenuSource).toContain("button.mm-corner.left")
    expect(mainMenuSource).not.toContain('Colours from ChocoNeko')
  })
})
