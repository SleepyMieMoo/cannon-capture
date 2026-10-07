import { TUNING } from '../config/tuning'
import { pickAiTarget } from '../sim/targeting'
import type { Cannon } from '../entities/Cannon'

/** Periodically aims every enemy cannon at the nearest weak non-enemy cannon. */
export class AiController {
  private elapsed = 0

  reset(): void {
    // Keep the level's opening targets for one full retarget interval.
    this.elapsed = 0
  }

  update(dt: number, cannons: Cannon[]): void {
    this.elapsed += dt
    if (this.elapsed < TUNING.aiRetargetMs) return
    this.elapsed = 0
    this.retarget(cannons)
  }

  retarget(cannons: Cannon[]): void {
    const prey = cannons.filter((cannon) => cannon.side !== 'enemy')
    for (const cannon of cannons) {
      if (cannon.side !== 'enemy') continue
      const choice = pickAiTarget(
        cannon,
        prey.map((other) => ({
          id: other.id,
          x: other.x,
          y: other.y,
          attacker: other.captureAttacker,
          progress: other.captureProgress,
        })),
        TUNING.aiFinishBias,
        cannon.target?.id ?? null,
        TUNING.aiRetargetSlack,
      )
      cannon.setTarget(choice ? (cannons.find((other) => other.id === choice.id) ?? null) : null)
    }
  }
}
