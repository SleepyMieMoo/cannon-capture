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
  /** How often each AI cannon re-thinks its plan (every difficulty; staggered per cannon). */
  aiRetargetMs: 1600,
  /**
   * The AI sends one helper to heal its own cannon once a foe has this much
   * capture progress on it (out of captureThreshold).
   */
  aiHealAtProgress: 4,
  /**
   * Tower types, one block each. Shots fly at shotSpeed * speedMul and live
   * shotLifetimeMs * lifetimeMul, so range = speedMul * lifetimeMul * the
   * normal range. fireMs: ms between shots (null = fireIntervalMs). damage: capture progress per hit,
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
   * the job at all). The same for every difficulty.
   */
  aiSwap: { cooldownMs: 3000, gain: 1.15 },
  /**
   * How the AI commits to a plan (see src/ai/AiController.ts). Each cannon
   * thinks on its own staggered tick (aiRetargetMs, every difficulty). A job
   * (a foe to capture or a friend to heal, plus the tower type for it) is
   * kept until it is done, impossible, or, after at least commitMs, another
   * job looks `margin` times quicker (see aiLevels). It never changes its
   * mind mid-turn unless the job fell through. crowdMs: the extra cost, per
   * cannon already on it, of piling onto the same target (not charged when
   * the other side is capturing it: then ganging up wins the race).
   */
  aiPlan: { crowdMs: 3000 },
  /**
   * Difficulty is intelligence only: every level fires, turns, thinks and
   * swaps exactly like you. What differs:
   * - aimError: how far off its first shot at a new job is, in half-widths
   *   of the lane (the spread of a half-normal; under 1 lands, before the
   *   type's own spread). 1.9 gives about 50% first-shot hits, 1.0 about
   *   75% (measured, see tests/difficulty.test.ts), 0 is perfect. The AI just aims at an offset point; shots follow
   *   the same rules as yours. overshoot: share of errors past the target in
   *   the direction it was turning (the rest stop short).
   * - correct: after it sees a miss, the error is multiplied by this (it
   *   recalculates), so a target it keeps shooting gets hit more and more.
   * - maxTricks: bank shots and fan curves it will use (each bounce or fan
   *   counts one; straight shots count 0).
   * - misjudge: up to this share of error in how quick it thinks each job
   *   is (fixed per cannon and target, so it doesn't make it twitchy).
   * - reactMs: how soon it responds to events (a friend under attack, a job
   *   finished or lost). commitMs / margin: see aiPlan.
   * - lookahead: try its best few jobs in a quick headless simulation
   *   first (see aiLookahead).
   */
  aiLevels: {
    easy: { aimError: 1.9, overshoot: 0.6, correct: 0.45, maxTricks: 0, misjudge: 0.15, reactMs: 1200, commitMs: 5000, margin: 1.4, lookahead: false },
    normal: { aimError: 1.0, overshoot: 0.6, correct: 0.45, maxTricks: 1, misjudge: 0.07, reactMs: 600, commitMs: 4000, margin: 1.3, lookahead: false },
    hard: { aimError: 0, overshoot: 0.6, correct: 0, maxTricks: 99, misjudge: 0, reactMs: 250, commitMs: 4000, margin: 1.3, lookahead: false },
    impossible: { aimError: 0, overshoot: 0.6, correct: 0, maxTricks: 99, misjudge: 0, reactMs: 250, commitMs: 4000, margin: 1.3, lookahead: true },
  },
  /**
   * Impossible's look-ahead. When a cannon is free to pick a new job it
   * simulates its `candidates` best jobs (plus keeping its current one, and
   * trading jobs with a teammate) for horizonMs of game time in a copy of
   * the round, in steps of stepMs, and takes the best outcome. At most
   * frameSteps simulation steps and at most frameBudgetMs of this work per
   * frame (whichever comes first); the rest waits for the next frame. The
   * step cap keeps Impossible equally quick-thinking on fast and slow
   * computers; the time cap protects the frame rate on slow ones.
   * A new plan must beat keeping the current one by minGain (in capture
   * progress points over the horizon; holding a cannon is worth 12).
   */
  aiLookahead: { candidates: 3, horizonMs: 4000, stepMs: 33, frameSteps: 120, frameBudgetMs: 3, minGain: 1.5 },
} as const
