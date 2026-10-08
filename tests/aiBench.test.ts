import { describe, expect, it } from 'vitest'
import { withDifficulty } from '../src/editor/maps'
import { BattleSim } from '../src/sim/BattleSim'
import { BattleBot } from '../src/sim/bots'
import { laneTricks, levelLanes } from '../src/sim/solver'
import { AI_LEVELS, type AiLevel } from '../src/types'
import { mirrored } from './helpers/arena'

/**
 * Difficulty benchmark (opt-in: AI_BENCH=1 npx vitest run tests/aiBench.test.ts).
 * A player proxy (BattleBot: perfect aim, gangs up on one foe every few
 * seconds) plays gold against pink's AI at each level on mirrored maps.
 * Reports the proxy's results and pink's shots: how many hit a cannon and
 * how many went down a trick lane (bank or fan).
 */
const FRAME = 1000 / 60
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const MAPS = Number(env.AI_BENCH_MAPS ?? 24)

function bench(d: AiLevel) {
  const out = { win: 0, lose: 0, draw: 0, shots: 0, hits: 0, misses: 0, tricks: 0, seconds: 0 }
  for (let seed = 0; seed < MAPS; seed++) {
    const level = withDifficulty({ ...mirrored(seed), kind: 'battle', id: `bench-${seed}` }, d)
    let sim: BattleSim | null = null
    sim = new BattleSim(level, null, {
      fired: (c) => {
        if (!sim || c.side !== 'enemy') return
        out.shots += 1
        const job = sim.ai.jobs.get(c)
        const lane = job ? sim.ai.lanesInUse().get(c.id + (c.kind === 'normal' ? '' : '#' + c.kind))?.get(job.target.id) : undefined
        if (lane && laneTricks(lane) > 0) out.tricks += 1
      },
    }, levelLanes(level))
    const landed = sim.ai.shotLanded.bind(sim.ai)
    sim.ai.shotLanded = (owner, hit, blocked) => {
      if (sim!.byId(owner)?.side === 'enemy' && !blocked) {
        if (hit) out.hits += 1
        else out.misses += 1
      }
      landed(owner, hit, blocked)
    }
    const bot = new BattleBot(sim)
    while (!sim.ended && sim.clock < 150_000) {
      bot.update(FRAME)
      sim.step(FRAME)
    }
    out.seconds += sim.clock / 1000
    if (sim.ended === 'win') out.win += 1
    else if (sim.ended === 'lose') out.lose += 1
    else {
      const p = sim.count('player')
      const e = sim.count('enemy')
      if (p > e) out.win += 1
      else if (e > p) out.lose += 1
      else out.draw += 1
    }
  }
  return {
    proxyWins: `${out.win}/${MAPS}`,
    aiWins: `${out.lose}/${MAPS}`,
    draws: out.draw,
    aiHitRate: +(out.hits / Math.max(1, out.hits + out.misses)).toFixed(2),
    aiTrickShare: +(out.tricks / Math.max(1, out.shots)).toFixed(3),
    avgSeconds: Math.round(out.seconds / MAPS),
  }
}

describe.skipIf(!env.AI_BENCH)('difficulty benchmark (player proxy vs each level)', () => {
  it('runs', () => {
    const rows = Object.fromEntries(AI_LEVELS.map((d) => [d, bench(d)]))
    console.log('AI bench', JSON.stringify(rows, null, 1))
    expect(Object.keys(rows)).toHaveLength(4)
  }, 600_000)
})
