import { type AiController, aimViaLane, healViaLane, planCover, planHeals, pointAlong } from '../ai/AiController'
import { SwapGovernor, canReach, swapPolicy } from '../ai/towerChoice'
import { TUNING } from '../config/tuning'
import type { Cannon } from '../entities/Cannon'
import type { BattleSim } from './BattleSim'
import type { AiLevel } from '../types'
import { lanesOf, planPuzzle } from './solver'

/**
 * Autoplayers for your side, used to prove levels can be beaten (tests and
 * the ?debug&bot switch). They obey the same rules: same turn speed, same
 * aim budget, and they only re-aim every couple of seconds.
 */
export interface Bot {
  update(dt: number): void
}

export function makeBot(sim: BattleSim): Bot {
  return sim.isPuzzle ? new PuzzleBot(sim) : new BattleBot(sim)
}

/** Follows the solver's plan, waiting for each capture before re-aiming a cannon. */
export class PuzzleBot implements Bot {
  private readonly plan
  private step = 0
  private readonly pending = new Map<string, string>()

  constructor(private readonly sim: BattleSim) {
    this.plan = planPuzzle(sim.level, sim.lanes)
  }

  update(): void {
    if (this.step >= this.plan.steps.length) return
    const step = this.plan.steps[this.step]
    const from = this.sim.byId(step.from)
    const to = this.sim.byId(step.to)
    if (!from || !to || from.side !== 'player') return
    const pending = this.pending.get(from.id)
    if (pending && this.sim.byId(pending)?.side !== 'player') return
    if (from.kind !== step.kind) this.sim.playerSwap(from, step.kind) // free in puzzles
    const aim = step.lane.direct ? to : pointAlong(from, step.lane.angle, this.sim.board)
    if (!this.sim.playerAim(from, aim)) return
    this.pending.set(from.id, to.id)
    this.step += 1
  }
}

/**
 * Battle bot: every few seconds, gang up on one foe. It prefers foes it is
 * already capturing, then enemy cannons that most of its cannons can hit.
 */
export class BattleBot implements Bot {
  private timer = 0
  private focus: Cannon | null = null
  private readonly aims = new Map<string, string>()
  private readonly swaps: SwapGovernor

  constructor(
    private readonly sim: BattleSim,
    private readonly everyMs = TUNING.aiRetargetMs,
  ) {
    // Same type-choice rules as the enemy AI (and as you: every swap reloads).
    this.swaps = new SwapGovernor(swapPolicy({ ai: undefined }))
  }

  /** Fit `m` for its job and aim it (re-aims when the type changed). */
  private fitAndAim(m: Cannon, target: Cannon): void {
    const { sim } = this
    const swapped = this.swaps.consider(m, target, sim.lanes, (c, kind) => sim.playerSwap(c, kind))
    if (!swapped && this.aims.get(m.id) === target.id && m.aim()) return
    aimViaLane(m, target, lanesOf(sim.lanes, m)?.get(target.id), sim.board)
    this.aims.set(m.id, target.id)
  }

  update(dt: number): void {
    this.swaps.tick(dt)
    this.timer -= dt
    if (this.timer > 0) return
    this.timer = this.everyMs
    const { sim } = this
    const mine = sim.cannons.filter((c) => c.side === 'player')
    const foes = sim.cannons.filter((c) => c.side !== 'player')
    const canHit = (m: Cannon, foe: Cannon) => canReach(m, foe, sim.lanes)
    // A foe nobody can reach as fitted: send the cannon that can after a swap.
    const cover = new Map(planCover('player', sim.cannons, sim.lanes).map((o) => [o.cannon, o.foe]))

    let focus: Cannon | null = null
    let bestScore = -Infinity
    for (const foe of foes) {
      const shooters = mine.filter((m) => canHit(m, foe)).length
      if (!shooters) continue
      const mineProgress = foe.captureAttacker === 'player' ? foe.captureProgress : 0
      const score = shooters * 10 + mineProgress * 6 + (foe === this.focus ? 8 : 0) + (foe.side === 'enemy' ? 3 : 0)
      if (score > bestScore) {
        bestScore = score
        focus = foe
      }
    }
    this.focus = focus

    // Heal a cannon that is close to flipping, the way a player would.
    for (const { helper, friend } of planHeals('player', sim.cannons, sim.lanes)) {
      this.swaps.consider(helper, friend, sim.lanes, (c, kind) => sim.playerSwap(c, kind))
      healViaLane(helper, friend, lanesOf(sim.lanes, helper)?.get(friend.id), sim.board)
      this.aims.delete(helper.id)
    }

    for (const m of mine) {
      if (m.healing && m.healing.side === 'player' && m.healing.damaged) {
        const friend = m.healing
        if (this.swaps.consider(m, friend, sim.lanes, (c, kind) => sim.playerSwap(c, kind))) {
          healViaLane(m, friend, lanesOf(sim.lanes, m)?.get(friend.id), sim.board)
        }
        continue
      }
      let target = cover.get(m) ?? (focus && canHit(m, focus) ? focus : null)
      if (!target) {
        let best = Infinity
        for (const foe of foes) {
          if (!canHit(m, foe)) continue
          const d = Math.hypot(foe.x - m.x, foe.y - m.y)
          if (d < best) {
            best = d
            target = foe
          }
        }
      }
      if (!target) continue
      this.fitAndAim(m, target)
    }
  }
}

/**
 * Plays your side exactly like the enemy AI plays its own (spread fire,
 * nearest weak foe), at the given difficulty (Hard by default: perfect aim).
 * The AI is added to the round and runs with it, so update() has nothing to do.
 */
export class MirrorBot implements Bot {
  readonly ai: AiController

  constructor(sim: BattleSim, difficulty: AiLevel = 'hard') {
    this.ai = sim.addAi('player', difficulty)
  }

  update(_dt?: number): void {}
}

/** Run a level headless with a bot until it ends or `maxMs` of game time passes. */
export function playOut(sim: BattleSim, bot: Bot = makeBot(sim), maxMs = 300_000, dt = 1000 / 60) {
  while (!sim.ended && sim.clock < maxMs) {
    bot.update(dt)
    sim.step(dt)
  }
  return { result: sim.ended, seconds: Math.round(sim.clock / 1000), aimsUsed: sim.aimsUsed }
}
