import { PVP_RULES } from '../config/pvpRules'
import type { Side } from '../types'
import type { MatchResult, RoomInfo } from './online'
import type { SnapExtra } from './snapshot'

/**
 * Online match texts for the battle screen (pure functions, so tests can
 * check them). Sides are indexed 0 gold, 1 pink as on the server; "me" is
 * this player's side index, or null when watching.
 */

export const sideIndex = (side: Side): 0 | 1 => (side === 'enemy' ? 1 : 0)

/** mm:ss, rounded up (a clock showing 0:00 means it is over). */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The player on a side (by the room's seats). */
export function nameOnSide(info: RoomInfo | null, side: 0 | 1): string {
  const fallback = `Player ${side + 1}`
  if (!info) return fallback
  const seat = sideIndex(info.sides[0]) === side ? 0 : 1
  return info.seats[seat]?.name || fallback
}

/** Longest name on a cannon's name tag (longer ones end in "…"). */
export const TAG_MAX = 12

/** Shorten a name for a tag. */
export function tagText(name: string): string {
  const chars = Array.from(name.trim())
  return chars.length > TAG_MAX ? chars.slice(0, TAG_MAX - 1).join('').trimEnd() + '…' : chars.join('')
}

/**
 * The two names for the cannons' tags, gold side first: each player's room
 * name, shortened; if both read the same, a seat number tells them apart.
 */
export function tagNames(gold: string, pink: string): [string, string] {
  const a = tagText(gold || 'Player 1')
  const b = tagText(pink || 'Player 2')
  if (a.toLowerCase() !== b.toLowerCase()) return [a, b]
  return [tagText(a.slice(0, TAG_MAX - 2)) + ' 1', tagText(b.slice(0, TAG_MAX - 2)) + ' 2']
}

/** Can this player pause / resume now? (The server decides; this only avoids sending what it would refuse.) */
export function pauseCheck(t: 'pause' | 'resume', x: SnapExtra | undefined, me: 0 | 1 | null, paused: boolean, info: RoomInfo | null): { ok: boolean; why?: string } {
  if (me === null) return { ok: false, why: 'You are watching this match.' }
  if (t === 'pause') {
    if (paused) return { ok: false }
    if (x && x.pl[me] <= 0) return { ok: false, why: 'No pauses left this match.' }
    return { ok: true }
  }
  if (!paused) return { ok: false }
  if (x && x.pz !== me) return { ok: false, why: `Only ${nameOnSide(info, (1 - me) as 0 | 1)} can resume early (it resumes by itself in ${Math.ceil(x.pzl / 1000)} s).` }
  return { ok: true }
}

/** The paused banner. */
export function pauseLabel(x: SnapExtra | undefined, me: 0 | 1 | null, info: RoomInfo | null): string {
  if (!x || x.pz < 0) return 'Paused'
  const left = Math.ceil(x.pzl / 1000)
  if (me === null) return `Paused by ${nameOnSide(info, x.pz as 0 | 1)}  ·  resumes in ${left} s`
  const other = nameOnSide(info, (1 - me) as 0 | 1)
  if (x.pz === me) return `You paused  ·  ${left} s left  ·  your orders stay hidden from ${other} until you resume (Space)`
  return `${other} paused  ·  resumes in ${left} s  ·  queue orders now: ${other} won't see them until then`
}

/** The HUD's small line: pauses left (or "pauses off", the host's setting) and ping. */
export function netLine(x: SnapExtra | undefined, me: 0 | 1 | null, rtt: number | null, pausesOff = false): string {
  const parts: string[] = []
  if (pausesOff) parts.push('pauses off')
  else if (x && me !== null) parts.push(`${x.pl[me]} pause${x.pl[me] === 1 ? '' : 's'} left`)
  if (me === null) parts.push('watching')
  parts.push(rtt === null ? '… ms' : `${rtt} ms`)
  return parts.join('  ·  ')
}

/** What the other player is up to, when it matters (dropped, AI). `dropAt`: when we saw them drop. */
export function opponentLine(x: SnapExtra | undefined, me: 0 | 1 | null, info: RoomInfo | null, dropAt: number | null, now: number): string | null {
  if (!x || me === null) return null
  const them = (1 - me) as 0 | 1
  const name = nameOnSide(info, them)
  if (x.ai[them]) return `${name} left: a Hard AI is playing their side.`
  if (!x.on[them]) {
    const left = dropAt === null ? PVP_RULES.graceMs : PVP_RULES.graceMs - (now - dropAt)
    return `${name} lost their connection: a Hard AI takes over in ${Math.max(0, Math.ceil(left / 1000))} s unless they come back.`
  }
  return null
}

export type ViewOutcome = 'win' | 'lose' | 'draw'

/**
 * The match result the room keeps (seat that won), as this view's outcome.
 * `viewSide` is the side drawn as "player" here: yours, or gold for someone
 * watching. The server keeps this result after the match; the final snapshot
 * can be missing (the connection dropped while the tab was hidden and came
 * back after the server had put the match away), so the end screen must not
 * depend on the snapshot alone.
 */
export function outcomeFromResult(result: MatchResult | null | undefined, sides: readonly [Side, Side] | undefined, viewSide: Side): ViewOutcome | null {
  if (!result) return null
  if (result.winner === null) return 'draw'
  const side = sides?.[result.winner]
  if (!side) return null
  return side === viewSide ? 'win' : 'lose'
}

/** Cannons per side at the end, from the room's result (seat order), in this view's terms. */
export function cannonsFromResult(result: MatchResult, sides: readonly [Side, Side], viewSide: Side): { mine: number; theirs: number } {
  const mineSeat = sides[0] === viewSide ? 0 : 1
  return { mine: result.cannons[mineSeat] ?? 0, theirs: result.cannons[1 - mineSeat] ?? 0 }
}

/** End screen texts. `outcome` is from this screen's view (watchers see gold's). */
export function endTexts(outcome: ViewOutcome, me: 0 | 1 | null, info: RoomInfo | null, why: SnapExtra['why'], cannons: { mine: number; theirs: number }): { headline: string; detail: string } {
  const gold = nameOnSide(info, 0)
  const pink = nameOnSide(info, 1)
  let headline: string
  if (me === null) headline = outcome === 'draw' ? 'Draw' : `${outcome === 'win' ? gold : pink} wins`
  else headline = outcome === 'win' ? 'You win' : outcome === 'lose' ? 'You lost' : 'Draw'
  const score = me === null ? `${gold} ${cannons.mine} – ${cannons.theirs} ${pink}` : `${cannons.mine} – ${cannons.theirs} cannons`
  let detail: string
  if (why === 'surrender' && outcome !== 'draw') {
    // The loser gave up. Names by seat side: gold is side 0.
    const winner = outcome === 'win' ? gold : pink
    const loser = outcome === 'win' ? pink : gold
    if (me === null) return { headline: `${winner} wins`, detail: `${loser} surrendered.` }
    const them = nameOnSide(info, (1 - me) as 0 | 1)
    return outcome === 'win' ? { headline: 'You win', detail: `${them} surrendered.` } : { headline: 'You surrendered', detail: `${them} wins this match.` }
  }
  if (why === 'time') detail = `Time's up: ${score}.`
  else if (why === 'empty') detail = `Everyone left: ${score}.`
  else if (me === null) detail = outcome === 'draw' ? 'Nobody holds a cannon.' : `${outcome === 'win' ? pink : gold} has no cannons left.`
  else detail = outcome === 'win' ? 'The other player has no cannons left.' : outcome === 'lose' ? 'You have no cannons left.' : 'Nobody holds a cannon.'
  return { headline, detail }
}

/** Rematch status under the end screen, for a seated player. */
export function rematchLine(info: RoomInfo | null): string {
  if (!info || info.you.seat === null) return ''
  const me = info.you.seat
  const them = (1 - me) as 0 | 1
  const other = info.seats[them]
  if (!other) return 'The other player left the room.'
  if (!other.connected) return `${other.name} is not connected.`
  if (info.rematch[me] && info.rematch[them]) return 'Starting…'
  if (info.rematch[me]) return `Waiting for ${other.name} to press Rematch…`
  if (info.rematch[them]) return `${other.name} wants a rematch!`
  return 'Rematch when you both press it (you swap sides).'
}
