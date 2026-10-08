import { beforeEach, describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning'
import { BattleSim } from '../src/sim/BattleSim'
import { laneTricks, levelLanes, type LaneTable } from '../src/sim/solver'
import { boardFor } from '../src/levels/board'
import { CAMPAIGN } from '../src/levels/campaign'
import { levelDifficulty } from '../src/ai/difficulty'
import { DIFFICULTY, decodeShare, encodeShare, loadDraft, listMaps, sanitizeLevel, withDifficulty } from '../src/editor/maps'
import type { AiLevel, CannonDef, LevelDef, Side } from '../src/types'
import { match, mirrored } from './helpers/arena'

const FRAME = 1000 / 60

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

// ------------------------------------------------------------ accuracy

/** The standard duel: one pink normal cannon, one neutral 520 px away on open ground (gold sits far off and never fires). */
const DUEL: LevelDef = {
  id: 'duel', name: 'Duel', kind: 'battle', walls: [], fans: [],
  cannons: [
    { id: 'p1', name: 'P1', x: 60, y: 110, side: 'player' },
    { id: 'e1', name: 'E1', x: 900, y: 500, side: 'enemy' },
    { id: 'n1', name: 'N1', x: 380, y: 500, side: 'neutral' },
  ],
}
const DUEL_LANES: LaneTable = levelLanes(DUEL)

/** Hit (true) or miss for pink's first `shots` shots at the neutral, in the order they were fired. */
function duel(d: AiLevel, trial: number, shots = 5): boolean[] {
  const level = { ...withDifficulty(DUEL, d), id: `duel-${trial}` }
  const sim = new BattleSim(level, null, {}, DUEL_LANES)
  sim.byId('p1')!.update = () => null
  const e1 = sim.byId('e1')!
  const fired: boolean[] = []
  const update = e1.update.bind(e1)
  e1.update = (dt, frozen, ms) => {
    const ball = update(dt, frozen, ms)
    if (ball) fired.push(sim.ai.jobs.get(e1)?.target.id === 'n1' && e1.kind === 'normal')
    return ball
  }
  const out: boolean[] = []
  const landed = sim.ai.shotLanded.bind(sim.ai)
  sim.ai.shotLanded = (owner, hit) => {
    // Normal shots fly at one speed, so they land in the order they were fired.
    if (owner === 'e1' && fired.shift()) out.push(hit === 'n1')
    landed(owner, hit)
  }
  while (sim.clock < 12_000 && out.length < shots && !sim.ended) sim.step(FRAME)
  return out
}

function hitRates(d: AiLevel, trials = 150): { first: number; later: number; n: number } {
  let first = 0
  let later = 0
  let laterN = 0
  let n = 0
  for (let i = 0; i < trials; i++) {
    const r = duel(d, i)
    if (r.length < 5) continue
    n += 1
    if (r[0]) first += 1
    for (const h of r.slice(3)) {
      laterN += 1
      if (h) later += 1
    }
  }
  return { first: first / n, later: later / laterN, n }
}

describe('difficulty is intelligence only', () => {
  it('every level fires at your rate, whatever an old map said', () => {
    for (const ai of [{ fireMs: 1400 }, { fireMs: 1150 }, {}, { difficulty: 'impossible' as const }]) {
      const level: LevelDef = { ...DUEL, ai }
      const sim = new BattleSim(level, null, {}, DUEL_LANES)
      const e1 = sim.byId('e1')!
      e1.setTarget(sim.byId('n1')!)
      e1.snapToAim()
      const times: number[] = []
      const update = e1.update.bind(e1)
      e1.update = (dt, frozen, ms) => {
        const ball = update(dt, frozen, ms)
        if (ball) times.push(sim.clock)
        return ball
      }
      sim.ai.update = () => {}
      while (sim.clock < 5200) sim.step(FRAME)
      const gaps = times.slice(1).map((t, i) => t - times[i])
      expect(Math.abs(gaps.reduce((a, b) => a + b, 0) / gaps.length - TUNING.fireIntervalMs), JSON.stringify(ai)).toBeLessThan(5)
    }
  })

  it('the brains differ, the stats do not: same think tick and swap rules at every level', () => {
    const sims = (['easy', 'normal', 'hard', 'impossible'] as const).map((d) => new BattleSim(withDifficulty(DUEL, d), null, {}, DUEL_LANES))
    for (const s of sims) {
      expect(s.ai.timing.thinkMs).toBe(TUNING.aiRetargetMs)
      expect(s.ai.swaps.policy).toEqual(sims[0].ai.swaps.policy)
    }
    expect(sims.map((s) => s.ai.difficulty)).toEqual(['easy', 'normal', 'hard', 'impossible'])
  })

  it('first-shot accuracy: Easy about 50%, Normal about 75%, Hard and Impossible every time; Easy and Normal improve on a target they keep shooting', () => {
    const easy = hitRates('easy')
    const normal = hitRates('normal')
    const hard = hitRates('hard', 40)
    const impossible = hitRates('impossible', 40)
    console.log('first-shot hit rates', JSON.stringify({ easy, normal, hard, impossible }))
    expect(easy.n).toBeGreaterThan(60)
    expect(easy.first).toBeGreaterThan(0.4)
    expect(easy.first).toBeLessThan(0.6)
    expect(normal.first).toBeGreaterThan(0.65)
    expect(normal.first).toBeLessThan(0.85)
    expect(hard.first).toBeGreaterThan(0.97)
    expect(impossible.first).toBeGreaterThan(0.97)
    // Shots 4 and 5, after it has seen where the first ones went.
    expect(easy.later).toBeGreaterThan(easy.first + 0.1)
    expect(normal.later).toBeGreaterThan(normal.first)
  }, 60_000)

  it('misses look human: errors fall on both sides, more often past the target than short', () => {
    let over = 0
    let short = 0
    // N1 up and to the left, so pink's barrel (facing left) has to turn to it.
    const slanted: LevelDef = { ...DUEL, cannons: DUEL.cannons.map((c) => (c.id === 'n1' ? { ...c, y: 230 } : c)) }
    const lanes = levelLanes(slanted)
    for (let i = 0; i < 60; i++) {
      const level = { ...withDifficulty(slanted, 'easy'), id: `look-${i}` }
      const sim = new BattleSim(level, null, {}, lanes)
      const e1 = sim.byId('e1')!
      const before = e1.angle
      while (sim.clock < 600 && !e1.aimPoint) sim.step(FRAME)
      if (!e1.aimPoint) continue
      const n1 = sim.byId('n1')!
      const want = Math.atan2(n1.y - e1.y, n1.x - e1.x)
      const got = Math.atan2(e1.aimPoint.y - e1.y, e1.aimPoint.x - e1.x)
      const turn = Math.sign(Math.atan2(Math.sin(want - before), Math.cos(want - before)))
      const err = Math.atan2(Math.sin(got - want), Math.cos(got - want))
      if (Math.sign(err) === turn) over += 1
      else short += 1
    }
    expect(over).toBeGreaterThan(short)
    expect(short).toBeGreaterThan(0)
  })
})

// ------------------------------------------------------------ trick shots

/** Pink can only reach N1 off a wall or through the fan: a wall stands in the straight line. */
const TRICKY: LevelDef = {
  id: 'tricky', name: 'Tricky', kind: 'battle',
  walls: [{ x: 620, y: 300, w: 26, h: 260 }],
  fans: [{ x: 640, y: 200, radius: 110, angle: Math.PI / 2 }],
  cannons: [
    { id: 'p1', name: 'P1', x: 80, y: 650, side: 'player' },
    { id: 'e1', name: 'E1', x: 950, y: 430, side: 'enemy' },
    { id: 'n1', name: 'N1', x: 330, y: 430, side: 'neutral' },
  ],
}

describe('trick shots by level', () => {
  const lanes = levelLanes(TRICKY)

  it('Easy only ever uses straight shots, Normal at most one bounce or fan, Hard everything', () => {
    const maxTricks = (d: AiLevel): number => {
      const sim = new BattleSim(withDifficulty(TRICKY, d), null, {}, lanes)
      sim.step(FRAME)
      let most = 0
      for (const table of sim.ai.lanesInUse().values()) for (const lane of table.values()) most = Math.max(most, laneTricks(lane))
      return most
    }
    expect(maxTricks('easy')).toBe(0)
    expect(maxTricks('normal')).toBeLessThanOrEqual(1)
    expect(maxTricks('hard')).toBeGreaterThanOrEqual(1)
  })

  it('in play, Easy never aims a trick shot (it leaves N1 alone); Hard banks onto it', () => {
    const run = (d: AiLevel): { aimedAtN1: boolean; trick: boolean } => {
      const sim = new BattleSim(withDifficulty(TRICKY, d), null, {}, lanes)
      sim.byId('p1')!.update = () => null
      let aimedAtN1 = false
      let trick = false
      while (sim.clock < 15_000 && !sim.ended) {
        sim.step(FRAME)
        const e1 = sim.byId('e1')!
        const job = sim.ai.jobs.get(e1)
        if (job?.target.id === 'n1') {
          aimedAtN1 = true
          const lane = sim.ai.lanesInUse().get('e1' + (e1.kind === 'normal' ? '' : '#' + e1.kind))?.get('n1')
          if (lane && laneTricks(lane) > 0) trick = true
        }
      }
      return { aimedAtN1, trick }
    }
    const easy = run('easy')
    expect(easy.trick).toBe(false)
    expect(easy.aimedAtN1).toBe(false)
    const hard = run('hard')
    expect(hard.aimedAtN1).toBe(true)
    expect(hard.trick).toBe(true)
  })
})

// ------------------------------------------------------------ old maps

describe('old maps get an explicit difficulty', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage()
  })

  const old = (ai?: Record<string, unknown>) => ({ ...DUEL, id: 'custom-old', ai })

  it('reads the old fire-rate thresholds once, then keeps only the difficulty', () => {
    expect(sanitizeLevel(old({ retargetMs: 2400, fireMs: 1400 }) as LevelDef).ai).toEqual({ difficulty: 'easy' })
    expect(sanitizeLevel(old({ retargetMs: 1800, fireMs: 1150 }) as LevelDef).ai).toEqual({ difficulty: 'normal' })
    expect(sanitizeLevel(old({ retargetMs: 1300, fireMs: 1000 }) as LevelDef).ai).toEqual({ difficulty: 'hard' })
    expect(sanitizeLevel(old(undefined) as LevelDef).ai).toEqual({ difficulty: 'hard' })
    expect(sanitizeLevel(old({ difficulty: 'impossible', fireMs: 1400 }) as LevelDef).ai).toEqual({ difficulty: 'impossible' })
    expect(sanitizeLevel(old({ difficulty: 'nightmare', fireMs: 1400 }) as LevelDef).ai).toEqual({ difficulty: 'easy' })
  })

  it('old share codes, saved maps and drafts load with their difficulty', () => {
    const json = JSON.stringify(old({ retargetMs: 2400, fireMs: 1400 }))
    const code = 'CC1:' + btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(decodeShare(code).ai).toEqual({ difficulty: 'easy' })
    localStorage.setItem('cannon-capture:maps:v1', JSON.stringify({ maps: [{ level: old({ retargetMs: 1800, fireMs: 1150 }), updated: 1 }] }))
    expect(listMaps()[0].level.ai).toEqual({ difficulty: 'normal' })
    localStorage.setItem('cannon-capture:editor-draft:v1', JSON.stringify({ level: old({ retargetMs: 2400, fireMs: 1400 }), savedId: null }))
    expect(loadDraft()?.level.ai).toEqual({ difficulty: 'easy' })
    // New codes carry the difficulty, and only that.
    expect(decodeShare(encodeShare(withDifficulty(DUEL, 'impossible'))).ai).toEqual({ difficulty: 'impossible' })
  })

  it('campaign levels keep their files; their difficulty is read from the old numbers', () => {
    const d = Object.fromEntries(CAMPAIGN.filter((l) => l.kind !== 'puzzle').map((l) => [l.id, levelDifficulty(l)]))
    expect(d).toEqual({ 'tug-of-war': 'easy', 'walls-up': 'normal', crossfire: 'normal', 'last-stand': 'hard', 'sniper-duel': 'hard' })
  })

  it('the editor menu lists all four, Impossible last', () => {
    expect(Object.values(DIFFICULTY).map((x) => x.label)).toEqual(['Easy', 'Normal', 'Hard', 'Impossible'])
  })
})

// ------------------------------------------------------------ Impossible


describe('Impossible', () => {
  it('beats Hard more often than not in AI-vs-AI matches (each mirrored map played from both sides)', () => {
    // Only the step cap limits the look-ahead here, so the result doesn't depend on how busy the computer is.
    const la = TUNING.aiLookahead as { frameBudgetMs: number }
    const budget = la.frameBudgetMs
    la.frameBudgetMs = Infinity
    let points = 0
    let games = 0
    const lines: string[] = []
    for (let i = 0; i < 10; i++) {
      const map = mirrored(i)
      const asPink = match(map, 'impossible', 'hard')
      const asGold = match(map, 'hard', 'impossible')
      const score = (w: Side | 'draw', me: Side) => (w === me ? 1 : w === 'draw' ? 0.5 : 0)
      points += score(asPink, 'enemy') + score(asGold, 'player')
      games += 2
      lines.push(`${map.id}: as pink ${asPink}, as gold ${asGold}`)
    }
    la.frameBudgetMs = budget
    console.log(`Impossible vs Hard: ${points}/${games}\n` + lines.join('\n'))
    expect(points / games).toBeGreaterThan(0.5)
  }, 120_000)

  it('look-ahead stays within its frame budget on a Huge map', () => {
    const b = boardFor('huge')
    const list: CannonDef[] = []
    const sides: Side[] = ['player', 'enemy', 'neutral']
    for (let i = 0; i < 40; i++) {
      const side = i < 4 ? 'player' : i < 10 ? 'enemy' : sides[i % 3]
      list.push({ id: `c${i}`, name: `C${i}`, side, x: Math.round(b.x + 80 + ((i * 397) % (b.w - 160))), y: Math.round(b.y + 80 + ((i * 251) % (b.h - 160))) })
    }
    const base = sanitizeLevel({ id: 'huge-imp', name: 'Huge', size: 'huge', kind: 'battle', cannons: list, walls: [], fans: [{ x: 1500, y: 900, radius: 200, angle: 0 }] })
    const lanes = levelLanes(base, 2)
    const frameCost = (d: AiLevel) => {
      const sim = new BattleSim(withDifficulty(base, d), null, {}, lanes)
      sim.addAi('player', 'hard')
      let total = 0
      let worst = 0
      const frames = 60 * 15
      for (let i = 0; i < frames && !sim.ended; i++) {
        const t0 = performance.now()
        sim.step(FRAME)
        const ms = performance.now() - t0
        total += ms
        if (i > 5) worst = Math.max(worst, ms)
      }
      return { avg: total / frames, worst, la: sim.ai.lookahead }
    }
    const hard = frameCost('hard')
    const imp = frameCost('impossible')
    const perThink = imp.la.thinks ? imp.la.totalMs / imp.la.thinks : 0
    console.log('frame ms', JSON.stringify({ hard: { avg: hard.avg, worst: hard.worst }, impossible: { avg: imp.avg, worst: imp.worst, msPerThink: perThink, ...imp.la } }))
    expect(imp.la.thinks).toBeGreaterThan(5)
    // The look-ahead never takes much more than its budget in one frame (one sim step may overrun it a little).
    expect(imp.la.maxFrameMs).toBeLessThan(TUNING.aiLookahead.frameBudgetMs + 6)
    expect(imp.la.maxFrameSteps).toBeLessThanOrEqual(TUNING.aiLookahead.frameSteps)
    expect(imp.avg - hard.avg).toBeLessThan(TUNING.aiLookahead.frameBudgetMs)
  }, 120_000)
})
