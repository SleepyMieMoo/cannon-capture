import { beforeEach, describe, expect, it } from 'vitest'
import {
  LIMITS,
  blankMap,
  decodeShare,
  deleteMap,
  editorWall,
  getMapView,
  sanitizeView,
  encodeShare,
  listMaps,
  loadDraft,
  renameMap,
  sanitizeLevel,
  saveDraft,
  saveMap,
  tidyWall,
  validateMap,
} from '../src/editor/maps'
import { CAMPAIGN } from '../src/levels'
import { MAP_SIZE_IDS, boardFor } from '../src/levels/board'
import { BattleSim } from '../src/sim/BattleSim'
import { MirrorBot } from '../src/sim/bots'
import { LaneBuilder } from '../src/sim/solver'
import { circleWall } from '../src/sim/geometry'
import { Broadphase, aimShot, traceShot } from '../src/sim/ballistics'
import { levelBodies, levelFans, shotOpts } from '../src/sim/solver'
import { TUNING } from '../src/config/tuning'
import type { CannonDef, LevelDef, Side, WallDef } from '../src/types'

class MemoryStorage {
  private data = new Map<string, string>()
  getItem(k: string): string | null {
    return this.data.has(k) ? (this.data.get(k) as string) : null
  }
  setItem(k: string, v: string): void {
    this.data.set(k, String(v))
  }
  removeItem(k: string): void {
    this.data.delete(k)
  }
  clear(): void {
    this.data.clear()
  }
}

describe('map sizes', () => {
  it('scales the original board and keeps its top-left corner', () => {
    const small = boardFor('small')
    expect(small).toEqual({ x: 24, y: 88, w: 1152, h: 608 })
    expect(boardFor('medium')).toEqual({ x: 24, y: 88, w: 1728, h: 912 })
    expect(boardFor('large')).toEqual({ x: 24, y: 88, w: 2304, h: 1216 })
    expect(boardFor('huge')).toEqual({ x: 24, y: 88, w: 3456, h: 1824 })
    expect(boardFor(undefined)).toEqual(small)
    expect(MAP_SIZE_IDS).toEqual(['small', 'medium', 'large', 'huge'])
  })
})

describe('sanitizeLevel and share codes', () => {
  it('passes every campaign level through unchanged', () => {
    for (const level of CAMPAIGN) {
      const clean = sanitizeLevel(level)
      // The legacy sniper `delay` field (still on one campaign cannon) is ignored and dropped.
      expect(clean.cannons).toEqual(level.cannons.map(({ delay: _legacy, ...c }) => c))
      expect(clean.walls).toEqual(level.walls)
      expect(clean.fans.map((f) => ({ ...f, force: undefined }))).toEqual(level.fans.map((f) => ({ ...f, force: undefined })))
      expect(clean.kind ?? 'battle').toBe(level.kind ?? 'battle')
      expect(clean.aims).toBe(level.aims)
    }
  })

  it('round-trips a map through a share code', () => {
    for (const level of CAMPAIGN) {
      const code = encodeShare(level)
      expect(code.startsWith('CC1:')).toBe(true)
      expect(code).toMatch(/^CC1:[A-Za-z0-9_-]+$/)
      expect(decodeShare(code)).toEqual(sanitizeLevel(level))
      // Pasted with line breaks / spaces still works.
      expect(decodeShare(`  ${code.slice(0, 30)}\n${code.slice(30)}  `)).toEqual(sanitizeLevel(level))
    }
  })

  it('keeps non-ASCII map names intact', () => {
    const level = { ...blankMap(), name: 'Choco ☕ maze — ñ' }
    expect(decodeShare(encodeShare(level)).name).toBe('Choco ☕ maze — ñ')
  })

  it('accepts raw JSON too', () => {
    const level = blankMap('large')
    expect(decodeShare(JSON.stringify(level))).toEqual(sanitizeLevel(level))
  })

  it('rejects junk with a readable message', () => {
    expect(() => decodeShare('')).toThrow(/Paste/)
    expect(() => decodeShare('CC1:%%%')).toThrow(/damaged/)
    expect(() => decodeShare('CC1:' + btoa('not json'))).toThrow(/damaged/)
    expect(() => decodeShare('{"name":"x"}')).toThrow(/cannons/)
    expect(() => sanitizeLevel(42)).toThrow()
  })

  it('clamps, de-duplicates and drops unknown fields', () => {
    const raw = {
      name: '   ',
      size: 'gigantic',
      kind: 'puzzle',
      aims: 500,
      evil: '<script>',
      cannons: [
        { id: 'p1', name: 'P1', x: -500, y: 99999, side: 'player', aimAt: 'nope' },
        { id: 'p1', name: 'dupe', x: 300, y: 300, side: 'player' },
        { id: 'n1', x: 'abc', y: 400, side: 'pirate' },
        null,
      ],
      walls: [{ x: 100, y: 100, w: 1e9, h: 2, angle: 'x' }],
      fans: [{ x: 400, y: 400, radius: 9000, angle: 1, force: -5 }],
    }
    const level = sanitizeLevel(raw)
    const b = boardFor('small')
    expect(level.size).toBe('small')
    expect(level.name).toBe('Shared map')
    expect(level.aims).toBe(99)
    expect('evil' in level).toBe(false)
    expect(level.cannons).toHaveLength(3)
    expect(new Set(level.cannons.map((c) => c.id)).size).toBe(3)
    expect(level.cannons[0].aimAt).toBeUndefined()
    expect(level.cannons[2].side).toBe('neutral')
    for (const c of level.cannons) {
      expect(c.x).toBeGreaterThanOrEqual(b.x)
      expect(c.x).toBeLessThanOrEqual(b.x + b.w)
      expect(c.y).toBeGreaterThanOrEqual(b.y)
      expect(c.y).toBeLessThanOrEqual(b.y + b.h)
    }
    expect(level.walls[0].w).toBeLessThanOrEqual(b.w)
    expect(level.walls[0].h).toBeGreaterThanOrEqual(8)
    expect(level.fans[0].radius).toBeLessThanOrEqual(400)
    expect(level.fans[0].force).toBeGreaterThanOrEqual(50)
  })

  it('caps item counts', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, name: 'N', x: 100 + (i % 20) * 50, y: 120 + Math.floor(i / 20) * 50, side: 'neutral' }))
    expect(sanitizeLevel({ cannons: many, walls: [], fans: [] }).cannons).toHaveLength(LIMITS.cannons)
  })
})

describe('walls in the editor', () => {
  it('tidies quarter and half turns back to plain boxes', () => {
    const wall = { x: 100, y: 200, w: 200, h: 20 }
    expect(tidyWall(wall, 0)).toEqual(wall)
    expect(tidyWall(wall, Math.PI)).toEqual(wall)
    expect(tidyWall(wall, Math.PI / 2)).toEqual({ x: 190, y: 110, w: 20, h: 200 })
    expect(tidyWall(wall, -Math.PI / 4).angle).toBeCloseTo((3 * Math.PI) / 4, 3)
  })

  it('editorWall keeps the same footprint with w as the length', () => {
    const tall = { x: 600, y: 330, w: 26, h: 366 }
    const ed = editorWall(tall)
    expect(ed.w).toBe(366)
    expect(ed.angle).toBeCloseTo(Math.PI / 2)
    // Same collision footprint.
    for (const [x, y] of [[613, 340], [613, 690], [590, 500], [640, 500], [613, 320]]) {
      expect(!!circleWall(x, y, 6, ed as WallDef)).toBe(!!circleWall(x, y, 6, tall))
    }
    expect(sanitizeLevel({ cannons: [], walls: [ed], fans: [] }).walls[0]).toEqual(tall)
  })
})

describe('validateMap', () => {
  const cannon = (id: string, side: Side): CannonDef => ({ id, name: id, x: 300, y: 300, side })
  const map = (kind: 'battle' | 'puzzle', sides: Side[]): LevelDef => ({
    id: 't',
    name: 't',
    kind,
    cannons: sides.map((s, i) => ({ ...cannon(`${s}${i}`, s), x: 100 + i * 60 })),
    walls: [],
    fans: [],
  })
  it('needs a player cannon', () => {
    expect(validateMap(map('battle', ['enemy']))[0]).toMatch(/gold/)
  })
  it('battles need an enemy', () => {
    expect(validateMap(map('battle', ['player', 'neutral'])).join()).toMatch(/enemy/)
    expect(validateMap(map('battle', ['player', 'enemy']))).toEqual([])
  })
  it('puzzles need neutrals and no enemy', () => {
    expect(validateMap(map('puzzle', ['player'])).join()).toMatch(/neutral/)
    expect(validateMap(map('puzzle', ['player', 'neutral', 'enemy'])).join()).toMatch(/no enemy/)
    expect(validateMap(map('puzzle', ['player', 'neutral']))).toEqual([])
  })
  it('a blank editor map is ready to play', () => {
    expect(validateMap(blankMap())).toEqual([])
  })
})

describe('My maps storage', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage()
  })

  it('saves, lists, renames and deletes', () => {
    const a = saveMap({ ...blankMap(), id: 'a', name: 'Alpha' })
    saveMap({ ...blankMap('huge'), id: 'b', name: 'Bravo' })
    expect(listMaps().map((m) => m.level.id).sort()).toEqual(['a', 'b'])
    saveMap({ ...a, name: 'Alpha 2' })
    expect(listMaps()).toHaveLength(2)
    expect(listMaps().find((m) => m.level.id === 'a')?.level.name).toBe('Alpha 2')
    renameMap('b', 'Big one')
    expect(listMaps().find((m) => m.level.id === 'b')?.level.name).toBe('Big one')
    expect(listMaps().find((m) => m.level.id === 'b')?.level.size).toBe('huge')
    deleteMap('a')
    expect(listMaps().map((m) => m.level.id)).toEqual(['b'])
  })

  it('survives corrupt storage', () => {
    localStorage.setItem('cannon-capture:maps:v1', '{not json')
    expect(listMaps()).toEqual([])
    localStorage.setItem('cannon-capture:maps:v1', JSON.stringify({ maps: [{ level: 5 }, { level: blankMap(), updated: 1 }] }))
    expect(listMaps()).toHaveLength(1)
  })

  it('keeps the editor draft', () => {
    const level = blankMap('medium')
    saveDraft(level, null)
    expect(loadDraft()?.level).toEqual(sanitizeLevel(level))
    expect(loadDraft()?.view).toBeUndefined()
  })

  it('remembers the camera with the draft and with saved maps', () => {
    const level = { ...blankMap('huge'), id: 'cam' }
    saveDraft(level, 'cam', { zoom: 0.42, x: 1500.25, y: 900 })
    expect(loadDraft()?.view).toEqual({ zoom: 0.42, x: 1500.25, y: 900 })
    saveMap(level, { zoom: 0.6, x: 700, y: 500 })
    expect(getMapView('cam')).toEqual({ zoom: 0.6, x: 700, y: 500 })
    // Saving again without a camera keeps the last one.
    saveMap({ ...level, name: 'Renamed' })
    expect(getMapView('cam')).toEqual({ zoom: 0.6, x: 700, y: 500 })
    renameMap('cam', 'Again')
    expect(getMapView('cam')).toEqual({ zoom: 0.6, x: 700, y: 500 })
    expect(sanitizeView({ zoom: 'x', x: 1, y: 2 })).toBeUndefined()
    expect(sanitizeView({ zoom: 99, x: 1, y: 2 })?.zoom).toBe(4)
  })
})

/** A busy Huge map: lots of cannons and walls scattered over the board. */
function hugeMap(cannons = 48, walls = 60): LevelDef {
  const b = boardFor('huge')
  let seed = 7
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const list: CannonDef[] = []
  const sides: Side[] = ['player', 'enemy', 'neutral']
  for (let i = 0; i < cannons; i++) {
    const side = i < 4 ? 'player' : i < 8 ? 'enemy' : sides[i % 3]
    list.push({ id: `c${i}`, name: `C${i}`, side, x: Math.round(b.x + 80 + ((i * 397) % (b.w - 160))), y: Math.round(b.y + 80 + ((i * 251) % (b.h - 160))) })
  }
  const wallList: WallDef[] = []
  for (let i = 0; i < walls; i++) {
    wallList.push({ x: Math.round(b.x + rnd() * (b.w - 300)), y: Math.round(b.y + rnd() * (b.h - 60)), w: 220, h: 26, angle: rnd() < 0.5 ? 0.5 : undefined })
  }
  return sanitizeLevel({ id: 'huge-test', name: 'Huge', size: 'huge', kind: 'battle', cannons: list, walls: wallList, fans: [{ x: 1500, y: 900, radius: 200, angle: 0 }] })
}

describe('AI on big maps', () => {
  it('the broadphase grid traces exactly like testing every wall', () => {
    for (const level of [hugeMap(30, 60), ...CAMPAIGN]) {
      const bodies = levelBodies(level)
      const fans = levelFans(level)
      const opts = shotOpts(level)
      const near = new Broadphase(level.walls, bodies, TUNING.shotRadius)
      for (const from of level.cannons.slice(0, 6)) {
        for (let deg = 0; deg < 360; deg += 7) {
          const a = (deg * Math.PI) / 180
          const shot = aimShot(from, { x: from.x + Math.cos(a) * 100, y: from.y + Math.sin(a) * 100 }, TUNING.cannonRadius + 12, TUNING.shotSpeed, from.id)
          const full = traceShot(shot, level.walls, fans, bodies, opts, TUNING.shotLifetimeMs)
          const fast = traceShot(shot, level.walls, fans, bodies, opts, TUNING.shotLifetimeMs, near)
          expect(fast).toEqual(full)
        }
      }
    }
  })

  it('progressive lane building gives the same lanes as building all at once', () => {
    const level = hugeMap(20, 30)
    const all = new LaneBuilder(level).runAll()
    const step = new LaneBuilder(level)
    let frames = 0
    while (!step.pump(0.5)) frames++
    expect(frames).toBeGreaterThan(1)
    expect(step.table).toEqual(all)
  })

  it('builds enemy lanes first', () => {
    const level = hugeMap(30, 20)
    const b = new LaneBuilder(level)
    const enemies = level.cannons.filter((c) => c.side === 'enemy').map((c) => c.id)
    while (b.table.size < enemies.length) b.pump(0.2)
    expect([...b.table.keys()].sort()).toEqual([...enemies].sort())
  })

  it('a Huge battle runs smoothly frame by frame', () => {
    const level = hugeMap()
    const sim = new BattleSim(level, null, {}, 'progressive')
    const bot = new MirrorBot(sim)
    const dt = 1000 / 60
    let worst = 0
    let total = 0
    const frames = 60 * 20
    for (let i = 0; i < frames && !sim.ended; i++) {
      const t0 = performance.now()
      sim.pumpLanes(5)
      bot.update(dt)
      sim.step(dt)
      const spent = performance.now() - t0
      total += spent
      if (i > 5) worst = Math.max(worst, spent)
    }
    expect(sim.lanesReady).toBe(true)
    // Lane building is capped at 5ms a frame; the rest of the frame stays cheap.
    expect(total / frames).toBeLessThan(8)
    expect(worst).toBeLessThan(40)
    // Something actually happened: shots flew and cannons changed hands.
    const owned = sim.cannons.filter((c) => c.side !== 'neutral').length
    expect(owned).toBeGreaterThan(8)
  })
})
