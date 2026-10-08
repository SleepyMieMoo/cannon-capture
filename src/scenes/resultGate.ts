/**
 * The result panel's safety net. The round decides it is over (game logic:
 * sim.ended); this only makes sure the panel is on screen while it is, from
 * every place that asks: each frame, coming back to the tab, and a light
 * timer that runs even when no frames are drawn. Building it is retried if it
 * fails, and it is never built while one is already up (so never twice).
 */
export class ResultGate {
  /** Panels built (for the tests and the debug view). */
  built = 0
  /** Builds that threw (each is retried on the next check). */
  failed = 0

  constructor(
    private readonly build: () => void,
    private readonly isUp: () => boolean,
  ) {}

  /** Show the panel if the round is over and none is up. Returns true when it built one. */
  check(ended: unknown, blocked = false): boolean {
    if (!ended || blocked || this.isUp()) return false
    try {
      this.build()
    } catch (e) {
      this.failed++
      console.error('Result panel failed to build; retrying', e)
      return false
    }
    this.built++
    return true
  }
}
