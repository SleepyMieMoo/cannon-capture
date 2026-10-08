/** What PauseHold needs from the round. */
export interface Pausable {
  readonly paused: boolean
  readonly ended: unknown
  pause(): boolean
  resume(): void
}

/**
 * Pause the round while a menu is open, and on close resume it only if the
 * menu was what paused it (a tactical pause you started stays on).
 */
export class PauseHold {
  private held = false
  open = false

  constructor(private readonly round: () => Pausable) {}

  hold(): void {
    if (this.open) return
    this.open = true
    const r = this.round()
    this.held = !r.paused && !r.ended && r.pause()
  }

  release(): void {
    if (!this.open) return
    this.open = false
    const r = this.round()
    if (this.held && r.paused) r.resume()
    this.held = false
  }
}
