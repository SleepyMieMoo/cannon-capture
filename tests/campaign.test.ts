import { describe, expect, it } from 'vitest'
import { BOARD } from '../src/config/layout'
import { TUNING } from '../src/config/tuning'
import { CAMPAIGN, SKIRMISH } from '../src/levels'
import { MIN_LANE_DEG, lanesFromSweep, levelLanes, planPuzzle } from '../src/sim/solver'
import { currentLevelIndex, isUnlocked, starsFor, withWin } from '../src/sim/stars'
import { BattleSim } from '../src/sim/BattleSim'
import { BattleBot, MirrorBot, PuzzleBot, playOut } from '../src/sim/bots'

describe('campaign data', () => {
  it('has 6 to 8 levels with unique ids, names and hints', () => {
    expect(CAMPAIGN.length).toBeGreaterThanOrEqual(6)
    expect(CAMPAIGN.length).toBeLessThanOrEqual(8)
    const ids = new Set([...CAMPAIGN, SKIRMISH].map((l) => l.id))
    expect(ids.size).toBe(CAMPAIGN.length + 1)
    for (const level of CAMPAIGN) {
      expect(level.name.length).toBeGreaterThan(0)
      expect(level.hint && level.hint.length).toBeTruthy()
    }
  })

  it('includes at least two puzzle levels and keeps puzzles enemy-free', () => {
    const puzzles = CAMPAIGN.filter((l) => l.kind === 'puzzle')
    expect(puzzles.length).toBeGreaterThanOrEqual(2)
    for (const level of puzzles) expect(level.cannons.some((c) => c.side === 'enemy')).toBe(false)
  })

  it('keeps every cannon on the board and off the walls', () => {
    const r = TUNING.cannonRadius
    for (const level of CAMPAIGN) {
      for (const c of level.cannons) {
        expect(c.x - r, `${level.id}/${c.id}`).toBeGreaterThanOrEqual(BOARD.x)
        expect(c.x + r, `${level.id}/${c.id}`).toBeLessThanOrEqual(BOARD.x + BOARD.w)
        expect(c.y - r, `${level.id}/${c.id}`).toBeGreaterThanOrEqual(BOARD.y)
        expect(c.y + r, `${level.id}/${c.id}`).toBeLessThanOrEqual(BOARD.y + BOARD.h)
        for (const w of level.walls) {
          const nx = Math.max(w.x, Math.min(c.x, w.x + w.w))
          const ny = Math.max(w.y, Math.min(c.y, w.y + w.h))
          expect(Math.hypot(c.x - nx, c.y - ny), `${level.id}/${c.id} vs wall`).toBeGreaterThan(r)
        }
      }
    }
  })
})

describe('every puzzle is solvable within its aim budget', () => {
  for (const level of CAMPAIGN.filter((l) => l.kind === 'puzzle')) {
    it(level.id, () => {
      const plan = planPuzzle(level)
      expect(plan.solved).toBe(true)
      if (level.aims !== undefined) expect(plan.steps.length).toBeLessThanOrEqual(level.aims)
      if (level.par !== undefined && level.aims !== undefined) expect(plan.steps.length).toBeLessThanOrEqual(level.par)
    })
  }
})

describe('every battle gives you a shot at every cannon', () => {
  for (const level of CAMPAIGN.filter((l) => l.kind !== 'puzzle')) {
    it(level.id, () => {
      const lanes = levelLanes(level)
      // Once you hold every cannon but one, some cannon must be able to hit it.
      for (const target of level.cannons) {
        const reachable = level.cannons.some(
          (from) => from.id !== target.id && (lanes.get(from.id)?.get(target.id)?.widthDeg ?? 0) >= MIN_LANE_DEG,
        )
        expect(reachable, `${level.id}: nothing can hit ${target.id}`).toBe(true)
      }
    })
  }
})

describe('lane finder', () => {
  it('finds the widest run, including one that wraps past 360°', () => {
    const hits = ['a', 'a', null, 'b', 'b', 'b', null, 'a']
    const lanes = lanesFromSweep(hits, 45)
    expect(lanes.get('b')?.widthDeg).toBe(135)
    expect(lanes.get('a')?.widthDeg).toBe(135)
    expect(lanes.get('a')?.angle).toBeCloseTo((0 * Math.PI) / 180)
  })
})

describe('stars and unlocks', () => {
  const battle = CAMPAIGN.find((l) => l.kind !== 'puzzle' && l.par)!
  const puzzle = CAMPAIGN.find((l) => l.kind === 'puzzle' && l.aims !== undefined && l.par)!

  it('rates battles by time and puzzles by aims', () => {
    expect(starsFor(battle, { seconds: battle.par!, aimsUsed: 99 })).toBe(3)
    expect(starsFor(battle, { seconds: battle.par! * 1.4, aimsUsed: 0 })).toBe(2)
    expect(starsFor(battle, { seconds: battle.par! * 3, aimsUsed: 0 })).toBe(1)
    expect(starsFor(puzzle, { seconds: 999, aimsUsed: puzzle.par! })).toBe(3)
    expect(starsFor(puzzle, { seconds: 0, aimsUsed: puzzle.par! + 1 })).toBe(2)
    expect(starsFor(puzzle, { seconds: 0, aimsUsed: puzzle.par! + 2 })).toBe(1)
  })

  it('unlocks levels in order and keeps best stars', () => {
    let progress = { stars: {} as Record<string, number> }
    expect(isUnlocked(CAMPAIGN, 0, progress)).toBe(true)
    expect(isUnlocked(CAMPAIGN, 1, progress)).toBe(false)
    expect(currentLevelIndex(CAMPAIGN, progress)).toBe(0)
    progress = withWin(progress, CAMPAIGN[0].id, 2)
    progress = withWin(progress, CAMPAIGN[0].id, 1)
    expect(progress.stars[CAMPAIGN[0].id]).toBe(2)
    expect(isUnlocked(CAMPAIGN, 1, progress)).toBe(true)
    expect(isUnlocked(CAMPAIGN, 2, progress)).toBe(false)
    expect(currentLevelIndex(CAMPAIGN, progress)).toBe(1)
  })
})

describe('every campaign level is beaten by an autoplayer (same rules as you)', () => {
  // Frame rates vary, so play each level at a few fixed timesteps.
  const timesteps = [1000 / 60, 1000 / 45, 1000 / 30]
  for (const level of CAMPAIGN) {
    it(level.id, () => {
      const lanes = levelLanes(level)
      for (const dt of timesteps) {
        const strategies = level.kind === 'puzzle'
          ? [(sim: BattleSim) => new PuzzleBot(sim)]
          : [(sim: BattleSim) => new BattleBot(sim), (sim: BattleSim) => new MirrorBot(sim)]
        const wins = strategies.map((make) => {
          const sim = new BattleSim(level, null, {}, lanes)
          return playOut(sim, make(sim), 240_000, dt)
        })
        const won = wins.find((r) => r.result === 'win')
        expect(won, `${level.id} @${dt.toFixed(1)}ms: ${JSON.stringify(wins)}`).toBeTruthy()
        if (level.kind === 'puzzle' && level.aims !== undefined) expect(won!.aimsUsed).toBeLessThanOrEqual(level.aims)
      }
    })
  }
})
