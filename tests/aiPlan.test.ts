import { describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning'
import { BattleSim } from '../src/sim/BattleSim'
import { BattleBot } from '../src/sim/bots'
import { levelLanes } from '../src/sim/solver'
import { sanitizeLevel, withDifficulty, type Difficulty } from '../src/editor/maps'
import type { Cannon } from '../src/entities/Cannon'
import type { LevelDef } from '../src/types'

const FRAME = 1000 / 60

function sim(level: LevelDef, d: Difficulty = 'hard'): BattleSim {
  const l = sanitizeLevel(withDifficulty(level, d))
  return new BattleSim(l, null, {}, levelLanes(l))
}

function run(s: BattleSim, ms: number, each?: () => void): void {
  const end = s.clock + ms
  while (s.clock < end && !s.ended) {
    s.step(FRAME)
    each?.()
  }
}

/** Like Nova's Hard playtest: two unaimed pink cannons, a fan and a wall in the middle, neutrals all around. */
const NOVA: LevelDef = {
  id: 'custom-nova', name: 'Nova', kind: 'battle', size: 'medium',
  walls: [{ x: 1000, y: 200, w: 22, h: 170 }],
  fans: [{ x: 930, y: 280, radius: 115, angle: 0 }],
  cannons: [
    { id: 'p1', name: 'P1', x: 150, y: 300, side: 'player', aimAt: 'n4' },
    { id: 'p2', name: 'P2', x: 300, y: 820, side: 'player', aimAt: 'n4' },
    { id: 'p3', name: 'P3', x: 600, y: 600, side: 'player', aimAt: 'n1' },
    { id: 'e1', name: 'E1', x: 1150, y: 140, side: 'enemy' },
    { id: 'e2', name: 'E2', x: 1290, y: 470, side: 'enemy', kind: 'sniper' },
    { id: 'n1', name: 'N1', x: 900, y: 340, side: 'neutral' },
    { id: 'n2', name: 'N2', x: 1250, y: 520, side: 'neutral' },
    { id: 'n3', name: 'N3', x: 1460, y: 450, side: 'neutral' },
    { id: 'n4', name: 'N4', x: 120, y: 700, side: 'neutral' },
    { id: 'n5', name: 'N5', x: 850, y: 110, side: 'neutral' },
  ],
}

/** Two pink cannons side by side; n1 is the nearest for both, n2 a bit further. */
const TWO: LevelDef = {
  id: 'two', name: 'Two', kind: 'battle', walls: [], fans: [],
  cannons: [
    { id: 'p1', name: 'P1', x: 80, y: 120, side: 'player' },
    { id: 'e1', name: 'E1', x: 900, y: 330, side: 'enemy' },
    { id: 'e2', name: 'E2', x: 900, y: 450, side: 'enemy' },
    { id: 'n1', name: 'N1', x: 640, y: 390, side: 'neutral' },
    { id: 'n2', name: 'N2', x: 640, y: 520, side: 'neutral' },
  ],
}

/** Events that may change a plan at any time (anything else waits for commitMs). */
const EVENT = /captured|no lane|under attack|lost|healed|no job|lanes ready|idle|forced/

describe('AI commits to a plan', () => {
  it('stagger: cannons think on their own ticks, not all at once', () => {
    const s = sim(NOVA)
    run(s, 2 * FRAME)
    const e1 = s.byId('e1')!
    const e2 = s.byId('e2')!
    expect(s.ai.nextThinkAt(e1)).not.toBe(s.ai.nextThinkAt(e2))
    // Unaimed pink cannons decide in the first moments, one after the other.
    run(s, 600)
    expect(e1.aim()).not.toBe(null)
    expect(e2.aim()).not.toBe(null)
    const t = s.ai.log.filter((d) => d.id === 'e1' || d.id === 'e2').map((d) => d.t)
    expect(new Set(t).size).toBe(t.length)
  })

  it.each(['easy', 'normal', 'hard', 'impossible'] as const)("Nova's map on %s: no cannon changes its mind within commitMs unless something actually happened", (d) => {
    const s = sim(NOVA, d)
    const bot = new BattleBot(s)
    while (s.clock < 40_000 && !s.ended) {
      bot.update(FRAME)
      s.step(FRAME)
    }
    expect(s.ai.log.length).toBeGreaterThan(2)
    const last = new Map<string, number>()
    for (const e of s.ai.log) {
      const prev = last.get(e.id)
      if (!EVENT.test(e.why) && !e.why.startsWith('refit') && prev !== undefined) {
        expect(e.t - prev, `${e.id} at ${e.t}ms: ${e.why}`).toBeGreaterThanOrEqual(TUNING.aiLevels[d].commitMs)
      }
      if (!e.why.startsWith('refit')) last.set(e.id, e.t)
    }
  })

  it('a quiet board: the plan stays exactly the same for many seconds', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const s = sim(TWO, d)
      run(s, 1000)
      const e1 = s.byId('e1')!
      const e2 = s.byId('e2')!
      // The job (target and type) stays put; Easy and Normal may nudge their aim after a miss.
      const job = (c: Cannon) => `${c.kind} ${s.ai.jobs.get(c)?.kind} ${s.ai.jobs.get(c)?.target.id}`
      const plan = [job(e1), job(e2)]
      let changes = 0
      // Nothing gets captured in 6 s (8 hits at 1 per second or slower).
      run(s, 6000, () => {
        if (job(e1) !== plan[0] || job(e2) !== plan[1]) changes += 1
      })
      expect(changes, d).toBe(0)
    }
  })

  it('coordination: two cannons and two neutrals split up, and never swap targets', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const s = sim(TWO, d)
      const e1 = s.byId('e1')!
      const e2 = s.byId('e2')!
      run(s, 1000)
      const first = [s.ai.jobs.get(e1)?.target.id, s.ai.jobs.get(e2)?.target.id]
      expect(new Set(first), d).toEqual(new Set(['n1', 'n2']))
      run(s, 6000)
      expect([s.ai.jobs.get(e1)?.target.id, s.ai.jobs.get(e2)?.target.id], d).toEqual(first)
    }
  })

  it('still reacts to a friend under attack, Hard quicker than Easy', () => {
    const react = (d: Difficulty): number => {
      const s = sim(TWO, d)
      run(s, 1000)
      const e2 = s.byId('e2')!
      e2.captureAttacker = 'player'
      e2.captureProgress = 5
      const start = s.clock
      let at = -1
      run(s, 3000, () => {
        if (at < 0 && s.byId('e1')!.healing === e2) at = s.clock - start
      })
      return at
    }
    const hard = react('hard')
    const easy = react('easy')
    expect(hard).toBeGreaterThan(0)
    expect(hard).toBeLessThanOrEqual(TUNING.aiLevels.hard.reactMs + 50)
    expect(easy).toBeGreaterThanOrEqual(TUNING.aiLevels.easy.reactMs - 50)
    expect(easy).toBeLessThanOrEqual(TUNING.aiLevels.easy.reactMs + 50)
  })

  it('a friend one hit from flipping gets a second helper', () => {
    const level: LevelDef = {
      ...TWO,
      cannons: [...TWO.cannons, { id: 'e3', name: 'E3', x: 1000, y: 390, side: 'enemy' }],
    }
    const s = sim(level)
    run(s, 1000)
    const e3 = s.byId('e3')!
    e3.captureAttacker = 'player'
    e3.captureProgress = 7
    run(s, 400)
    expect(s.cannons.filter((c) => c.healing === e3).length).toBe(2)
  })

  it('a job whose target is captured is replaced quickly', () => {
    const s = sim(TWO)
    run(s, 1000)
    const e1 = s.byId('e1')!
    const target = e1.target!
    while (target.side !== 'enemy') target.receiveHit('enemy', 1)
    run(s, TUNING.aiLevels.hard.reactMs + 50)
    expect(e1.target).not.toBe(null)
    expect(e1.target).not.toBe(target)
  })

  it('never changes its mind mid-turn, even after the commitment is over', () => {
    const level: LevelDef = {
      id: 'turn', name: 'Turn', kind: 'battle', walls: [], fans: [],
      cannons: [
        { id: 'p1', name: 'P1', x: 80, y: 120, side: 'player' },
        { id: 'e1', name: 'E1', x: 600, y: 390, side: 'enemy', kind: 'sniper', aimAt: 'far' },
        { id: 'far', name: 'Far', x: 1100, y: 390, side: 'neutral' },
        { id: 'near', name: 'Near', x: 400, y: 390, side: 'neutral' },
      ],
    }
    const s = sim(level)
    const e1 = s.byId('e1')!
    const far = s.byId('far')!
    run(s, FRAME)
    expect(s.ai.jobs.get(e1)?.target).toBe(far)
    // Commitment long over, barrel spun round: the near cannon is quicker, but it is mid-turn.
    s.ai.jobs.get(e1)!.since = -100_000
    e1.angle = Math.PI
    s.ai.retarget(s.cannons)
    expect(e1.target).toBe(far)
    // Once lined up it may switch.
    e1.angle = 0
    s.ai.retarget(s.cannons)
    expect(s.ai.jobs.get(e1)?.target.id).toBe('near')
  })
})
