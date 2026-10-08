import { PVP_LIMITS } from '../config/pvpRules'
import { SKIRMISH } from '../levels'
import { MAP_SIZES } from '../levels/board'
import { mirrored } from '../levels/mirrored'
import type { Order } from '../sim/orders'
import type { LevelDef, Side } from '../types'
import type { Snap } from './snapshot'

/**
 * Online player vs player: the messages between the game and the server
 * (server/). The round itself uses the Phase 0 messages (start, snap, order,
 * ack); the lobby adds a few.
 */

/** Game to server. */
export type ClientMsg =
  /** First message on every connection; `token` is this tab's, so a reload gets the same seat back. */
  | { t: 'hello'; token: string; name: string }
  | { t: 'name'; name: string }
  /** Host: the map for the next match. */
  | { t: 'map'; id: string }
  /** Host: start the match (both seats taken). */
  | { t: 'start' }
  /** After a match: ask for (or cancel) a rematch. It starts when both players ask. */
  | { t: 'rematch'; on: boolean }
  | { t: 'order'; seq: number; o: Order }
  /** Leave the room for good (a dropped connection only starts the grace time). */
  | { t: 'leave' }
  /** Keep-alive while a match runs (the plain {"t":"ping"} is answered without waking the room). */
  | { t: 'hb' }

export interface SeatInfo {
  name: string
  connected: boolean
  /** An AI plays this seat for now. */
  ai: boolean
}

export interface MatchResult {
  /** Seat that won (null: draw). */
  winner: 0 | 1 | null
  why: 'wipe' | 'time' | 'empty'
  /** Cannons held per seat at the end. */
  cannons: [number, number]
}

export interface RoomInfo {
  t: 'room'
  code: string
  /** Your seat (null: watching), and whether you pick the map. */
  you: { seat: 0 | 1 | null; host: boolean }
  seats: [SeatInfo | null, SeatInfo | null]
  /** Which seat is the host. */
  host: 0 | 1 | null
  spectators: number
  map: string
  phase: 'lobby' | 'playing' | 'ended'
  /** Matches played in this room (the next one swaps sides). */
  match: number
  /** Side per seat in the current/last match. */
  sides: [Side, Side]
  rematch: [boolean, boolean]
  result: MatchResult | null
}

/** Server to game. */
export type ServerMsg =
  | RoomInfo
  | { t: 'start'; match: string; level: LevelDef; side: Side; stepMs: number; spectate?: boolean }
  | { t: 'snap'; match: string; s: Snap }
  | { t: 'ack'; seq: number; ok: boolean }
  | { t: 'error'; code: 'noroom' | 'bad' | 'rate' | 'notallowed' | 'full' | 'closed'; msg: string }
  | { t: 'pong' }

// ------------------------------------------------------------------ maps

/** Fair maps only: Skirmish and boards mirrored left/right (no Huge). */
function fair(seed: number, id: string, name: string): LevelDef {
  return { ...mirrored(seed), id, name }
}

export const PVP_MAPS: LevelDef[] = [
  { ...SKIRMISH, kind: 'battle' as const },
  fair(3, 'mirror-wind', 'Wind Gap'),
  fair(8, 'mirror-walls', 'Four Walls'),
  fair(10, 'mirror-duel', 'Narrow Duel'),
].filter((l) => (l.size ?? 'small') !== 'huge' && MAP_SIZES[l.size ?? 'small'])

export const pvpMap = (id: string): LevelDef | undefined => PVP_MAPS.find((l) => l.id === id)

/** The level as played: no AI settings, no hints. */
export function pvpLevel(map: LevelDef): LevelDef {
  const { hint: _h, par: _p, ai: _a, aims: _aims, ...rest } = map
  return { ...rest, kind: 'battle' as const }
}

// ------------------------------------------------------------------ codes and names

export function isRoomCode(code: unknown): code is string {
  if (typeof code !== 'string' || code.length !== PVP_LIMITS.codeLength) return false
  for (const ch of code) if (!PVP_LIMITS.codeAlphabet.includes(ch)) return false
  return true
}

/** Tidy a code someone typed ("abcd ", "a-b-c-d"). */
export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, PVP_LIMITS.codeLength)
}

export function randomCode(rand: () => number = Math.random): string {
  let s = ''
  for (let i = 0; i < PVP_LIMITS.codeLength; i++) s += PVP_LIMITS.codeAlphabet[Math.floor(rand() * PVP_LIMITS.codeAlphabet.length)]
  return s
}

/** A safe display name: printable, trimmed, short. */
export function cleanName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, PVP_LIMITS.maxName)
  return s || fallback
}

/** Check a message from a client (the server's first line of defence): the right shape, or null. */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  switch (m.t) {
    case 'hello':
      return typeof m.token === 'string' && m.token.length >= 8 && m.token.length <= 64 ? { t: 'hello', token: m.token, name: cleanName(m.name, '') } : null
    case 'name':
      return { t: 'name', name: cleanName(m.name, '') }
    case 'map':
      return typeof m.id === 'string' && m.id.length <= 40 ? { t: 'map', id: m.id } : null
    case 'start':
    case 'leave':
    case 'hb':
      return { t: m.t }
    case 'rematch':
      return typeof m.on === 'boolean' ? { t: 'rematch', on: m.on } : null
    case 'order':
      // The order itself is checked by parseOrder.
      return Number.isFinite(m.seq) && m.o && typeof m.o === 'object' ? { t: 'order', seq: Number(m.seq), o: m.o as Order } : null
    default:
      return null
  }
}
