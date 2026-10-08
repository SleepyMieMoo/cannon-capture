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
  /**
   * Pre-round countdown (3-2-1-Go), in ms. Nothing fires during it, but
   * barrels turn, orders work and the AI plans and aims, so the first shots
   * are lined up at Go. Round clocks (the PvP time limit) start at Go.
   */
  countdownMs: 3000,
  /** The title screen's AI-vs-AI demo: a shorter, silent planning grace (no overlay). */
  demoCountdownMs: 1500,
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
    /** Doesn't fire (damage 0): it holds up a barrier instead (see `shield`). */
    shield: { speedMul: 1, lifetimeMul: 1, turnMul: 3, fireMs: null, damage: 0, spreadDeg: 0 },
  },
  /**
   * The shield tower's barrier: an arc `arcDeg` wide, `reach` px from the
   * cannon's centre, facing where its barrel points. It absorbs shots from
   * the other sides (no bounce); your own shots pass through. Each shot
   * takes its damage off `hp` (6 = 6 normal shots, 3 sniper shots, 20 machine
   * gun bullets). At 0 it breaks and stays down for downMs, then comes back
   * with returnHp. It regrows regenPerSec once it hasn't been hit for
   * regenDelayMs (and right away after coming back). `thickness`: how thick
   * it is for collisions (px). Neutral cannons are unmanned: no barrier.
   */
  shield: { reach: 50, arcDeg: 110, thickness: 8, hp: 6, downMs: 5000, returnHp: 2, regenDelayMs: 2000, regenPerSec: 1 },
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
   * How the AI uses shields to defend. A cannon of its own that is being
   * captured (see aiLevels.shieldAt), took at least minHits shots in the last
   * windowMs from at least aiLevels.shieldShooters different foes (or has
   * nothing it could shoot at all), all from directions one barrier can
   * cover and with no lane for them round it, and would lose the duel (it
   * can't capture its attacker in winMargin of the time the attacker needs to
   * capture it) swaps to Shield, facing the threat. A guard is a short
   * stand: it goes back to shooting once it is healed, nothing has hit it
   * for calmMs, or its barrier breaks (it regrows meanwhile). (Measured in
   * AI-vs-AI games: against a foe that banks round barriers, a shield rarely
   * beats just shooting back, so the AI keeps it for clear cases.) At
   * most maxShare of the team are shields at once (rounded down), so it
   * never turtles. refaceDeg: a guard turns to face the shots once they come
   * from this far off its facing. rerouteMs: least time between two
   * re-routes of one cannon around an enemy barrier. soonMs: a broken
   * enemy barrier coming back within this long already counts as in the way.
   * Impossible doesn't follow these rules blindly: it plays "shield up" and
   * "carry on" forward (see aiLookahead) and only raises the shield when that
   * comes out ahead by lookGain, weighing it at most every lookEveryMs per
   * cannon and looking lookMs ahead (a shield pays off, or doesn't, over a
   * longer stretch than a choice of target).
   */
  aiShield: { windowMs: 4000, minHits: 2, calmMs: 5000, maxShare: 0.34, winMargin: 0.8, refaceDeg: 15, rerouteMs: 1500, soonMs: 1500, lookEveryMs: 2000, lookMs: 6000, lookGain: 3 },
  /**
   * Difficulty is intelligence only: every level fires, turns, thinks and
   * swaps exactly like you. What differs:
   * - aimError: how far off its first shot at a new job is, in half-widths
   *   of the lane (the spread of a half-normal; under 1 lands, before the
   *   type's own spread). The aimError values give the first-shot hit
   *   rates 25% / 50% / 75% / 100% (measured, see tests/difficulty.test.ts).
   *   The AI just aims at an offset point; shots follow the same rules as
   *   yours. overshoot: share of errors past the target in the direction it
   *   was turning (the rest stop short).
   * - correct: after it sees a miss, the error is multiplied by this (it
   *   recalculates), so a target it keeps shooting gets hit more and more.
   * - adjustMs: how long that recalculation takes after it sees a miss. It
   *   keeps its old (wrong) aim meanwhile, so a shot already on its way, or
   *   fired before the barrel comes round, can miss too. Misses seen while
   *   it is still adjusting count as the same lesson.
   * - maxTricks: bank shots and fan curves it will use (each bounce or fan
   *   counts one; straight shots count 0).
   * - trickChance: the share of trick lanes (within maxTricks) it ever
   *   spots, fixed per cannon and target, so some bank shots it knows and
   *   others it never sees (1 = all of them). Straight shots are always seen.
   * - misjudge: up to this share of error in how quick it thinks each job
   *   is (fixed per cannon and target, so it doesn't make it twitchy).
   * - reactMs: how soon it responds to events (a friend under attack, a job
   *   finished or lost). commitMs / margin: see aiPlan.
   * - lookahead: try its best few jobs in a quick headless simulation
   *   first (see aiLookahead).
   * - shieldAt: capture progress on one of its cannons before it thinks of
   *   swapping it to Shield (see aiShield); shieldChance: how often it then
   *   actually does; shieldAim: 'shooter' faces the attacking cannon (the
   *   obvious, often wrong choice when shots bank in), 'shots' faces where
   *   the shots actually come from and keeps turning to follow them.
   *   shieldShooters: how many different attackers it takes (fewer is
   *   rasher; Impossible then checks the idea in its look-ahead).
   */
  aiLevels: {
    easy: { aimError: 3.6, overshoot: 0.6, correct: 0.45, adjustMs: 1000, maxTricks: 0, trickChance: 0, misjudge: 0.15, reactMs: 1200, commitMs: 5000, margin: 1.4, lookahead: false, shieldAt: 6, shieldChance: 0.35, shieldAim: 'shooter', shieldShooters: 2 },
    normal: { aimError: 1.8, overshoot: 0.6, correct: 0.45, adjustMs: 800, maxTricks: 1, trickChance: 0.35, misjudge: 0.07, reactMs: 600, commitMs: 4000, margin: 1.3, lookahead: false, shieldAt: 5, shieldChance: 0.75, shieldAim: 'shots', shieldShooters: 3 },
    hard: { aimError: 1.1, overshoot: 0.6, correct: 0.45, adjustMs: 800, maxTricks: 99, trickChance: 1, misjudge: 0, reactMs: 250, commitMs: 4000, margin: 1.3, lookahead: false, shieldAt: 4, shieldChance: 1, shieldAim: 'shots', shieldShooters: 3 },
    impossible: { aimError: 0, overshoot: 0.6, correct: 0, adjustMs: 0, maxTricks: 99, trickChance: 1, misjudge: 0, reactMs: 250, commitMs: 4000, margin: 1.3, lookahead: true, shieldAt: 4, shieldChance: 1, shieldAim: 'shots', shieldShooters: 2 },
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
