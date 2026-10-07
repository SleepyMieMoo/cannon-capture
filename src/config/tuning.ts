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
  /**
   * The AI sends one helper to heal its own cannon once a foe has this much
   * capture progress on it (out of captureThreshold).
   */
  aiHealAtProgress: 4,
  /**
   * Tower types, one block each. Shots fly at shotSpeed * speedMul and live
   * shotLifetimeMs * lifetimeMul, so range = speedMul * lifetimeMul * the
   * normal range. fireMs: ms between shots (null = the side's normal rate,
   * fireIntervalMs or a level's ai.fireMs). damage: capture progress per hit,
   * and how much a hit heals on a friend (fractions are fine). turnMul: barrel
   * turn speed relative to turnSpeedDeg. spreadDeg: each shot leaves the
   * barrel up to this many degrees off its aim, at random (0 = exact).
   */
  towers: {
    normal: { speedMul: 1, lifetimeMul: 1, turnMul: 1, fireMs: null, damage: 1, spreadDeg: 1.25 },
    sniper: { speedMul: 2, lifetimeMul: 1, turnMul: 0.5, fireMs: 3000, damage: 2, spreadDeg: 0 },
    machinegun: { speedMul: 1, lifetimeMul: 0.5, turnMul: 2, fireMs: 200, damage: 0.3, spreadDeg: 7 },
  },
  /**
   * Swapping a cannon's type in play: it reloads for its new type's full
   * fire interval (at least this long) before it can shoot again.
   */
  swapLockMs: 1000,
  /**
   * The AI swaps a normal cannon to a machine gun when the foe it is shooting
   * is within this share of the machine gun's range (and its lane is wide
   * enough for the spread).
   */
  aiMachineGunReach: 0.75,
  /** Keep the current target unless a new one is clearly better, in pixels. */
  aiRetargetSlack: 200,
} as const
