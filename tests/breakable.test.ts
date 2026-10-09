import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning'
import { damageFor, shotSpeedFor } from '../src/config/kinds'
import { BattleSim } from '../src/sim/BattleSim'
import { stepBall, aimShot, type BallisticsOpts } from '../src/sim/ballistics'
import { SIM_STEP_MS } from '../src/sim/fixedStep'
import { lanesOf, levelLanes, shotOpts } from '../src/sim/solver'
import { EventLog, applySnap, encodeSnap, replayEvent } from '../src/net/snapshot'
import { decodeShare, encodeShare, sanitizeLevel } from '../src/editor/maps'
import type { LevelDef, WallDef } from '../src/types'

const FRAME = 1000 / 60
const open: BallisticsOpts = { ...shotOpts({ size: 'huge' }), bounds: { x: -1e5, y: -1e5, w: 2e5, h: 2e5 } }

/** Gold fires at a neutral behind a breakable wall; pink is boxed in far away. */
function wallLevel(hp?: number): LevelDef {
  return {
    id: 'breakable-round', name: 'Breakable', kind: 'battle', fans: [],
    walls: [{ x: 500, y: 300, w: 24, h: 200, kind: 'breakable', ...(hp ? { hp } : {}) }],
    cannons: [
      { id: 'p1', name: 'P1', x: 200, y: 400, side: 'player', aimAt: 'n1' },
      { id: 'n1', name: 'N1', x: 800, y: 400, side: 'neutral' },
      { id: 'e1', name: 'E1', x: 1100, y: 660, side: 'enemy' },
    ],
  }
}

describe('breakable wall', () => {
  it('bounces a shot like a plain wall and reports the wall it hit', () => {
    const wall: WallDef = { x: 200, y: -50, w: 24, h: 100, kind: 'breakable' }
    let b = aimShot({ x: 0, y: 0 }, { x: 1, y: 0 }, 0, shotSpeedFor('normal'), 'a')
    b.range = 5000
    let hit: WallDef | undefined
    for (let t = 0; t < 3000 && b.alive && !hit; t += SIM_STEP_MS) {
      const r = stepBall(b, SIM_STEP_MS, [wall], [], [], open)
      b = r.ball
      if (r.bounced) {
        expect(r.surface).toBe('wall')
        hit = r.wall
      }
    }
    expect(hit).toBe(wall)
    expect(b.vx).toBeLessThan(0)
    // A plain wall reports nothing.
    let c = aimShot({ x: 0, y: 0 }, { x: 1, y: 0 }, 0, shotSpeedFor('normal'), 'a')
    for (let t = 0; t < 3000 && c.alive; t += SIM_STEP_MS) {
      const r = stepBall(c, SIM_STEP_MS, [{ ...wall, kind: undefined }], [], [], open)
      c = r.ball
      expect(r.wall).toBeUndefined()
      if (r.bounced) break
    }
  })

  it('takes each shot\'s damage, breaks for good at 0 hp, then lets shots through', () => {
    const level = wallLevel()
    const hits: number[] = []
    let broken = -1
    let reached = 0
    const sim = new BattleSim(level, null, { wallHit: (i) => hits.push(i), wallBroken: (i) => (broken = i), hit: () => reached++ })
    ;(sim as unknown as { aiOff: boolean }).aiOff = true
    expect(sim.wallHp[0]).toBe(TUNING.breakable.hp)
    expect(sim.wallHealth(0)).toBe(1)
    for (let t = 0; t < 30_000 && broken < 0; t += FRAME) sim.step(FRAME)
    expect(broken).toBe(0)
    // Normal shots do 1 damage each: exactly hp hits to break it.
    expect(hits.length).toBe(TUNING.breakable.hp / damageFor('normal'))
    expect(sim.wallHp[0]).toBe(0)
    expect(sim.intactWalls).toEqual([])
    expect(sim.byId('n1')!.captureProgress).toBe(0)
    reached = 0
    // Gone for good: no more hits on it, and the neutral starts taking shots.
    for (let t = 0; t < 8000; t += FRAME) sim.step(FRAME)
    expect(hits.length).toBe(TUNING.breakable.hp)
    expect(sim.wallHp[0]).toBe(0)
    expect(reached).toBeGreaterThan(0)
  })

  it('hp from the map, and its health fraction drives the crack stages', () => {
    let hits = 0
    const sim: BattleSim = new BattleSim(wallLevel(2), null, {
      wallHit: () => {
        hits++
        expect(sim.wallHealth(0)).toBeCloseTo(Math.max(0, 1 - hits / 2), 6)
      },
    })
    ;(sim as unknown as { aiOff: boolean }).aiOff = true
    for (let t = 0; t < 20_000 && sim.wallHp[0] > 0; t += FRAME) sim.step(FRAME)
    expect(hits).toBe(2)
  })

  it('a look-ahead fork wears down its own copy, not the real wall', () => {
    const sim = new BattleSim(wallLevel(), null, {})
    ;(sim as unknown as { aiOff: boolean }).aiOff = true
    const fork = sim.fork()
    for (let t = 0; t < 30_000 && fork.wallHp[0] > 0; t += FRAME) fork.step(FRAME)
    expect(fork.wallHp[0]).toBe(0)
    expect(sim.wallHp[0]).toBe(TUNING.breakable.hp)
    expect(sim.intactWalls.length).toBe(1)
  })

  it('once it breaks, the lanes are rebuilt without it (new ways through open up)', () => {
    const level = wallLevel()
    let broke = false
    const sim = new BattleSim(level, null, { wallBroken: () => (broke = true) }, levelLanes(level))
    const through = () => lanesOf(sim.lanes, { id: 'p1' })?.get('n1')?.direct === true
    expect(through()).toBe(false)
    // Shoot it down directly.
    sim.byId('p1')!.setAimPoint({ x: 512, y: 400 })
    for (let t = 0; t < 30_000 && !broke; t += FRAME) sim.step(FRAME)
    expect(broke).toBe(true)
    for (let t = 0; t < 30_000 && !through(); t += FRAME) sim.step(FRAME)
    expect(through()).toBe(true)
  })

  it.each(['easy', 'normal', 'hard', 'impossible'] as const)('the AI (%s) shoots a breakable wall down when it hides every foe, then goes through', (ai) => {
    // Pink is shut in a box whose only door is a breakable wall.
    const level: LevelDef = {
      id: 'breach', name: 'Breach', kind: 'battle', fans: [], ai: { difficulty: ai },
      walls: [
        { x: 600, y: 100, w: 24, h: 250 },
        { x: 600, y: 450, w: 24, h: 250 },
        { x: 600, y: 340, w: 24, h: 120, kind: 'breakable', hp: 3 },
        { x: 600, y: 100, w: 600, h: 24 },
        { x: 600, y: 676, w: 600, h: 24 },
      ],
      cannons: [
        { id: 'p1', name: 'P1', x: 200, y: 400, side: 'player' },
        { id: 'e1', name: 'E1', x: 1000, y: 400, side: 'enemy' },
      ],
    }
    let broke = false
    const sim = new BattleSim(level, null, { wallBroken: () => (broke = true) }, levelLanes(level))
    sim.byId('p1')!.setAimPoint({ x: 200, y: 0 })
    for (let t = 0; t < 40_000 && !broke; t += FRAME) sim.step(FRAME)
    expect(broke).toBe(true)
    // Then it captures gold's cannon through the gap.
    for (let t = 0; t < 60_000 && sim.byId('p1')!.side === 'player'; t += FRAME) sim.step(FRAME)
    expect(sim.byId('p1')!.side).toBe('enemy')
  })

  it('online: events and hit points reach the view', () => {
    const level = wallLevel()
    const seen: string[] = []
    let clock = 0
    const log = new EventLog(() => clock)
    const host = new BattleSim(level, null, log.tap({}))
    log.bind(host)
    ;(host as unknown as { aiOff: boolean }).aiOff = true
    const view = new BattleSim(level, null, {})
    ;(view as unknown as { aiOff: boolean }).aiOff = true
    let snap = encodeSnap(host, 0, 'player')
    expect(snap.w).toEqual([TUNING.breakable.hp])
    for (let t = 0; t < 30_000 && host.wallHp[0] > 0; t += FRAME) (host.step(FRAME), (clock = host.clock))
    snap = encodeSnap(host, 1, 'player', log.rows)
    for (const row of snap.ev) replayEvent(row, view, { wallHit: () => seen.push('hit'), wallBroken: (i) => seen.push(`broken ${i}`) }, false)
    expect(seen.filter((s) => s === 'hit').length).toBe(TUNING.breakable.hp)
    expect(seen.at(-1)).toBe('broken 0')
    expect(snap.w).toEqual([0])
    applySnap(view, snap, snap, 0, snap, false, SIM_STEP_MS)
    expect(view.wallHp[0]).toBe(0)
    expect(view.intactWalls.length).toBe(0)
    // Maps without breakable walls leave it out.
    expect(encodeSnap(new BattleSim({ ...level, walls: [] }, null, {}), 0, 'player').w).toBeUndefined()
  })

  it('maps keep the type and hp (clamped); old maps are untouched', () => {
    const level = sanitizeLevel({ ...wallLevel(), walls: [{ x: 500, y: 300, w: 24, h: 200, kind: 'breakable', hp: 999 }, { x: 100, y: 100, w: 24, h: 200, kind: 'breakable' }, { x: 100, y: 500, w: 24, h: 100 }] })!
    expect(level.walls[0]).toMatchObject({ kind: 'breakable', hp: TUNING.breakable.maxHp })
    expect(level.walls[1].kind).toBe('breakable')
    expect(level.walls[1].hp).toBeUndefined()
    expect(level.walls[2].kind).toBeUndefined()
    const back = decodeShare(encodeShare(level))!
    expect(back.walls.map((w) => [w.kind, w.hp])).toEqual(level.walls.map((w) => [w.kind, w.hp]))
  })
})

describe('brick hp bar notches', () => {
  it('a notch per hit when few; grouped into a handful of segments when many', async () => {
    const { notchStep, HP_BAR_MAX_SEGMENTS } = await import('../src/render/hpBar')
    expect(notchStep(6)).toBe(1)
    expect(notchStep(8)).toBe(1)
    expect(notchStep(24)).toBe(3)
    expect(notchStep(40)).toBe(5)
    for (let hp = 1; hp <= 40; hp++) expect(hp / notchStep(hp)).toBeLessThanOrEqual(HP_BAR_MAX_SEGMENTS)
  })
})
