/**
 * Gameplay knobs. Change these to retune the prototype without hunting
 * through scenes.
 */
export const TUNING = {
  /** Milliseconds between shots from the same cannon. */
  fireIntervalMs: 1000,
  /**
   * Phase offset between cannons so a volley is not a single tick.
   * Applied as (index % 3) * fireStaggerMs, so neither side fires first.
   */
  fireStaggerMs: 90,
  /** Delay before a newly captured cannon starts shooting. */
  captureKickoffMs: 280,
  /** Hits from one side required to flip a cannon. */
  captureThreshold: 8,
  /** Pixels per second. */
  shotSpeed: 340,
  /** Fan boost is capped at shotSpeed * shotSpeedCap. */
  shotSpeedCap: 1.75,
  /** How fast a cannon's barrel turns toward its aim, in degrees per second. */
  turnSpeedDeg: 110,
  /**
   * A cannon only fires once its barrel has finished turning onto its aim
   * (within this many degrees). The fire timer keeps counting during the
   * turn, so it shoots as soon as it is lined up and the timer is ready.
   */
  aimToleranceDeg: 0.5,
  shotRadius: 6,
  cannonRadius: 26,
  /** Extra pixels added to the click/touch target. */
  aimSlop: 14,
  /** Shots ignore the cannon that fired them for this long. */
  ownerGraceMs: 280,
  /** Shots disappear after this many wall hits. */
  maxBounces: 3,
  shotLifetimeMs: 4500,
  /** Default fan acceleration in pixels per second squared. */
  fanForce: 540,
  /** How often the enemy re-aims every cannon. */
  aiRetargetMs: 1600,
  /**
   * Each point of capture progress already inflicted by the enemy counts as
   * this many pixels closer, so the AI finishes weak cannons.
   */
  aiFinishBias: 80,
  /** Keep the current target unless a new one is clearly better, in pixels. */
  aiRetargetSlack: 200,
} as const
