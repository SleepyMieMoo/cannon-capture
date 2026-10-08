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
  /** How often each enemy cannon re-thinks its plan (a map's ai.retargetMs overrides it). */
  aiRetargetMs: 1600,
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
   * How the AI (and the test bot) choose a tower type for a cannon's current
   * job (the foe it attacks or the friend it heals). Each type gets an
   * estimated time to finish that job: the swap reload, plus the damage
   * still needed divided by its expected damage rate on that lane (damage /
   * fire interval x the share of its spread that lands on the lane). It
   * swaps only when the best type beats the current one by `gain`, and at
   * most once per `cooldownMs` per cannon (unless the current type can't hit
   * the job at all). Keyed by the map's difficulty.
   */
  aiSwap: {
    cooldownMs: { easy: 6000, normal: 3500, hard: 2500 },
    gain: { easy: 1.4, normal: 1.15, hard: 1.08 },
  },
  /**
   * How the AI commits to a plan (see src/ai/AiController.ts). Each cannon
   * thinks on its own staggered tick (the map's ai.retargetMs: Easy 2.4 s,
   * Normal 1.8 s, Hard 1.3 s). A job (a foe to capture or a friend to heal,
   * plus the tower type for it) is kept until it is done, impossible, or,
   * after at least commitMs, another job looks `margin` times quicker.
   * It never changes its mind mid-turn unless the job fell through.
   * reactMs: how soon it responds to real events (a friend under attack,
   * a job finished or lost). crowdMs: the extra cost, per cannon already on
   * it, of piling onto the same target (not charged when the other side is
   * capturing it: then ganging up wins the race).
   */
  aiPlan: {
    commitMs: { easy: 5000, normal: 4000, hard: 4000 },
    margin: { easy: 1.4, normal: 1.3, hard: 1.3 },
    reactMs: { easy: 1200, normal: 600, hard: 250 },
    crowdMs: 3000,
  },
} as const
