import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning'
import { KINDS, KIND_IDS, fmtNum, minLaneFor, nextKind, shotRangeFor, turnSpeedDegFor } from '../src/config/kinds'
import { BattleSim, MAX_SHOTS } from '../src/sim/BattleSim'
import { MirrorBot } from '../src/sim/bots'
import { applyCaptureHit } from '../src/sim/capture'
import { decodeShare, encodeShare, sanitizeLevel } from '../src/editor/maps'
import { boardFor } from '../src/levels/board'
import type { CannonDef, CannonKind, LevelDef, Side, WallDef } from '../src/types'

/** One cannon of each type, each with its own far-off neutral to shoot at. */
const range: LevelDef = {
  id: 'mg-test',
  name: 'MG test',
  kind: 'puzzle',
  cannons: [
    { id: 'p1', name: 'P1', x: 200, y: 400, side: 'player', kind: 'machinegun' },
    { id: 'p2', name: 'P2', x: 200, y: 600, side: 'player', kind: 'sniper' },
    { id: 'p3', name: 'P3', x: 200, y: 200, side: 'player' },
    { id: 'n1', name: 'N1', x: 1100, y: 400, side: 'neutral' },
    { id: 'n2', name: 'N2', x: 1000, y: 600, side: 'neutral' },
    { id: 'n3', name: 'N3', x: 1000, y: 200, side: 'neutral' },
  ],
  walls: [],
  fans: [],
}

interface Fired {
  id: string
  t: number
  damage: number
  speed: number
  life: number
  /** Degrees between the shot's direction and the barrel. */
  off: number
}

function shotLog(sim: BattleSim): Fired[] {
  const log: Fired[] = []
  for (const c of sim.cannons) {
    const orig = c.update.bind(c)
    c.update = (dt, frozen, ms) => {
      const ball = orig(dt, frozen, ms)
      if (ball) {
        let off = Math.atan2(ball.vy, ball.vx) - c.angle
        off = Math.atan2(Math.sin(off), Math.cos(off))
        log.push({ id: c.id, t: sim.clock, damage: c.damage, speed: Math.hypot(ball.vx, ball.vy), life: ball.lifeMs ?? TUNING.shotLifetimeMs, off: (off * 180) / Math.PI })
      }
      return ball
    }
  }
  return log
}

function aimAll(sim: BattleSim): void {
  for (const [p, n] of [['p1', 'n1'], ['p2', 'n2'], ['p3', 'n3']]) {
    const c = sim.byId(p)!
    c.setTarget(sim.byId(n)!)
    c.snapToAim()
  }
}

describe('machine gun', () => {
  it('is a tower type everywhere: menu, editor, T key order', () => {
    expect(KIND_IDS).toEqual(['normal', 'sniper', 'machinegun', 'shield'])
    expect(KINDS.machinegun.label).toBe('Machine gun')
    expect(nextKind('normal')).toBe('sniper')
    expect(nextKind('sniper')).toBe('machinegun')
    expect(nextKind('machinegun')).toBe('shield')
    expect(nextKind('shield')).toBe('normal')
    expect(KINDS.machinegun.blurb).toContain('0.3 damage every 0.2 s')
  })

  it('fires every 0.2 s for 0.3 damage at normal speed, with half the range', () => {
    const sim = new BattleSim(range)
    aimAll(sim)
    const log = shotLog(sim)
    for (let t = 0; t < 4000; t += 1000 / 60) sim.step(1000 / 60)
    const mg = log.filter((s) => s.id === 'p1')
    const gaps = mg.slice(1).map((s, i) => s.t - mg[i].t)
    expect(gaps.length).toBeGreaterThan(15)
    // 60 fps frames are 16.7 ms, so a 200 ms interval lands within one frame.
    for (const g of gaps) expect(Math.abs(g - 200)).toBeLessThan(17)
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
    expect(Math.abs(avg - 200)).toBeLessThan(5)
    expect(mg[0].damage).toBe(0.3)
    const normal = log.find((s) => s.id === 'p3')!
    expect(mg[0].speed).toBeCloseTo(normal.speed, 5)
    expect(mg[0].life * mg[0].speed).toBeCloseTo((normal.life * normal.speed) / 2, 5)
    expect(shotRangeFor('machinegun')).toBeCloseTo(shotRangeFor('normal') / 2, 5)
    // Out of range: N1 is 900 px away and the gun reaches about 765 px past its muzzle, so nothing lands.
    expect(sim.byId('n1')!.captureProgress).toBe(0)
  })

  it('turns twice as fast as normal; the sniper turns at half speed', () => {
    expect(turnSpeedDegFor('machinegun')).toBe(TUNING.turnSpeedDeg * 2)
    expect(turnSpeedDegFor('sniper')).toBe(TUNING.turnSpeedDeg / 2)
    const sim = new BattleSim(range)
    const turnTime = (id: string): number => {
      const c = sim.byId(id)!
      c.angle = Math.PI / 2 // pointing down, target is to the right: a 90° turn
      c.setTarget(sim.byId(id.replace('p', 'n'))!)
      let t = 0
      while (c.aimErrorDeg() > TUNING.aimToleranceDeg && t < 5000) {
        c.update(1000 / 60, true)
        t += 1000 / 60
      }
      return t
    }
    const mg = turnTime('p1')
    const sniper = turnTime('p2')
    const normal = turnTime('p3')
    expect(mg / normal).toBeCloseTo(0.5, 1)
    expect(sniper / normal).toBeCloseTo(2, 1)
  })

  it('spread: the sniper is exact, normal cannons wobble a little, machine guns a lot', () => {
    const sim = new BattleSim(range)
    aimAll(sim)
    const log = shotLog(sim)
    for (let t = 0; t < 30000; t += 1000 / 60) sim.step(1000 / 60)
    const offs = (id: string) => log.filter((s) => s.id === id).map((s) => s.off)
    const maxAbs = (a: number[]) => Math.max(...a.map(Math.abs))
    const sd = (a: number[]) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length)
    const sniper = offs('p2')
    const normal = offs('p3')
    const mg = offs('p1')
    // The barrel is lined up within aimToleranceDeg when it fires.
    expect(maxAbs(sniper)).toBeLessThan(1e-9)
    expect(maxAbs(normal)).toBeLessThanOrEqual(TUNING.towers.normal.spreadDeg + 1e-9)
    expect(sd(normal)).toBeGreaterThan(0.3)
    expect(maxAbs(mg)).toBeLessThanOrEqual(TUNING.towers.machinegun.spreadDeg + 1e-9)
    expect(sd(mg)).toBeGreaterThan(3)
    // Both directions.
    expect(Math.min(...mg)).toBeLessThan(-4)
    expect(Math.max(...mg)).toBeGreaterThan(4)
  })

  it('every run replays the same spread (seeded per cannon)', () => {
    const run = () => {
      const sim = new BattleSim(range)
      aimAll(sim)
      const log = shotLog(sim)
      for (let t = 0; t < 3000; t += 1000 / 60) sim.step(1000 / 60)
      return log.map((s) => s.off)
    }
    expect(run()).toEqual(run())
  })

  it('fractional damage: 27 hits of 0.3 capture, and heals of 0.3 leave the meter exactly clean', () => {
    let state = { side: 'neutral' as Side, attacker: null as Side | null, progress: 0 }
    let hits = 0
    for (; hits < 40; hits++) {
      const r = applyCaptureHit(state, 'player', TUNING.captureThreshold, 0.3)
      state = r.state
      if (r.flipped) break
    }
    expect(hits + 1).toBe(27) // 8 / 0.3 = 26.7
    expect(state.side).toBe('player')

    const sim = new BattleSim({ ...range, kind: 'battle', cannons: [...range.cannons.slice(0, 3), { id: 'e1', name: 'E1', x: 600, y: 400, side: 'enemy' }] })
    const p3 = sim.byId('p3')!
    for (let i = 0; i < 7; i++) p3.receiveHit('enemy', 0.3)
    expect(p3.captureProgress).toBe(2.1)
    let healed = 0
    for (let i = 0; i < 7; i++) healed += p3.receiveHit('player', 0.3).healed
    expect(healed).toBeCloseTo(2.1, 9)
    expect(p3.captureProgress).toBe(0)
    expect(p3.captureAttacker).toBe(null)
    expect(p3.damaged).toBe(false)
    // An eighth heal does nothing (no overheal).
    expect(p3.receiveHit('player', 0.3).healed).toBe(0)
    // A normal hit then machine gun heals: 1 = 0.3 + 0.3 + 0.3 + 0.1.
    p3.receiveHit('enemy', 1)
    const amounts = [0, 1, 2, 3].map(() => p3.receiveHit('player', 0.3).healed)
    expect(amounts.map((a) => Math.round(a * 1000) / 1000)).toEqual([0.3, 0.3, 0.3, 0.1])
    expect(p3.captureProgress).toBe(0)
  })

  it('numbers in the UI read cleanly', () => {
    expect(fmtNum(0.3)).toBe('0.3')
    expect(fmtNum(0.1 + 0.2)).toBe('0.3')
    expect(fmtNum(0.3 * 5)).toBe('1.5')
    expect(fmtNum(2)).toBe('2')
    expect(fmtNum(0.2)).toBe('0.2')
  })

  it('swapping into a machine gun reloads for 1 s (its interval, but at least swapLockMs)', () => {
    const sim = new BattleSim(range)
    aimAll(sim)
    const p3 = sim.byId('p3')!
    p3.setTarget(sim.byId('n1')!)
    p3.snapToAim()
    for (let t = 0; t < 1500; t += 1000 / 60) sim.step(1000 / 60)
    const log = shotLog(sim)
    const t0 = sim.clock
    expect(sim.playerSwap(p3, 'machinegun')).toBe(true)
    expect(p3.swapping).toBe(true)
    for (let t = 0; t < 2000; t += 1000 / 60) sim.step(1000 / 60)
    const first = log.find((s) => s.id === 'p3')!
    expect(Math.abs(first.t - t0 - TUNING.swapLockMs)).toBeLessThan(20)
    expect(first.damage).toBe(0.3)
  })

  it("an old level's slower pink fire rate no longer slows anything: machine guns still fire every 0.2 s", () => {
    const level: LevelDef = { ...range, kind: 'battle', ai: { fireMs: 1300 }, cannons: [{ id: 'e1', name: 'E1', x: 900, y: 400, side: 'enemy', kind: 'machinegun' }, { id: 'p1', name: 'P1', x: 500, y: 400, side: 'player' }] }
    const sim = new BattleSim(level)
    const e1 = sim.byId('e1')!
    e1.setTarget(sim.byId('p1')!)
    e1.snapToAim()
    const log = shotLog(sim)
    for (let t = 0; t < 1500; t += 1000 / 60) sim.step(1000 / 60)
    const mg = log.filter((s) => s.id === 'e1')
    const gaps = mg.slice(1).map((s, i) => s.t - mg[i].t)
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
    expect(Math.abs(avg - 200)).toBeLessThan(5)
  })

  it('share codes and saved maps keep machine guns; unknown types fall back to normal', () => {
    const code = encodeShare({ ...range, kind: 'battle' })
    const back = decodeShare(code)
    expect(back.cannons.find((c) => c.id === 'p1')!.kind).toBe('machinegun')
    const odd = sanitizeLevel({ ...range, cannons: [{ ...range.cannons[0], kind: 'laser' as CannonKind }, ...range.cannons.slice(1)] })
    expect(odd.cannons[0].kind).toBeUndefined()
  })
})

describe('AI and machine guns', () => {
  it('a lane only counts for a machine gun when it is at least as wide as its spread', () => {
    expect(minLaneFor('machinegun')).toBe(TUNING.towers.machinegun.spreadDeg)
    expect(minLaneFor('normal')).toBe(2)
    expect(minLaneFor('sniper')).toBe(2)
  })
})

/** A Huge map packed with machine guns on both sides. */
function gunMap(n = 48): LevelDef {
  const b = boardFor('huge')
  const list: CannonDef[] = []
  for (let i = 0; i < n; i++) {
    const side: Side = i % 3 === 0 ? 'player' : i % 3 === 1 ? 'enemy' : 'neutral'
    const kind: CannonKind | undefined = side === 'neutral' ? undefined : 'machinegun'
    list.push({ id: `c${i}`, name: `C${i}`, side, kind, x: Math.round(b.x + 80 + ((i * 397) % (b.w - 160))), y: Math.round(b.y + 80 + ((i * 251) % (b.h - 160))) })
  }
  const walls: WallDef[] = []
  for (let i = 0; i < 30; i++) walls.push({ x: Math.round(b.x + 100 + ((i * 613) % (b.w - 400))), y: Math.round(b.y + 60 + ((i * 331) % (b.h - 120))), w: 200, h: 24 })
  return sanitizeLevel({ id: 'mg-huge', name: 'MG Huge', size: 'huge', kind: 'battle', cannons: list, walls, fans: [] })
}

describe('performance with many machine guns', () => {
  it('a Huge map full of machine guns stays cheap per frame and never hits the shot cap', () => {
    const level = gunMap()
    const sim = new BattleSim(level, null, {}, 'progressive')
    const bot = new MirrorBot(sim)
    const dt = 1000 / 60
    let worst = 0
    let total = 0
    let most = 0
    const frames = 60 * 30
    for (let i = 0; i < frames && !sim.ended; i++) {
      const t0 = performance.now()
      sim.pumpLanes(5)
      bot.update(dt)
      sim.step(dt)
      const spent = performance.now() - t0
      total += spent
      if (i > 5) worst = Math.max(worst, spent)
      most = Math.max(most, sim.shots.length)
    }
    expect(sim.lanesReady).toBe(true)
    expect(total / frames).toBeLessThan(8)
    expect(worst).toBeLessThan(40)
    expect(most).toBeGreaterThan(60) // lots of shots actually flew
    expect(most).toBeLessThan(MAX_SHOTS)
  })
})
