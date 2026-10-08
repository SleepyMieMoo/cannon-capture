import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning'
import { KINDS, KIND_IDS, laneKey, turnSpeedDegFor } from '../src/config/kinds'
import { BattleSim } from '../src/sim/BattleSim'
import { pathCrossesBarrier } from '../src/sim/ballistics'
import { levelLanes } from '../src/sim/solver'
import { decodeShare, encodeShare, sanitizeLevel, withDifficulty } from '../src/editor/maps'
import type { AiLevel, CannonDef, CannonKind, LevelDef, Side } from '../src/types'
import { mirrored } from './helpers/arena'

const FRAME = 1000 / 60

/** Steps the round for `ms` (or until it ends). */
function run(sim: BattleSim, ms: number, each?: () => void): void {
  const end = sim.clock + ms
  while (sim.clock < end - 1e-6 && !sim.ended) {
    sim.step(FRAME)
    each?.()
  }
}

/** No AI moves on either side: only the aims the test sets. */
function quiet(sim: BattleSim): BattleSim {
  ;(sim as unknown as { aiOff: boolean }).aiOff = true
  return sim
}

/**
 * A pink shield at (500, 400) facing left, and a shooter of `side` at
 * (100, 364) aiming at a neutral far to the right along y = 364: the line
 * crosses the barrier 36 px above the shield's centre, clear of its body.
 */
function lineLevel(side: Side, kind: CannonKind = 'normal', shieldSide: Side = 'player', gx = 100): LevelDef {
  return {
    id: `line-${side}-${kind}-${shieldSide}-${gx}`,
    name: 'Line',
    kind: 'battle',
    walls: [],
    fans: [],
    cannons: [
      { id: 's1', name: 'S1', x: 500, y: 400, side: shieldSide, kind: 'shield', aimPoint: { x: 400, y: 400 } },
      { id: 'g1', name: 'G1', x: gx, y: 364, side, kind, aimAt: 'n1' },
      { id: 'n1', name: 'N1', x: 900, y: 364, side: 'neutral' },
      // Far-off cannons so neither side has lost from the start.
      { id: 'pf', name: 'PF', x: 1100, y: 660, side: 'player' },
      { id: 'ef', name: 'EF', x: 60, y: 660, side: 'enemy' },
    ],
  }
}

function events() {
  const log = { blocked: [] as string[], broken: [] as number[], back: [] as number[] }
  return log
}

describe('shield tower', () => {
  it('is a tower type: in the swap menu and editor list, turns at normal speed, never fires', () => {
    expect(KIND_IDS).toContain('shield')
    expect(KINDS.shield.label).toBe('Shield')
    expect(KINDS.shield.fires).toBe(false)
    expect(turnSpeedDegFor('shield')).toBe(TUNING.turnSpeedDeg)
    const sim = quiet(new BattleSim(lineLevel('player')))
    const s1 = sim.byId('s1')!
    s1.setTarget(sim.byId('ef')!)
    const before = sim.shots.length
    let fired = 0
    run(sim, 5000, () => {
      fired += sim.shots.filter((s) => s.ball.ownerId === 's1').length
    })
    expect(before).toBe(0)
    expect(fired).toBe(0)
  })

  it('the barrier stops enemy shots (no bounce) and lets its own side through', () => {
    const geo = new BattleSim(lineLevel('enemy'))
    const s1 = geo.byId('s1')!
    expect(pathCrossesBarrier([100, 364, 900, 364], s1.barrier()!)).toBe(true)
    // The line misses the shield's own body.
    expect(400 - 364).toBeGreaterThan(TUNING.cannonRadius + TUNING.shotRadius)

    // Enemy shooter: every shot stops on the barrier.
    const log = events()
    const foe = quiet(new BattleSim(lineLevel('enemy'), null, { blocked: (_x, _y, s, side) => log.blocked.push(`${s.id}:${side}`) }))
    run(foe, 3500)
    expect(log.blocked.length).toBeGreaterThanOrEqual(3)
    expect(new Set(log.blocked)).toEqual(new Set(['s1:enemy']))
    expect(foe.byId('n1')!.captureProgress).toBe(0)
    expect(foe.byId('s1')!.captureProgress).toBe(0)
    expect(foe.byId('s1')!.shieldHp).toBe(TUNING.shield.hp - log.blocked.length)
    // Absorbed, not bounced: no shot is left flying back from the barrier.
    for (const shot of foe.shots) expect(shot.ball.vx).toBeGreaterThan(0)

    // Pink shooter: the same line goes straight through pink's own barrier.
    const own = events()
    const mine = quiet(new BattleSim(lineLevel('player'), null, { blocked: () => own.blocked.push('x') }))
    run(mine, 3500)
    expect(own.blocked).toEqual([])
    expect(mine.byId('n1')!.captureProgress).toBeGreaterThanOrEqual(2)
    expect(mine.byId('s1')!.shieldHp).toBe(TUNING.shield.hp)
  })

  it('soaks 6 damage: 6 normal shots, 3 sniper shots or 20 machine gun bullets', () => {
    const shots = (kind: CannonKind): number => {
      const sim = quiet(new BattleSim(lineLevel('enemy')))
      const s1 = sim.byId('s1')!
      let n = 0
      while (s1.shieldUp && n < 100) {
        s1.absorb(TUNING.towers[kind].damage)
        n += 1
      }
      return n
    }
    expect(TUNING.shield.hp).toBe(6)
    expect(shots('normal')).toBe(6)
    expect(shots('sniper')).toBe(3)
    expect(shots('machinegun')).toBe(20)
  })

  it('a real machine gun breaks it with 20 bullets, then the bullets get through', () => {
    const broken: number[] = []
    // Close in, so its wide spread still lands on the barrier (and the neutral is in its shorter range).
    const sim = quiet(new BattleSim(lineLevel('enemy', 'machinegun', 'player', 330), null, { shieldBroken: () => broken.push(sim.clock) }))
    let blocked = 0
    const land = sim.ai.shotLanded.bind(sim.ai)
    sim.ai.shotLanded = (o, h, b) => {
      if (b) blocked += 1
      land(o, h, b)
    }
    run(sim, 8000)
    expect(broken.length).toBe(1)
    expect(blocked).toBe(20)
    expect(sim.byId('n1')!.captureProgress).toBeGreaterThan(0)
  })

  it('broken: down for 5 s, back with 2 hp, then regrows 1 hp/s; it also regrows after 2 s without hits', () => {
    const s = TUNING.shield
    const back: number[] = []
    const sim = quiet(new BattleSim(lineLevel('player'), null, { shieldBack: () => back.push(sim.clock) }))
    const s1 = sim.byId('s1')!
    for (let i = 0; i < 6; i++) s1.absorb(1)
    expect(s1.shieldUp).toBe(false)
    expect(s1.barrier()).toBe(null)
    expect(s1.shieldDown).toBe(s.downMs)
    run(sim, s.downMs - 100)
    expect(s1.shieldUp).toBe(false)
    run(sim, 150)
    expect(s1.shieldUp).toBe(true)
    expect(back.length).toBe(1)
    expect(Math.abs(back[0] - s.downMs)).toBeLessThan(FRAME + 1)
    expect(s1.shieldHp).toBeGreaterThanOrEqual(s.returnHp)
    expect(s1.shieldHp).toBeLessThan(s.returnHp + 0.2)
    // Regrows straight away after coming back: full again after another 4 s.
    run(sim, 2000)
    expect(s1.shieldHp).toBeCloseTo(4, 0)
    run(sim, 2200)
    expect(s1.shieldHp).toBe(s.hp)

    // Hit but not broken: nothing for 2 s, then 1 hp/s.
    s1.absorb(3)
    run(sim, s.regenDelayMs - 100)
    expect(s1.shieldHp).toBe(3)
    run(sim, 1100)
    expect(s1.shieldHp).toBeGreaterThan(3.9)
    expect(s1.shieldHp).toBeLessThan(4.2)
  })

  it('friendly shots heal the meter but do not repair the barrier', () => {
    const sim = quiet(new BattleSim(lineLevel('player')))
    const s1 = sim.byId('s1')!
    s1.absorb(3)
    s1.receiveHit('enemy', 2)
    const r = s1.receiveHit('player', 1)
    expect(r.healed).toBe(1)
    expect(s1.captureProgress).toBe(1)
    expect(s1.shieldHp).toBe(3)
  })

  it('the cannon itself is still captured by shots that miss the arc, and then its barrier serves the new owner', () => {
    const level: LevelDef = {
      ...lineLevel('player'),
      id: 'flank',
      cannons: [
        ...lineLevel('player').cannons,
        // Below the shield, 90° off its facing: well outside the 110° arc.
        { id: 'e1', name: 'E1', x: 500, y: 660, side: 'enemy', aimAt: 's1' },
      ],
    }
    const blocked: string[] = []
    const sim = quiet(new BattleSim(level, null, { blocked: (_x, _y, s, side) => blocked.push(`${s.id}:${side}`) }))
    const s1 = sim.byId('s1')!
    run(sim, 12_000, () => {
      if (s1.side === 'enemy') sim.byId('e1')!.setTarget(null)
    })
    expect(s1.side).toBe('enemy')
    expect(s1.kind).toBe('shield')
    expect(blocked.filter((b) => b.endsWith(':enemy'))).toEqual([])
    // Now gold's: pink's shooter on the line is blocked by it.
    s1.setAimPoint({ x: 400, y: 400 })
    s1.snapToAim()
    const n1 = sim.byId('n1')!
    const before = n1.captureProgress
    run(sim, 6000)
    expect(blocked.filter((b) => b === 's1:player').length).toBeGreaterThanOrEqual(4)
    expect(n1.captureProgress).toBeLessThanOrEqual(before)
  })

  it('a neutral shield is unmanned: no barrier', () => {
    const sim = quiet(new BattleSim(lineLevel('enemy', 'normal', 'neutral')))
    const s1 = sim.byId('s1')!
    expect(s1.shieldUp).toBe(false)
    run(sim, 3500)
    expect(sim.byId('n1')!.captureProgress).toBeGreaterThan(0)
  })

  it('swapping into a shield: the barrier is up once the swap reload is done; free in puzzles', () => {
    const sim = quiet(new BattleSim(lineLevel('enemy')))
    const g = sim.byId('pf')!
    expect(sim.playerSwap(g, 'shield')).toBe(true)
    expect(g.shieldUp).toBe(false)
    run(sim, TUNING.swapLockMs + 50)
    expect(g.shieldUp).toBe(true)

    const puzzle = new BattleSim({ ...lineLevel('enemy'), id: 'pz', kind: 'puzzle', aims: 2 })
    const p = puzzle.byId('pf')!
    expect(puzzle.playerSwap(p, 'shield')).toBe(true)
    expect(puzzle.aimsLeft).toBe(2)
  })

  it('aiming a shield faces it; clicking a friend never makes it "heal"', () => {
    const sim = quiet(new BattleSim(lineLevel('player')))
    const s1 = sim.byId('s1')!
    expect(sim.playerAim(s1, sim.byId('g1')!)).toBe(true)
    expect(s1.healing).toBe(null)
    expect(sim.playerAim(s1, { x: 500, y: 100 })).toBe(true)
    run(sim, 1500)
    expect(Math.abs(s1.angle + Math.PI / 2)).toBeLessThan(0.05)
  })

  it("Impossible's look-ahead copies barrier state into its forks", () => {
    const sim = quiet(new BattleSim(lineLevel('enemy')))
    const s1 = sim.byId('s1')!
    s1.absorb(6)
    run(sim, 1000)
    const f = sim.fork().byId('s1')!
    expect([f.shieldHp, f.shieldDown, f.shieldUp]).toEqual([s1.shieldHp, s1.shieldDown, s1.shieldUp])
  })
})

// ------------------------------------------------------------ maps

describe('shield in maps and share codes', () => {
  /** Made on main before shields existed. */
  const OLD_CODE =
    'CC1:eyJpZCI6Im9sZCIsIm5hbWUiOiJPbGQgbWFwIiwia2luZCI6ImJhdHRsZSIsInNpemUiOiJzbWFsbCIsImNhbm5vbnMiOlt7ImlkIjoicDEiLCJuYW1lIjoiUDEiLCJ4IjoyMDAsInkiOjQwMCwic2lkZSI6InBsYXllciJ9LHsiaWQiOiJwMiIsIm5hbWUiOiJQMiIsIngiOjIwMCwieSI6NjAwLCJzaWRlIjoicGxheWVyIiwia2luZCI6Im1hY2hpbmVndW4ifSx7ImlkIjoiZTEiLCJuYW1lIjoiRTEiLCJ4IjoxMDAwLCJ5Ijo0MDAsInNpZGUiOiJlbmVteSIsImtpbmQiOiJzbmlwZXIifSx7ImlkIjoibjEiLCJuYW1lIjoiTjEiLCJ4Ijo2MDAsInkiOjE1MCwic2lkZSI6Im5ldXRyYWwifV0sIndhbGxzIjpbeyJ4Ijo2MDAsInkiOjMwMCwidyI6MjQsImgiOjIwMH1dLCJmYW5zIjpbeyJ4Ijo2MDAsInkiOjY1MCwicmFkaXVzIjoxMjAsImFuZ2xlIjoxLjU3MDc5NjMsImZvcmNlIjo1NDB9XSwiYWkiOnsiZGlmZmljdWx0eSI6ImhhcmQifX0'

  it('an old share code loads unchanged and re-encodes to the same code', () => {
    const level = decodeShare(OLD_CODE)
    expect(level.cannons.map((c) => c.kind ?? 'normal')).toEqual(['normal', 'machinegun', 'sniper', 'normal'])
    expect(encodeShare(level)).toBe(OLD_CODE)
  })

  it('a shield round-trips through save and share code; unknown types load as normal', () => {
    const level = decodeShare(OLD_CODE)
    level.cannons[0].kind = 'shield'
    const back = decodeShare(encodeShare(level))
    expect(back.cannons[0].kind).toBe('shield')
    expect(sanitizeLevel(JSON.parse(JSON.stringify(level))).cannons[0].kind).toBe('shield')
    const odd = JSON.parse(JSON.stringify(level))
    odd.cannons[0].kind = 'laser'
    expect(sanitizeLevel(odd).cannons[0].kind).toBeUndefined()
  })
})

// ------------------------------------------------------------ AI

/**
 * Gold attacks P2, which sits just behind a pink shield (S1 faces gold).
 * With `bank`, a wall along the bottom gives a bank shot round the barrier.
 */
function screenLevel(bank: boolean, d: AiLevel = 'hard'): LevelDef {
  return withDifficulty(
    {
      id: `screen-${bank}`,
      name: 'Screen',
      kind: 'battle',
      fans: [],
      walls: bank ? [{ x: 100, y: 620, w: 1000, h: 20 }] : [],
      cannons: [
        { id: 's1', name: 'S1', x: 300, y: 400, side: 'player', kind: 'shield', aimPoint: { x: 400, y: 400 } },
        { id: 'p2', name: 'P2', x: 220, y: 440, side: 'player' },
        { id: 'e1', name: 'E1', x: 1000, y: 400, side: 'enemy' },
      ],
    },
    d,
  )
}

function attack(bank: boolean) {
  const level = screenLevel(bank)
  const lanes = levelLanes(level)
  const broke: number[] = []
  const sim = new BattleSim(level, null, { shieldBroken: () => broke.push(sim.clock) }, lanes)
  let blocked = 0
  const land = sim.ai.shotLanded.bind(sim.ai)
  sim.ai.shotLanded = (o, h, b) => {
    if (b) blocked += 1
    land(o, h, b)
  }
  const p2 = sim.byId('p2')!
  let p2At = Infinity
  run(sim, 60_000, () => {
    if (p2.side === 'enemy' && p2At === Infinity) p2At = sim.clock
  })
  return { sim, lanes, blocked, broke, p2At }
}

describe('AI and shields', () => {
  it('goes round an enemy barrier when there is another lane (a bank shot here)', () => {
    const { lanes, sim, broke, p2At, blocked } = attack(true)
    // Aiming straight at P2 runs into the barrier; the bank lane is kept as a way round.
    const main = lanes.get(laneKey('e1', 'normal'))!.get('p2')!
    expect(main.direct).toBe(true)
    expect(main.alts?.some((a) => !a.direct && (a.tricks ?? 0) > 0)).toBe(true)
    const fresh = new BattleSim(screenLevel(true), null, {}, lanes)
    const route = fresh.ai.routeFor(fresh.byId('e1')!, 'normal', fresh.byId('p2')!)
    expect(route.blockers).toEqual([])
    expect(route.lane).not.toBe(main)
    // It captured P2 without ever breaking the barrier first.
    expect(p2At).toBeLessThan(30_000)
    expect(broke.filter((t) => t < p2At)).toEqual([])
    expect(blocked).toBeLessThan(TUNING.shield.hp)
    expect(sim.ended).toBe('lose')
  })

  it('with no way round, it breaks the barrier and still captures', () => {
    const { broke, p2At, sim } = attack(false)
    expect(broke.length).toBeGreaterThanOrEqual(1)
    expect(broke[0]).toBeLessThan(p2At)
    expect(p2At).toBeLessThan(45_000)
    expect(sim.ended).toBe('lose')
  })

  /** Three pink cannons focus gold's E1 from one side; E2 and E3 sit far off. */
  function focus(d: AiLevel, id = 'focus'): LevelDef {
    return withDifficulty(
      {
        id,
        name: 'Focus',
        kind: 'battle',
        walls: [],
        fans: [],
        cannons: [
          { id: 'p1', name: 'P1', x: 900, y: 300, side: 'player', aimAt: 'e1' },
          { id: 'p2', name: 'P2', x: 900, y: 400, side: 'player', aimAt: 'e1' },
          { id: 'p3', name: 'P3', x: 900, y: 500, side: 'player', aimAt: 'e1' },
          { id: 'e1', name: 'E1', x: 350, y: 400, side: 'enemy' },
          { id: 'e2', name: 'E2', x: 120, y: 120, side: 'enemy' },
          { id: 'e3', name: 'E3', x: 120, y: 680, side: 'enemy' },
        ],
      },
      d,
    )
  }

  function underFire(d: AiLevel, id?: string) {
    const sim = new BattleSim(focus(d, id))
    // Pink keeps shooting E1 only.
    const keep = () => {
      for (const p of ['p1', 'p2', 'p3']) {
        const c = sim.byId(p)!
        if (c.side === 'player' && sim.byId('e1')!.side === 'enemy') c.setTarget(sim.byId('e1')!)
      }
    }
    let shieldAt = Infinity
    let most = 0
    let facing = NaN
    run(sim, 20_000, () => {
      keep()
      const e1 = sim.byId('e1')!
      if (e1.kind === 'shield' && e1.side === 'enemy' && shieldAt === Infinity) shieldAt = sim.clock
      if (e1.side === 'enemy' && sim.clock - shieldAt > 300 && Number.isNaN(facing)) facing = Math.atan2(Math.sin(e1.angle), Math.cos(e1.angle))
      most = Math.max(most, sim.cannons.filter((c) => c.side === 'enemy' && c.kind === 'shield').length)
    })
    return { sim, shieldAt, most, facing }
  }

  it('a gold cannon that is losing a 3-on-1 swaps to Shield and turns it to face the shots', () => {
    const { shieldAt, most, facing } = underFire('hard')
    expect(shieldAt).toBeLessThan(10_000)
    // Never more than a third of the team.
    expect(most).toBe(1)
    // Its barrier faces pink (to the right) once it has turned.
    expect(Math.abs(facing)).toBeLessThan(0.35)
  })

  it('Easy uses shields rarely: less often than Hard in the same spot', () => {
    let easy = 0
    let hard = 0
    for (let i = 0; i < 6; i++) {
      if (underFire('easy', `focus-${i}`).shieldAt < 20_000) easy += 1
      if (underFire('hard', `focus-${i}`).shieldAt < 20_000) hard += 1
    }
    expect(hard).toBe(6)
    expect(easy).toBeLessThan(hard)
  })

  it('a shield placed on gold by the map stays a shield and faces pink', () => {
    const level = withDifficulty(
      {
        id: 'post', name: 'Post', kind: 'battle', walls: [], fans: [],
        cannons: [
          { id: 'p1', name: 'P1', x: 1000, y: 400, side: 'player' },
          { id: 'e1', name: 'E1', x: 300, y: 400, side: 'enemy', kind: 'shield' },
          { id: 'e2', name: 'E2', x: 150, y: 400, side: 'enemy' },
          { id: 'e3', name: 'E3', x: 150, y: 200, side: 'enemy' },
        ],
      },
      'hard',
    )
    const sim = new BattleSim(level)
    run(sim, 8000)
    const e1 = sim.byId('e1')!
    expect(e1.kind).toBe('shield')
    expect(Math.abs(Math.atan2(Math.sin(e1.angle), Math.cos(e1.angle)))).toBeLessThan(0.3)
  })

  it('AI vs AI: shields do not make rounds stall (unfinished rate about the same as with shields off)', () => {
    const level = TUNING.aiLevels as unknown as Record<AiLevel, { shieldChance: number }>
    const saved = Object.fromEntries(Object.entries(level).map(([k, v]) => [k, v.shieldChance]))
    const unfinished = (): number => {
      let n = 0
      for (let i = 0; i < 12; i++) {
        const base = mirrored(i)
        const lv = withDifficulty({ ...base, kind: 'battle' }, 'hard')
        const sim = new BattleSim(lv, null, {}, levelLanes(lv))
        sim.addAi('player', 'hard')
        run(sim, 150_000)
        if (!sim.ended) n += 1
      }
      return n
    }
    const withShields = unfinished()
    try {
      for (const v of Object.values(level)) v.shieldChance = 0
      const without = unfinished()
      expect(withShields).toBeLessThanOrEqual(without + 2)
    } finally {
      for (const [k, v] of Object.entries(level)) v.shieldChance = saved[k]
    }
  }, 300_000)
})

export type { CannonDef }
