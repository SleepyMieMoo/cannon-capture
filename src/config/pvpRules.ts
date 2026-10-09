import type { AiLevel } from '../types'
import { TUNING } from './tuning'

/**
 * Online player vs player: the rules and limits, in one place. The server
 * (server/) and the game both read these.
 */
export const PVP_RULES = {
  /**
   * Pauses: how many each player gets and how long one lasts are the host's
   * room settings (net/online.ts RoomSettings). With no time limit a pause
   * still ends by itself after this long, so nobody can hold a match forever.
   */
  pauseSafetyMs: 5 * 60_000,
  /**
   * Pause anti-spam (even with unlimited pauses): this many pauses within
   * windowMs and that player can't pause again for lockoutMs, counted from
   * when that last pause ends. Both are real (wall-clock) time on the
   * server, not the match clock, which stands still while paused.
   */
  pauseSpam: { count: 10, windowMs: 30_000, lockoutMs: 60_000 },
  /** Countdown before each match (the round clock starts at Go; no pausing during it). */
  countdownMs: TUNING.countdownMs,
  /** Round time (it stops while paused); then whoever holds the most cannons wins (equal = draw). */
  matchMs: 5 * 60_000,
  /** A player who drops has this long to come back (same tab) before an AI takes their seat. */
  graceMs: 45_000,
  /** The AI that takes over a seat. */
  takeoverAi: 'hard' as AiLevel,
  /** A rematch starts only when both players ask; sides swap every match. */
  swapSidesEachMatch: true,
  /**
   * Everyone sees their own side as 'player' (the board is flipped for the
   * pink seat) in their own team colour, with the light "yours" rings; the
   * colours follow the person, so both screens and watchers agree on who
   * wears what (config/teamColours.ts).
   */
  seeSelfAsYours: true,
  /** Past two players, everyone watches (up to this many). */
  maxSpectators: 30,
  /** The server steps the round at 60 Hz and sends a snapshot every this many steps (3 = 20 a second). */
  snapEvery: 3,
  stepMs: 1000 / 60,
} as const

/** Server limits (abuse and cost). */
export const PVP_LIMITS = {
  /** Longest message a client may send (characters). */
  maxMessage: 1024,
  /** Messages per second per connection (token bucket), with this burst. */
  ratePerSec: 15,
  rateBurst: 30,
  /** Close a connection that keeps flooding after this many dropped messages. */
  floodClose: 60,
  /** Longest player name. */
  maxName: 16,
  /** A room with nobody in it is deleted after this long. */
  emptyRoomMs: 2 * 60_000,
  /** A room where nothing has happened for this long is closed. */
  idleRoomMs: 30 * 60_000,
  /** Room codes: this many letters from this alphabet (no I or O). */
  codeLength: 4,
  codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
} as const
