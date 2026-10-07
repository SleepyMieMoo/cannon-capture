/**
 * Gameplay knobs. Change these to retune the prototype without hunting
 * through scenes.
 */
export const TUNING = {
  /** Milliseconds between shots from the same cannon. */
  fireIntervalMs: 1000,
  /** Stagger the opening volley so cannons do not fire on the same tick. */
  fireStaggerMs: 140,
  /** Delay before a newly captured cannon starts shooting. */
  captureKickoffMs: 280,
  /** Hits from one side required to flip a cannon. */
  captureThreshold: 5,
  /** Pixels per second. */
  shotSpeed: 340,
  /** Fan boost is capped at shotSpeed * shotSpeedCap. */
  shotSpeedCap: 1.75,
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
  fanForce: 640,
  /** How often the enemy re-aims every cannon. */
  aiRetargetMs: 1600,
  /**
   * Each point of capture progress already inflicted by the enemy counts as
   * this many pixels closer, so the AI finishes weak cannons.
   */
  aiFinishBias: 80,
  /** Keep the current target unless a new one is clearly better. */
  aiRetargetSlack: 48,
} as const
