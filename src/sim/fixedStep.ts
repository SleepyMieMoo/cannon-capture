/**
 * The round always advances in steps of the same length, whatever the frame
 * rate, so it plays out the same on every machine (and a host and its
 * players agree on what "tick 1200" means). The screen draws between steps.
 */
export const SIM_STEP_MS = 1000 / 60

export class FixedStep {
  private acc = 0

  /**
   * @param stepMs  length of one step
   * @param maxSteps  most steps in one frame: a slow frame slows the game down
   *   (as before: frames were capped at 32 ms) instead of jumping ahead
   */
  constructor(
    readonly stepMs = SIM_STEP_MS,
    readonly maxSteps = 2,
  ) {}

  /** How many steps to run for a frame of `deltaMs`. */
  take(deltaMs: number): number {
    this.acc += Math.max(0, deltaMs)
    let n = Math.floor(this.acc / this.stepMs + 1e-9)
    if (n > this.maxSteps) {
      n = this.maxSteps
      this.acc = 0
    } else this.acc -= n * this.stepMs
    if (this.acc < 0) this.acc = 0
    return n
  }

  /** How far the screen is between the last step and the next (0..1), for drawing. */
  get alpha(): number {
    return Math.min(1, this.acc / this.stepMs)
  }

  reset(): void {
    this.acc = 0
  }
}
