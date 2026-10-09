import LINES from '../data/botLines.json'
import { cssHex, lerpColor, shade } from '../config/theme'
import type { AiLevel } from '../types'

/**
 * The AI's characters, one per difficulty: a name and a small face drawn in
 * SVG (tinted by the bot's team colour, so it follows the colour presets).
 * What they say after a round lives in src/data/botLines.json.
 */
export interface Bot {
  name: string
  /** A few words on its personality (tooltips). */
  vibe: string
}

export const BOTS: Record<AiLevel, Bot> = {
  easy: { name: 'Dumpling', vibe: 'a soft, friendly blob who cheers for everyone' },
  normal: { name: 'Pip', vibe: 'a cheerful little robot who loves a rematch' },
  hard: { name: 'Rivet', vibe: 'a bolted-down competitor who plays to win' },
  impossible: { name: 'Vex', vibe: 'a sore loser and a smug winner' },
}

/** What happened, from your side: the lists in botLines.json. */
export type BotMoment = 'youWin' | 'youLose' | 'youSurrender'

export function botMoment(result: 'win' | 'lose', surrendered: boolean): BotMoment {
  if (result === 'win') return 'youWin'
  return surrendered ? 'youSurrender' : 'youLose'
}

/** Longest line that fits the bubble nicely. */
export const BOT_LINE_MAX = 70

export function botLines(level: AiLevel, moment: BotMoment): readonly string[] {
  const set = (LINES as unknown as Record<string, Record<string, string[]>>)[level]
  return set?.[moment] ?? []
}

/** A random line from `pool`, never `last` again (when there is any other). */
export function pickLine(pool: readonly string[], last: string | null, rnd: () => number = Math.random): string {
  if (!pool.length) return ''
  const options = pool.length > 1 && last !== null && pool.includes(last) ? pool.filter((l) => l !== last) : pool
  return options[Math.min(options.length - 1, Math.floor(rnd() * options.length))]
}

const LAST_KEY = 'cannon-capture:bot-lines:v1'
/** Last lines said this session (and on this device, when storage works). */
const said: Record<string, string> = {}

function loadSaid(): Record<string, string> {
  try {
    return { ...(JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') ?? {}), ...said }
  } catch {
    return said
  }
}

/** What `level` says now: random, but not the line it said last time for this moment. */
export function botLine(level: AiLevel, moment: BotMoment, rnd: () => number = Math.random): string {
  const key = `${level}:${moment}`
  const seen = loadSaid()
  const line = pickLine(botLines(level, moment), seen[key] ?? null, rnd)
  said[key] = line
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ ...seen, [key]: line }))
  } catch {
    // No storage (private mode, tests): this session still remembers.
  }
  return line
}

const INK = '#24160F'
const CREAM = '#FFF4E6'

/** The bot's face as an SVG string (64x64 view box), tinted by `colour` (its team colour). */
export function botAvatarSvg(level: AiLevel, colour: number, size = 64): string {
  const c = cssHex(colour)
  const dark = cssHex(shade(colour, 0.62))
  const light = cssHex(lerpColor(colour, 0xffffff, 0.45))
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true" class="bot-face" data-bot="${level}">`
  const outline = `stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"`
  let body = ''
  if (level === 'easy') {
    // Dumpling: a soft round blob with a sprout, happy closed eyes and rosy cheeks.
    body =
      `<path d="M32 10c2-4 7-5 9-2-3 1-6 3-8 6" fill="${light}" ${outline}/>` +
      `<path d="M10 40C10 23 21 13 32 13s22 10 22 27c0 12-10 16-22 16S10 52 10 40z" fill="${c}" ${outline}/>` +
      `<ellipse cx="32" cy="46" rx="13" ry="7" fill="${light}" opacity=".45"/>` +
      `<path d="M20 36q4.5-5 9 0M35 36q4.5-5 9 0" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>` +
      `<ellipse cx="19" cy="42" rx="4" ry="2.6" fill="#FF8F80" opacity=".6"/><ellipse cx="45" cy="42" rx="4" ry="2.6" fill="#FF8F80" opacity=".6"/>` +
      `<path d="M28.5 43q3.5 3.5 7 0" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`
  } else if (level === 'normal') {
    // Pip: a round little robot with an antenna, big bright eyes and a grin.
    body =
      `<path d="M32 17V9" stroke="${INK}" stroke-width="2.4"/><circle cx="32" cy="7.5" r="3.6" fill="${CREAM}" ${outline}/>` +
      `<rect x="7.5" y="31" width="6" height="11" rx="2.5" fill="${dark}" ${outline}/><rect x="50.5" y="31" width="6" height="11" rx="2.5" fill="${dark}" ${outline}/>` +
      `<circle cx="32" cy="37" r="20" fill="${c}" ${outline}/>` +
      `<circle cx="24.5" cy="34" r="5.6" fill="${CREAM}" stroke="${INK}" stroke-width="1.8"/><circle cx="39.5" cy="34" r="5.6" fill="${CREAM}" stroke="${INK}" stroke-width="1.8"/>` +
      `<circle cx="25.3" cy="34.8" r="2.8" fill="${INK}"/><circle cx="40.3" cy="34.8" r="2.8" fill="${INK}"/>` +
      `<circle cx="26.3" cy="33.6" r="1" fill="${CREAM}"/><circle cx="41.3" cy="33.6" r="1" fill="${CREAM}"/>` +
      `<path d="M24 43.5q8 8.5 16 0z" fill="${INK}"/><path d="M28 47q4 2.4 8 0" fill="none" stroke="#FF8F80" stroke-width="2" stroke-linecap="round"/>`
  } else if (level === 'hard') {
    // Rivet: a square, bolted head with a visor, steady eyes, set brows and a smirk.
    body =
      `<rect x="11" y="13" width="42" height="42" rx="10" fill="${c}" ${outline}/>` +
      `<circle cx="16.5" cy="18.5" r="2" fill="${dark}"/><circle cx="47.5" cy="18.5" r="2" fill="${dark}"/><circle cx="16.5" cy="49.5" r="2" fill="${dark}"/><circle cx="47.5" cy="49.5" r="2" fill="${dark}"/>` +
      `<rect x="16" y="28" width="32" height="11" rx="5.5" fill="${INK}"/>` +
      `<path d="M21 32.5l8 1.4v2.4l-8-.6zM43 32.5l-8 1.4v2.4l8-.6z" fill="${CREAM}"/>` +
      `<path d="M18.5 25.5l11 1.6M45.5 25.5l-11 1.6" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
      `<path d="M25 46.5q8 3 15-2.5" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`
  } else {
    // Vex: a spiky crown of a head, sharp brows, narrow glowing eyes and a smug fanged grin.
    body =
      `<path d="M32 6l7 10 12-4-2 14 5 16-12 13H22L10 42l5-16-2-14 12 4z" fill="${c}" ${outline}/>` +
      `<path d="M22 55h20l6-7-4 1H20l-4-1z" fill="${dark}" opacity=".55"/>` +
      `<path d="M15 26l15 7M49 26l-15 7" stroke="${INK}" stroke-width="3.8" stroke-linecap="round"/>` +
      `<path d="M18 32.5l11.5 4.5-10.5 1.5zM46 32.5l-11.5 4.5 10.5 1.5z" fill="#FFE27A" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>` +
      `<path d="M21 44q11 9 23-3" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>` +
      `<path d="M26.5 46.6l2.2 3.6 1.8-2.8zM35.6 47.6l2 3.4 1.9-3.6z" fill="${CREAM}" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/>`
  }
  return `${open}${body}</svg>`
}
