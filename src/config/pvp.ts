/**
 * Player vs player settings. Phase 0 (?pvpdev): a test mode between two tabs
 * of one browser; the real thing needs a server (see the PvP plan).
 *
 * URL switches with ?pvpdev:
 *   ?lag=150   fake network delay in ms (and ?jitter=50 on top), to try it as if over the internet
 */
const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search)
const num = (key: string) => Math.max(0, Math.min(2000, Number(params.get(key)) || 0))

export const PVP = {
  /** The test mode is on (?pvpdev). */
  dev: params.has('pvpdev'),
  /** The host sends a snapshot every this many sim steps (3 = 20 a second). */
  snapEvery: 3,
  /** The other player draws the round this far behind the newest snapshot, to blend smoothly between two. */
  interpDelayMs: 100,
  /** Each side says "still here" this often... */
  heartbeatMs: 1000,
  /** ...and counts the other as gone after this long without a word. */
  timeoutMs: 4000,
  /**
   * Events the picture has passed by more than this are not replayed: after a
   * hidden tab the picture jumps to now, and replaying everything missed would
   * be one burst of sounds and sparks (the snapshot already shows the result).
   */
  staleEventMs: 1000,
  /** Most events kept waiting for the picture (a hidden tab keeps receiving them). */
  maxQueuedEvents: 600,
  lagMs: num('lag'),
  jitterMs: num('jitter'),
}
