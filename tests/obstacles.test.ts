import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning'
import { maxShotSpeedFor, shotRangeFor, shotSpeedFor } from '../src/config/kinds'
import { BattleSim, type SimEvents } from '../src/sim/BattleSim'
import { Broadphase, aimShot, stepBall, type Ball, type BallisticsOpts, type FanField } from '../src/sim/ballistics'
import { circleGlass, circlePillar, clipToGlass, clipToPillars } from '../src/sim/geometry'
import { SIM_STEP_MS } from '../src/sim/fixedStep'
import { levelLanes, shotOpts } from '../src/sim/solver'
import { EventLog, replayEvent } from '../src/net/snapshot'
import { PVP_MAPS } from '../src/net/online'
import { vsAiMaps } from '../src/menu/menuModel'
import { decodeShare, encodeShare, sanitizeLevel, validateMap, withDifficulty } from '../src/editor/maps'
import { EXAMPLE_MAPS, GLASS_GARDEN, VOID_GATE } from '../src/levels/examples'
import { SKIRMISH } from '../src/levels'
import { planHeals } from '../src/ai/AiController'
import type { CannonKind, GlassDef, LevelDef, PillarDef, WallDef } from '../src/types'

const FRAME = 1000 / 60
/** Open space: only obstacles (or range) end a shot. */
const open: BallisticsOpts = { ...shotOpts({ size: 'huge' }), bounds: { x: -1e5, y: -1e5, w: 2e5, h: 2e5 } }

function ball(x: number, y: number, angle: number, kind: CannonKind = 'normal'): Ball {
  const b = aimShot({ x, y }, { x: x + Math.cos(angle), y: y + Math.sin(angle) }, 0, shotSpeedFor(kind), 'a')
  if (kind !== 'normal') b.maxSpeed = maxShotSpeedFor(kind)
  b.range = shotRangeFor(kind)
  return b
}

interface Flight {
  ball: Ball
  absorbed: boolean
  surfaces: string[]
  /** Where it was when it first bounced. */
  firstBounce?: { x: number; y: number; vx: number; vy: number; before: { vx: number; vy: number } }
}

/** Step until the shot ends (or `ms` pass). */
function fly(b: Ball, o: { walls?: WallDef[]; pillars?: PillarDef[]; glass?: GlassDef[]; fans?: FanField[] }, ms = 20_000): Flight {
  const out: Flight = { ball: b, absorbed: false, surfaces: [] }
  for (let t = 0; t < ms && out.ball.alive; t += SIM_STEP_MS) {
    const before = { vx: out.ball.vx, vy: out.ball.vy }
    const r = stepBall(out.ball, SIM_STEP_MS, o.walls ?? [], o.fans ?? [], [], open, undefined, o.pillars ?? [], o.glass ?? [])
    out.ball = r.ball
    if (r.absorbed) out.absorbed = true
    if (r.bounced) {
      out.surfaces.push(r.surface ?? 'wall')
      out.firstBounce ??= { x: r.ball.x, y: r.ball.y, vx: r.ball.vx, vy: r.ball.vy, before }
    }
  }
  return out
}

describe('void wall', () => {
  it('absorbs a shot on contact: no bounce, flagged absorbed', () => {
    const f = fly(ball(0, 0, 0), { walls: [{ x: 200, y: -50, w: 24, h: 100, kind: 'void' }] })
    expect(f.absorbed).toBe(true)
    expect(f.ball.alive).toBe(false)
    expect(f.ball.bounces).toBe(0)
    expect(f.surfaces).toEqual([])
    // Stopped where it touched (the wall's face minus the shot radius, within one sub-step).
    expect(f.ball.x).toBeGreaterThan(200 - TUNING.shotRadius)
    expect(f.ball.x).toBeLessThanOrEqual(200 - TUNING.shotRadius + 8)
  })

  it('a plain wall in the same spot still bounces, and a rotated void wall still absorbs', () => {
    const plain = fly(ball(0, 0, 0), { walls: [{ x: 200, y: -50, w: 24, h: 100 }] })
    expect(plain.absorbed).toBe(false)
    expect(plain.surfaces[0]).toBe('wall')
    const turned = fly(ball(0, 0, 0), { walls: [{ x: 150, y: -12, w: 120, h: 24, angle: Math.PI / 3, kind: 'void' }] })
    expect(turned.absorbed).toBe(true)
  })

  it('a shot that banked off a plain wall into a void wall dies there', () => {
    const f = fly(ball(0, 0, -Math.PI / 4), { walls: [{ x: 100, y: -200, w: 400, h: 40 }, { x: 330, y: -150, w: 24, h: 300, kind: 'void' }] })
    expect(f.surfaces).toEqual(['wall'])
    expect(f.absorbed).toBe(true)
  })

  it('in a round: the absorbed event fires, the shot is gone and the cannon behind takes no hit', () => {
    const level: LevelDef = {
      id: 'void-round', name: 'Void', kind: 'battle', fans: [],
      walls: [{ x: 500, y: 300, w: 24, h: 200, kind: 'void' }],
      cannons: [
        { id: 'p1', name: 'P1', x: 200, y: 400, side: 'player', aimAt: 'n1' },
        { id: 'n1', name: 'N1', x: 800, y: 400, side: 'neutral' },
        { id: 'e1', name: 'E1', x: 1100, y: 660, side: 'enemy' },
      ],
    }
    let absorbed = 0
    let hits = 0
    const sim = new BattleSim(level, null, { absorbed: () => absorbed++, hit: () => hits++ })
    ;(sim as unknown as { aiOff: boolean }).aiOff = true
    for (let t = 0; t < 6000; t += FRAME) sim.step(FRAME)
    expect(absorbed).toBeGreaterThan(2)
    expect(hits).toBe(0)
    expect(sim.byId('n1')!.captureProgress).toBe(0)
  })
})

describe('round pillar', () => {
  it('head-on, the shot comes straight back', () => {
    const f = fly(ball(0, 0, 0), { pillars: [{ x: 300, y: 0, r: 28 }] })
    expect(f.surfaces[0]).toBe('pillar')
    const b = f.firstBounce!
    expect(b.vx).toBeCloseTo(-b.before.vx, 6)
    expect(Math.abs(b.vy)).toBeLessThan(1e-6)
  })

  it('off-centre, it reflects about the surface normal at the contact point (speed kept)', () => {
    for (const offset of [8, 16, 24, 32]) {
      const p = { x: 300, y: 0, r: 28 }
      const f = fly(ball(0, offset, 0), { pillars: [p] })
      const b = f.firstBounce!
      // The normal from the pillar's centre to the shot when it hit (it is pushed out along it).
      const nx = b.x - p.x
      const ny = b.y - p.y
      const len = Math.hypot(nx, ny)
      expect(len).toBeCloseTo(p.r + TUNING.shotRadius + 0.75, 0)
      const ux = nx / len
      const uy = ny / len
      const dot = b.before.vx * ux + b.before.vy * uy
      expect(b.vx).toBeCloseTo(b.before.vx - 2 * dot * ux, 3)
      expect(b.vy).toBeCloseTo(b.before.vy - 2 * dot * uy, 3)
      expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(Math.hypot(b.before.vx, b.before.vy), 3)
      // The further off-centre, the wider it glances (always downward: it hit the lower half).
      expect(b.vy).toBeGreaterThan(0)
    }
    // A miss is a miss.
    expect(fly(ball(0, 28 + TUNING.shotRadius + 1, 0), { pillars: [{ x: 300, y: 0, r: 28 }] }).surfaces).toEqual([])
  })

  it('the three editor sizes all bounce; geometry helpers agree', () => {
    for (const r of [18, 28, 44]) expect(fly(ball(0, 0, 0), { pillars: [{ x: 300, y: 0, r }] }).surfaces[0]).toBe('pillar')
    expect(circlePillar(300 - 28 - 4, 0, 6, { x: 300, y: 0, r: 28 })).toBeTruthy()
    expect(circlePillar(300 - 28 - 7, 0, 6, { x: 300, y: 0, r: 28 })).toBeNull()
    const c = clipToPillars(0, 0, 600, 0, [{ x: 300, y: 0, r: 28 }])
    expect(c.x).toBeCloseTo(272, 3)
  })
})

describe('one-way glass', () => {
  // A vertical pane at x = 300 drawn upward: its solid side faces right (+x).
  const pane: GlassDef = { x: 300, y: 100, x2: 300, y2: -100 }
  it('the solid side is the left-hand normal of the segment; flip swaps it', () => {
    expect(circleGlass(303, 0, 6, pane)!.solid).toBe(true)
    expect(circleGlass(297, 0, 6, pane)!.solid).toBe(false)
    expect(circleGlass(303, 0, 6, { ...pane, flip: true })!.solid).toBe(false)
  })

  it('passes shots from the open side untouched and bounces them off the solid side', () => {
    const through = fly(ball(0, 0, 0), { glass: [pane] }, 2000)
    expect(through.surfaces).toEqual([])
    expect(through.ball.x).toBeGreaterThan(400)
    expect(through.ball.vy).toBe(0)
    const back = fly(ball(600, 0, Math.PI), { glass: [pane] }, 2000)
    expect(back.surfaces[0]).toBe('glass')
    expect(back.firstBounce!.vx).toBeGreaterThan(0)
    expect(back.ball.x).toBeGreaterThan(300)
  })

  it('flipped, the directions swap', () => {
    const flipped = { ...pane, flip: true }
    expect(fly(ball(0, 0, 0), { glass: [flipped] }, 2000).surfaces[0]).toBe('glass')
    expect(fly(ball(600, 0, Math.PI), { glass: [flipped] }, 2000).surfaces).toEqual([])
  })

  it('at an angle the bounce mirrors the pane; a shot past its end misses', () => {
    const f = fly(ball(600, -60, Math.PI - 0.4), { glass: [pane] }, 2000)
    const b = f.firstBounce!
    expect(b.vx).toBeCloseTo(-b.before.vx, 6)
    expect(b.vy).toBeCloseTo(b.before.vy, 6)
    expect(fly(ball(600, 140, Math.PI), { glass: [pane] }, 1000).surfaces).toEqual([])
  })

  it('a corner of glass and a wall counts once; the aim preview stops only at the solid side', () => {
    const f = fly(ball(500, 50, Math.PI * 0.75), { glass: [pane], walls: [{ x: 200, y: -140, w: 200, h: 40 }] }, 2000)
    expect(f.ball.bounces).toBeLessThanOrEqual(f.surfaces.length)
    expect(clipToGlass(0, 0, 600, 0, [pane]).x).toBe(600)
    expect(clipToGlass(600, 0, 0, 0, [pane]).x).toBeCloseTo(300, 6)
  })
})

describe('with fans, the sniper, shields and healers', () => {
  it('a sniper keeps its full (2x) range banking off pillars and glass', () => {
    const b = ball(0, 0, 0, 'sniper')
    const f = fly(b, { pillars: [{ x: 600, y: 0, r: 44 }], glass: [{ x: -300, y: -200, x2: -300, y2: 200, flip: true }] })
    expect(f.surfaces).toContain('pillar')
    expect(f.surfaces).toContain('glass')
    expect(f.ball.travelled).toBeCloseTo(shotRangeFor('sniper'), 3)
  })

  it('a fan can blow a shot into a void wall or bounce it off glass', () => {
    const fan: FanField = { x: 200, y: 0, radius: 150, angle: Math.PI / 2, force: 900 }
    const intoVoid = fly(ball(0, 0, 0), { fans: [fan], walls: [{ x: 100, y: 200, w: 400, h: 24, kind: 'void' }] })
    expect(intoVoid.absorbed).toBe(true)
    // The pane's solid side faces up (drawn right to left): the fan pushes the shot down into it.
    const glassy = fly(ball(0, 0, 0), { fans: [fan], glass: [{ x: 500, y: 200, x2: -100, y2: 200 }] })
    expect(glassy.surfaces[0]).toBe('glass')
  })

  it('a shield still blocks a shot that banked off a pillar or glass', () => {
    // A shield's arc below y = 0 around x = 150; the shot starts past it heading right.
    const barrier = { id: 's1', x: 150, y: 60, r: 60, facing: -Math.PI / 2, half: 0.5, band: 10, pad: 0.05 }
    const run = (o: { pillars?: PillarDef[]; glass?: GlassDef[] }) => {
      let s = ball(200, 0, 0)
      let blockedBy: string | undefined
      for (let t = 0; t < 6000 && s.alive; t += SIM_STEP_MS) {
        const r = stepBall(s, SIM_STEP_MS, [], [], [], open, [barrier], o.pillars ?? [], o.glass ?? [])
        s = r.ball
        blockedBy ??= r.blockedBy
      }
      return { blockedBy, bounces: s.bounces }
    }
    expect(run({})).toEqual({ blockedBy: undefined, bounces: 0 })
    expect(run({ pillars: [{ x: 360, y: 0, r: 28 }] })).toEqual({ blockedBy: 's1', bounces: 1 })
    expect(run({ glass: [{ x: 360, y: 100, x2: 360, y2: -100, flip: true }] })).toEqual({ blockedBy: 's1', bounces: 1 })
  })

  it('the AI heals around a void wall by banking off a pillar', () => {
    const level: LevelDef = {
      id: 'heal-pillar', name: 'Heal', kind: 'battle', fans: [],
      walls: [{ x: 880, y: 380, w: 40, h: 24, kind: 'void' }],
      pillars: [{ x: 700, y: 392, r: 44 }],
      cannons: [
        { id: 'p1', name: 'P1', x: 150, y: 400, side: 'player' },
        { id: 'e1', name: 'E1', x: 900, y: 300, side: 'enemy' },
        { id: 'e2', name: 'E2', x: 900, y: 484, side: 'enemy' },
      ],
    }
    const lanes = levelLanes(level)
    const lane = lanes.get('e1')!.get('e2')!
    expect(lane).toBeTruthy()
    expect(lane.direct).toBe(false)
    expect(lane.tricks).toBeGreaterThanOrEqual(1)
    const sim = new BattleSim(level, null, {}, lanes)
    const e2 = sim.byId('e2')!
    e2.captureAttacker = 'player'
    e2.captureProgress = 6
    const orders = planHeals('enemy', sim.cannons, sim.lanes)
    expect(orders.map((o) => [o.helper.id, o.friend.id])).toEqual([['e1', 'e2']])
  })
})

describe('AI awareness (shared ball steps)', () => {
  /** P1 and a neutral with a short void wall between (it swallows every straight shot). */
  const blocker: WallDef = { x: 538, y: 370, w: 24, h: 44, kind: 'void' }
  const duel = (extra: Partial<LevelDef>): LevelDef => ({
    id: 'aware', name: 'Aware', kind: 'battle', fans: [], walls: [blocker],
    cannons: [
      { id: 'p1', name: 'P1', x: 400, y: 392, side: 'player' },
      { id: 'n1', name: 'N1', x: 700, y: 392, side: 'neutral' },
      { id: 'e1', name: 'E1', x: 1120, y: 120, side: 'enemy' },
    ],
    ...extra,
  })
  const lane = (lv: LevelDef, kind = '') => levelLanes(lv).get('p1' + kind)?.get('n1')
  /** True if a lane's middle path ever enters the void wall. */
  const throughVoid = (path: number[]): boolean => {
    for (let i = 2; i < path.length; i += 2) {
      for (let k = 0; k <= 20; k++) {
        const x = path[i - 2] + ((path[i] - path[i - 2]) * k) / 20
        const y = path[i - 1] + ((path[i + 1] - path[i - 1]) * k) / 20
        if (x > blocker.x && x < blocker.x + blocker.w && y > blocker.y && y < blocker.y + blocker.h) return true
      }
    }
    return false
  }

  it('never plans a lane through a void wall (nothing gets past it, even to a target right behind)', () => {
    for (const kind of ['', '#sniper', '#machinegun']) expect(lane(duel({}), kind)).toBeUndefined()
  })

  it('plans bank shots off pillars and the solid side of glass, counted as trick shots, clear of the void', () => {
    const viaPillar = lane(duel({ pillars: [{ x: 550, y: 282, r: 44 }] }))!
    expect(viaPillar).toBeTruthy()
    expect(viaPillar.direct).toBe(false)
    expect(viaPillar.tricks).toBe(1)
    expect(throughVoid(viaPillar.path!)).toBe(false)
    // Its path turns at the pillar's surface (centre to bounce point = radius + shot radius, give or take a step).
    expect(Math.hypot(viaPillar.path![2] - 550, viaPillar.path![3] - 282)).toBeLessThan(44 + TUNING.shotRadius + 6)
    // Glass with its solid side up (toward the cannons): a flat mirror, so a wide lane.
    const pane: GlassDef = { x: 650, y: 480, x2: 450, y2: 480 }
    for (const kind of ['', '#sniper', '#machinegun']) {
      const viaGlass = lane(duel({ glass: [pane] }), kind)!
      expect(viaGlass.tricks).toBe(1)
      expect(viaGlass.widthDeg).toBeGreaterThanOrEqual(5)
      expect(throughVoid(viaGlass.path!)).toBe(false)
      // Flipped, shots from above pass straight through: no way round.
      expect(lane(duel({ glass: [{ ...pane, flip: true }] }), kind)).toBeUndefined()
    }
  })

  it('the grid lookup (Broadphase) sees the same obstacles as the full lists', () => {
    const level = GLASS_GARDEN
    const pillars = level.pillars ?? []
    const glass = level.glass ?? []
    const near = new Broadphase(level.walls, [], TUNING.shotRadius, 24, 128, pillars, glass)
    const opts = shotOpts(level)
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let n = 0; n < 60; n++) {
      let a = ball(60 + rnd() * 1080, 100 + rnd() * 580, rnd() * Math.PI * 2)
      let b = { ...a }
      for (let t = 0; t < 4000 && a.alive; t += 16) {
        const cell = near.at(a.x, a.y)
        a = stepBall(a, 16, cell.walls, [], [], opts, undefined, cell.pillars, cell.glass).ball
        b = stepBall(b, 16, level.walls, [], [], opts, undefined, pillars, glass).ball
        expect(a.x).toBeCloseTo(b.x, 6)
        expect(a.y).toBeCloseTo(b.y, 6)
      }
    }
  })
})

describe('online: obstacle events', () => {
  it('bounce surfaces and void puffs are recorded and replayed (old rows replay as wall bounces)', () => {
    const sim = new BattleSim(VOID_GATE)
    const log = new EventLog(() => 1234)
    log.bind(sim)
    const tapped = log.tap({})
    tapped.bounce!(10, 20, 'pillar')
    tapped.bounce!(11, 21, 'glass')
    tapped.bounce!(12, 22)
    tapped.absorbed!(30, 40, 'enemy', 'sniper')
    const rows = log.take()
    expect(rows.length).toBe(4)
    const seen: unknown[] = []
    const events: SimEvents = { bounce: (x, y, s) => seen.push(['b', x, y, s]), absorbed: (x, y, side, kind) => seen.push(['a', x, y, side, kind]) }
    for (const row of rows) replayEvent(JSON.parse(JSON.stringify(row)), sim, events, false)
    expect(seen).toEqual([['b', 10, 20, 'pillar'], ['b', 11, 21, 'glass'], ['b', 12, 22, 'wall'], ['a', 30, 40, 'enemy', 'sniper']])
    // A flipped view (the second player) sees the other side's puff as its foe's.
    seen.length = 0
    replayEvent(rows[3], sim, events, true)
    expect(seen).toEqual([['a', 30, 40, 'player', 'sniper']])
  })
})

describe('maps: save format', () => {
  it('old maps (no obstacle fields) load exactly as before', () => {
    const s = sanitizeLevel(SKIRMISH)
    expect(s.pillars).toBeUndefined()
    expect(s.glass).toBeUndefined()
    expect(s.walls.every((w) => w.kind === undefined)).toBe(true)
    expect(decodeShare(encodeShare(SKIRMISH))).toEqual(s)
  })

  it('void walls, pillars and glass survive save, share codes and JSON; junk is tidied', () => {
    for (const map of EXAMPLE_MAPS) {
      const back = decodeShare(encodeShare(map))
      expect(back.walls).toEqual(map.walls)
      // Turns are kept to 4 decimals.
      expect(back.pillars?.map(({ angle, ...rest }) => rest)).toEqual(map.pillars?.map(({ angle, ...rest }) => rest))
      back.pillars?.forEach((p, i) => expect(p.angle ?? 0).toBeCloseTo(map.pillars![i].angle ?? 0, 3))
      expect(back.glass).toEqual(map.glass)
    }
    const junk = sanitizeLevel({
      ...SKIRMISH,
      walls: [{ x: 300, y: 300, w: 100, h: 20, kind: 'lava' } as unknown as WallDef, { x: 300, y: 300, w: 100, h: 20, angle: Math.PI / 2, kind: 'void' }],
      pillars: [{ x: -500, y: 400, r: 999 }, { x: 'a' } as unknown as PillarDef, null as unknown as PillarDef],
      glass: [{ x: 100, y: 100, x2: 105, y2: 100 }, { x: 100, y: 100, x2: 5000, y2: 100, flip: 'yes' } as unknown as GlassDef],
    })
    expect(junk.walls[0].kind).toBeUndefined()
    expect(junk.walls[1].kind).toBe('void')
    expect(junk.pillars!.length).toBe(2)
    expect(junk.pillars![0].r).toBe(120)
    expect(junk.pillars![0].x).toBeGreaterThanOrEqual(24 + 120)
    expect(junk.glass!.length).toBe(1)
    expect(junk.glass![0].x2).toBeLessThanOrEqual(24 + 1152)
    expect(junk.glass![0].flip).toBeUndefined()
  })
})

describe('example maps', () => {
  it('are valid, mirrored (fair) Small battles, and listed for Play vs AI and online', () => {
    for (const map of EXAMPLE_MAPS) {
      expect(validateMap(map)).toEqual([])
      expect(map.size).toBe('small')
      expect(map.kind).toBe('battle')
      const sw = (s: string) => (s === 'player' ? 'enemy' : s === 'enemy' ? 'player' : s)
      for (const c of map.cannons) expect(map.cannons.some((d) => Math.abs(d.x - (1200 - c.x)) < 1 && Math.abs(d.y - c.y) < 1 && d.side === sw(c.side))).toBe(true)
      const mirrorX = (x: number) => 1200 - x
      const mirrorTurn = (a = 0) => (a === 0 ? 0 : Math.PI - a)
      for (const p of map.pillars ?? []) expect((map.pillars ?? []).some((q) => q.x === mirrorX(p.x) && q.y === p.y && q.r === p.r && q.ry === p.ry && Math.abs((q.angle ?? 0) - mirrorTurn(p.angle)) < 1e-9)).toBe(true)
      for (const w of map.walls) expect(map.walls.some((v) => v.x === mirrorX(w.x + w.w) && v.y === w.y && v.kind === w.kind && v.hp === w.hp)).toBe(true)
      expect(vsAiMaps([]).some((c) => c.id === map.id)).toBe(true)
      expect(PVP_MAPS.some((m) => m.id === map.id)).toBe(true)
    }
    // Glass mirrors: the mirrored pane's solid side faces the other way.
    const [a, b] = GLASS_GARDEN.glass!
    expect(circleGlass(510, 392, 12, a)!.solid).toBe(true)
    expect(circleGlass(690, 392, 12, b)!.solid).toBe(true)
  })

  it('AI vs AI rounds play out on both, using the obstacles', () => {
    for (const map of EXAMPLE_MAPS) {
      const level = withDifficulty(map, 'hard')
      const surfaces = new Set<string>()
      let absorbed = 0
      const sim = new BattleSim(level, null, { bounce: (_x, _y, s) => surfaces.add(s ?? 'wall'), absorbed: () => absorbed++ }, levelLanes(level))
      sim.addAi('player', 'hard')
      while (!sim.ended && sim.clock < 150_000) sim.step(FRAME)
      expect(sim.ended).toBeTruthy()
      if (map === GLASS_GARDEN) expect([...surfaces].sort()).toEqual(['glass', 'pillar'])
      if (map === VOID_GATE) expect(absorbed).toBeGreaterThan(0)
    }
  }, 60_000)
})

