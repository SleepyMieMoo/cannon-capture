import { describe, expect, it } from 'vitest'
import { PORTAL } from '../src/config/obstacles'
import { shotRangeFor, shotSpeedFor } from '../src/config/kinds'
import { BattleSim } from '../src/sim/BattleSim'
import { aimShot, stepBall, type Ball, type BallisticsOpts } from '../src/sim/ballistics'
import { SIM_STEP_MS } from '../src/sim/fixedStep'
import { portalExit, portalMouths } from '../src/sim/portals'
import { lanesOf, levelLanes, shotOpts } from '../src/sim/solver'
import { EventLog, encodeSnap, replayEvent } from '../src/net/snapshot'
import { AiController } from '../src/ai/AiController'
import { decodeShare, encodeShare, sanitizeLevel } from '../src/editor/maps'
import type { LevelDef, PortalDef } from '../src/types'

const FRAME = 1000 / 60
const optsWith = (portals: PortalDef[]): BallisticsOpts => ({ ...shotOpts({ size: 'huge', portals }), bounds: { x: -1e5, y: -1e5, w: 2e5, h: 2e5 } })

function shot(x: number, y: number, angle: number): Ball {
  const b = aimShot({ x, y }, { x: x + Math.cos(angle), y: y + Math.sin(angle) }, 0, shotSpeedFor('normal'), 'a')
  b.range = shotRangeFor('normal')
  return b
}

/** Fly until it ends; note each portal hop. */
function fly(b: Ball, opts: BallisticsOpts, ms = 20_000) {
  const hops: { x1: number; y1: number; x2: number; y2: number; pair: number; at: number; vx: number; vy: number }[] = []
  let ball = b
  for (let t = 0; t < ms && ball.alive; t += SIM_STEP_MS) {
    const r = stepBall(ball, SIM_STEP_MS, [], [], [], opts)
    ball = r.ball
    if (r.ported) hops.push({ ...r.ported, at: t, vx: ball.vx, vy: ball.vy })
  }
  return { ball, hops }
}

describe('portal transform', () => {
  const pair = (aAngle: number, bAngle: number): PortalDef => ({ a: { x: 300, y: 0, angle: aAngle }, b: { x: 0, y: 600, angle: bAngle } })

  it('same facing: the shot comes out heading the same way, at the same speed', () => {
    const [a, b] = portalMouths([pair(0, 0)])
    const out = portalExit(a, b, 290, 3, 400, 0)
    expect(out.vx).toBeCloseTo(400, 6)
    expect(out.vy).toBeCloseTo(0, 6)
    // Same offset across, but on the side it is heading for (it flies straight out).
    expect(out.x).toBeCloseTo(10, 6)
    expect(out.y).toBeCloseTo(603, 6)
  })

  it('turned mouths turn the heading by their angle difference (relative angle kept)', () => {
    for (const [aa, bb] of [[0, Math.PI / 2], [0.3, -2.1], [Math.PI, 0], [1, 1 + Math.PI]]) {
      const [a, b] = portalMouths([pair(aa, bb)])
      for (const heading of [0, 0.7, 2.5, -1.2]) {
        const v = 350
        const out = portalExit(a, b, a.x - Math.cos(heading) * 8, a.y - Math.sin(heading) * 8, Math.cos(heading) * v, Math.sin(heading) * v)
        expect(Math.hypot(out.vx, out.vy)).toBeCloseTo(v, 6)
        const turned = Math.atan2(out.vy, out.vx) - heading
        expect(Math.cos(turned)).toBeCloseTo(Math.cos(bb - aa), 6)
        expect(Math.sin(turned)).toBeCloseTo(Math.sin(bb - aa), 6)
        // Heading away from the exit's centre.
        expect((out.x - b.x) * out.vx + (out.y - b.y) * out.vy).toBeGreaterThanOrEqual(0)
      }
      // B -> A undoes A -> B.
      const there = portalExit(a, b, a.x, a.y, 100, 50)
      const back = portalExit(b, a, b.x, b.y, there.vx, there.vy)
      expect(back.vx).toBeCloseTo(100, 6)
      expect(back.vy).toBeCloseTo(50, 6)
    }
  })

  it('a flying shot goes in one mouth and out the other', () => {
    const { hops, ball } = fly(shot(0, 0, 0), optsWith([pair(0, Math.PI / 2)]))
    expect(hops.length).toBe(1)
    expect(hops[0].pair).toBe(0)
    expect(Math.hypot(hops[0].x1 - 300, hops[0].y1)).toBeLessThanOrEqual(PORTAL.trigger + 1e-6)
    expect(Math.hypot(hops[0].x2, hops[0].y2 - 600)).toBeLessThanOrEqual(PORTAL.trigger + 1e-6)
    // Turned a quarter: now heading down (+y).
    expect(hops[0].vx).toBeCloseTo(0, 3)
    expect(hops[0].vy).toBeGreaterThan(0)
    expect(ball.x).toBeCloseTo(0, 0)
    expect(ball.y).toBeGreaterThan(600)
  })

  it('distance carries over: the jump is free, but no range is gained', () => {
    const range = shotRangeFor('normal')
    const plain = fly(shot(0, 0, 0), optsWith([]))
    const through = fly(shot(0, 0, 0), optsWith([pair(0, 0)]))
    expect(through.hops.length).toBe(1)
    expect(plain.ball.travelled).toBeCloseTo(range, 3)
    expect(through.ball.travelled).toBeCloseTo(range, 3)
    // Where it ends: its range minus what it flew to the mouth, measured from the exit.
    const before = Math.hypot(through.hops[0].x1, through.hops[0].y1)
    const after = Math.hypot(through.ball.x - through.hops[0].x2, through.ball.y - through.hops[0].y2)
    expect(before + after).toBeCloseTo(range, 0)
  })

  it('no ping-pong: it must leave the exit and wait out the cooldown before another portal', () => {
    // Pair 0 sends it out of B heading +x; pair 1's mouth sits just past B's exit.
    const portals: PortalDef[] = [
      { a: { x: 300, y: 0, angle: 0 }, b: { x: 0, y: 600, angle: 0 } },
      { a: { x: 200, y: 600, angle: 0 }, b: { x: 900, y: 900, angle: 0 } },
    ]
    // A mouth right past the exit is flown over (still cooling down).
    const near = fly(shot(0, 0, 0), optsWith([portals[0], { ...portals[1], a: { x: 50, y: 600, angle: 0 } }]))
    expect(near.hops.length).toBe(1)
    const { hops } = fly(shot(0, 0, 0), optsWith(portals))
    expect(hops.length).toBe(2)
    // The second hop waited for the cooldown.
    expect(hops[1].at - hops[0].at).toBeGreaterThanOrEqual(PORTAL.cooldownMs - SIM_STEP_MS)
    expect(hops[1].pair).toBe(1)
    // A ball sitting in the exit mouth (just out of it) is not sent back.
    const opts = optsWith([portals[0]])
    const r = stepBall({ ...shot(300, 0, Math.PI), x: 300, y: 0 }, SIM_STEP_MS, [], [], [], opts)
    expect(r.ported).toBeTruthy()
    const again = stepBall(r.ball, SIM_STEP_MS, [], [], [], opts)
    expect(again.ported).toBeUndefined()
    expect(r.ball.portalCd).toBeGreaterThan(0)
  })
})

/** Gold's cannon is walled off from the neutral; the only way is through a portal. */
const PORTAL_LEVEL: LevelDef = {
  id: 'portal-round', name: 'Portal', kind: 'battle', fans: [],
  walls: [{ x: 588, y: 88, w: 24, h: 608 }],
  portals: [{ a: { x: 400, y: 392, angle: 0 }, b: { x: 760, y: 392, angle: 0 } }],
  cannons: [
    { id: 'p1', name: 'P1', x: 200, y: 392, side: 'player', aimAt: 'n1' },
    { id: 'n1', name: 'N1', x: 1000, y: 392, side: 'neutral' },
    { id: 'e1', name: 'E1', x: 1100, y: 160, side: 'enemy' },
  ],
}

describe('portals in a round', () => {
  it('shots reach a cannon through a portal; the event fires and replays online', () => {
    let ports = 0
    const log = new EventLog(() => 0)
    const sim = new BattleSim(PORTAL_LEVEL, null, log.tap({ portal: () => ports++ }))
    log.bind(sim)
    ;(sim as unknown as { aiOff: boolean }).aiOff = true
    for (let t = 0; t < 8000; t += FRAME) sim.step(FRAME)
    expect(ports).toBeGreaterThan(2)
    expect(sim.byId('n1')!.captureProgress).toBeGreaterThan(0)
    const snap = encodeSnap(sim, 1, 'player', log.rows)
    const seen: number[] = []
    for (const row of snap.ev) replayEvent(row, sim, { portal: (x1, _y1, x2, _y2, pair) => seen.push(pair, Math.round(x1), Math.round(x2)) }, false)
    expect(seen.slice(0, 3)).toEqual([0, expect.any(Number), expect.any(Number)])
    expect(Math.abs(seen[1] - 400)).toBeLessThanOrEqual(PORTAL.trigger)
    expect(Math.abs(seen[2] - 760)).toBeLessThanOrEqual(PORTAL.trigger)
  })

  it('lanes know portals; Easy never plans through them, Hard does', () => {
    const lanes = levelLanes(PORTAL_LEVEL)
    const lane = lanesOf(lanes, { id: 'p1' })!.get('n1')!
    expect(lane).toBeTruthy()
    expect(lane.portals).toBe(1)
    expect(lane.widthDeg).toBeGreaterThanOrEqual(2)
    // The path has a gap at the jump (no segment across it).
    expect(lane.path!.some((v) => Number.isNaN(v))).toBe(true)
    const view = (difficulty: 'easy' | 'normal' | 'hard') => {
      const level: LevelDef = { ...PORTAL_LEVEL, ai: { difficulty }, cannons: PORTAL_LEVEL.cannons.map((c) => (c.id === 'p1' ? { ...c, side: 'enemy' } : c.id === 'e1' ? { ...c, side: 'player' } : c)) }
      const sim = new BattleSim(level, null, {}, levelLanes(level))
      const ai = (sim as unknown as { ai: AiController }).ai
      ;(ai as unknown as { refreshView(c: unknown): void }).refreshView(sim.cannons)
      const v = (ai as unknown as { view: Map<string, Map<string, unknown>> }).view
      return v.get('p1')?.get('n1')
    }
    expect(view('easy')).toBeUndefined()
    expect(view('hard')).toBeTruthy()
  })

  it('maps keep portals (at most 3 pairs, mouths apart, angles tidy); old maps have none', () => {
    const end = (x: number, y: number, angle = 0) => ({ x, y, angle })
    const level = sanitizeLevel({
      ...PORTAL_LEVEL,
      portals: [
        { a: end(300, 300, 7), b: end(800, 300) },
        { a: end(300, 300), b: end(310, 300) }, // too close: dropped
        { a: end(200, 200), b: end(900, 600, -1) },
        { a: end(250, 600), b: end(950, 200) },
        { a: end(260, 650), b: end(940, 150) }, // a 4th pair: dropped
        { a: end(260, 650) }, // half a pair: dropped
      ],
    })
    expect(level.portals!.length).toBe(PORTAL.maxPairs)
    expect(level.portals![0].a.angle).toBeCloseTo(7 - 2 * Math.PI, 3)
    expect(level.portals![1].b.angle).toBeCloseTo(-1, 6)
    expect(decodeShare(encodeShare(level))!.portals).toEqual(level.portals)
    expect(sanitizeLevel({ ...PORTAL_LEVEL, portals: undefined }).portals).toBeUndefined()
  })
})
