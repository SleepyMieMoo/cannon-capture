import { SIM_STEP_MS } from './fixedStep'

export const CATCH_UP = {
  /** At most this much missed time is played back (ms): longer away and the rest is skipped. */
  maxMs: 60_000,
  /** Time per frame spent catching up (ms), so the page never freezes; the rest waits for the next frame. */
  frameBudgetMs: 12,
}

/**
 * "Pause vs AI when tabbed out" off: the round kept going while the tab was
 * hidden, but a hidden tab draws no frames, so nothing ran. On return the
 * missed time is played back in fixed steps, a frame's budget at a time,
 * until it is caught up (or the round ends). Pure, for the tests.
 */
export class CatchUp {
  /** Missed time still to play back (ms). */
  debtMs = 0

  constructor(
    readonly stepMs = SIM_STEP_MS,
    readonly maxMs = CATCH_UP.maxMs,
  ) {}

  get active(): boolean {
    return this.debtMs >= this.stepMs
  }

  /** The tab was away for `ms`. */
  add(ms: number): void {
    if (!(ms > 0)) return
    this.debtMs = Math.min(this.maxMs, this.debtMs + ms)
  }

  clear(): void {
    this.debtMs = 0
  }

  /**
   * Run steps until caught up, the budget is spent, or `step` says stop
   * (it returns false once the round has ended: the rest is dropped).
   * Returns how many steps ran.
   */
  run(step: () => boolean, clock: () => number = () => performance.now(), budgetMs = CATCH_UP.frameBudgetMs): number {
    const t0 = clock()
    let n = 0
    while (this.debtMs >= this.stepMs) {
      this.debtMs -= this.stepMs
      n++
      if (!step()) {
        this.debtMs = 0
        break
      }
      if (clock() - t0 >= budgetMs) break
    }
    if (this.debtMs < this.stepMs) this.debtMs = 0
    return n
  }
}
