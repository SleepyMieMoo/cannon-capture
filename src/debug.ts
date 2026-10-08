/**
 * URL switches for testing (not shown in the UI):
 *   ?level=<id>   jump straight into a level
 *   ?debug        expose the game as window.__cc
 *   ?speed=N      (with debug) run N simulation steps per frame
 *   ?bot          (with debug) let a bot play your side (?bot=mirror: spread fire like the AI)
 *   ?countdown=MS (with debug) the pre-round countdown length (0: none)
 */
const params = new URLSearchParams(window.location.search)

export const DEBUG = {
  enabled: params.has('debug'),
  level: params.get('level'),
  speed: params.has('debug') ? Math.max(1, Math.min(20, Number(params.get('speed')) || 1)) : 1,
  bot: params.has('debug') && params.has('bot'),
  botStyle: params.get('bot') === 'mirror' ? ('mirror' as const) : ('focus' as const),
  /** Countdown override in ms (null: TUNING.countdownMs). */
  countdown: params.has('debug') && params.has('countdown') ? Math.max(0, Number(params.get('countdown')) || 0) : null,
  /** Name tags on cannons: &tags=1 forces them on (even vs the AI, for screenshots), &tags=0 off; null: only when looks clash online. */
  tags: params.has('debug') && params.has('tags') ? params.get('tags') !== '0' : null,
  /** Side glow strength override (&glow=0.3; 0 turns it off), for comparing strengths. */
  glow: params.has('debug') && params.has('glow') ? Math.max(0, Math.min(1, Number(params.get('glow')) || 0)) : null,
}
