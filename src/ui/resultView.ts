import type { AiLevel } from '../types'

/**
 * What the result panel says and offers, worked out without any DOM or Phaser
 * so every variant (vs the AI, surrendered, puzzles, campaign levels, online
 * players and watchers) can be checked in plain tests.
 */

/** What a result button does; the battle scene maps these to its own actions. */
export type ResultAction = 'next' | 'back' | 'restart' | 'rematch' | 'lobby' | 'leave'

export interface ResultButton {
  action: ResultAction
  label: string
  primary: boolean
  disabled?: boolean
}

/** One fact in the result's brag row ("Map: Warp Works"). */
export interface BragStat {
  key: 'opponent' | 'map' | 'time'
  label: string
  value: string
}

/** The match time as m:ss (whole seconds, rounded down). */
export function fmtMatchTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export interface BragInput {
  /** Who it was against: a bot ("Hard AI"), a player's name, "A vs B" for watchers; null: nobody (a puzzle, the same-browser test). */
  opponent: string | null
  map: string
  ms: number
}

/** The brag row: opponent (when there is one), map and time, in that order. */
export function bragFor(i: BragInput): BragStat[] {
  const out: BragStat[] = []
  if (i.opponent) out.push({ key: 'opponent', label: 'Against', value: i.opponent })
  if (i.map) out.push({ key: 'map', label: 'Map', value: i.map })
  out.push({ key: 'time', label: 'Time', value: fmtMatchTime(i.ms) })
  return out
}

/** The AI you played, and what it says about the round. */
export interface ResultBot {
  level: AiLevel
  name: string
  line: string
}

export interface ResultView {
  /** Colours the panel's border: gold for a win, pink for a loss, grey for a draw. */
  tone: 'win' | 'lose' | 'draw'
  headline: string
  /** Campaign wins: stars earned out of 3. Null: no star row. */
  stars: number | null
  detail: string
  /** Online players: the rematch line (gold once the other player wants one). */
  extra?: { text: string; gold: boolean }
  /** The AI character's say on the outcome (vs an AI only). */
  bot?: ResultBot
  /** Who, where and how long: a neat row worth a screenshot (none: left out). */
  brag?: BragStat[]
  /** Always one or two, the primary first. */
  buttons: ResultButton[]
  /** The small line under the buttons: keyboard shortcuts, or a note for watchers. */
  keys: string
  /** That line only lists keys (hidden on touch screens, where there are none). */
  keysOnly: boolean
}

export interface OfflineResultInput {
  result: 'win' | 'lose'
  /** A campaign level or puzzle (stars, Next, progress). */
  campaign: boolean
  hasNext: boolean
  fromPuzzles: boolean
  /** Same-browser / LAN player vs player. */
  pvp: boolean
  isPuzzle: boolean
  surrendered: boolean
  endReason: string
  seconds: number
  aimsUsed: number
  /** The puzzle limits aims (its result counts aims, not seconds). */
  countsAims: boolean
  par?: number
  stars: number
  /** "Change map or difficulty", "Back to map", "Back to puzzles", "My maps"... */
  backLabel: string
  /** The brag row's facts (left out: no row). */
  brag?: BragInput
  /** The AI character and its line (left out: no AI on the other side). */
  bot?: ResultBot
}

export function offlineResult(i: OfflineResultInput): ResultView {
  const win = i.result === 'win'
  let headline = win ? 'All cannons captured' : 'No cannons left'
  if (i.pvp) headline = win ? 'You win' : 'You lost'
  if (i.campaign && win) headline = i.hasNext ? 'Level complete' : 'Campaign complete!'
  if (!win && i.isPuzzle) headline = 'Puzzle failed'
  if (i.surrendered) headline = 'You surrendered'

  let detail = i.endReason || (win ? 'The board is yours.' : '')
  if (i.pvp) detail = win ? 'The other player has no cannons left.' : 'You have no cannons left.'
  if (win && i.campaign) {
    detail = i.countsAims
      ? `${i.aimsUsed} aim${i.aimsUsed === 1 ? '' : 's'} used${i.par ? `  ·  3 stars at ${i.par}` : ''}`
      : `Won in ${i.seconds}s${i.par ? `  ·  3 stars under ${i.par}s` : ''}`
  }

  let buttons: ResultButton[]
  if (win && i.hasNext) {
    buttons = [
      { action: 'next', label: i.fromPuzzles ? 'Next puzzle' : 'Next level', primary: true },
      { action: 'back', label: i.backLabel, primary: false },
    ]
  } else if (i.campaign && win) {
    buttons = [
      { action: 'back', label: i.backLabel, primary: true },
      { action: 'restart', label: 'Play again', primary: false },
    ]
  } else if (i.campaign) {
    buttons = [
      { action: 'restart', label: 'Try again', primary: true },
      { action: 'back', label: i.backLabel, primary: false },
    ]
  } else {
    buttons = [
      { action: 'restart', label: 'Play again', primary: true },
      { action: 'back', label: i.backLabel, primary: false },
    ]
  }
  return {
    tone: win ? 'win' : 'lose',
    headline,
    stars: win && i.campaign ? i.stars : null,
    detail,
    ...(i.brag ? { brag: bragFor(i.brag) } : {}),
    ...(i.bot ? { bot: i.bot } : {}),
    buttons,
    keys: win && i.hasNext ? 'N for next  ·  R to replay' : 'R to restart',
    keysOnly: true,
  }
}

export interface OnlineResultInput {
  result: 'win' | 'lose' | 'draw'
  headline: string
  detail: string
  /** Null: watching (no seat). */
  player: { rematchLine: string; otherWants: boolean; iWant: boolean; otherHere: boolean } | null
  brag?: BragInput
}

export function onlineResult(i: OnlineResultInput): ResultView {
  const base = { tone: i.result, headline: i.headline, stars: null, detail: i.detail, ...(i.brag ? { brag: bragFor(i.brag) } : {}) }
  if (i.player) {
    const p = i.player
    return {
      ...base,
      extra: { text: p.rematchLine, gold: p.otherWants },
      buttons: [
        { action: 'rematch', label: p.iWant ? 'Cancel rematch' : 'Rematch', primary: !p.iWant, disabled: !p.otherHere },
        { action: 'lobby', label: 'Back to the room', primary: false },
      ],
      keys: 'R for rematch  ·  Esc for the menu  ·  sides swap every match',
      keysOnly: false,
    }
  }
  return {
    ...base,
    buttons: [
      { action: 'lobby', label: 'Back to the room', primary: true },
      { action: 'leave', label: 'Leave the room', primary: false },
    ],
    keys: 'You will watch the next match too',
    keysOnly: false,
  }
}
