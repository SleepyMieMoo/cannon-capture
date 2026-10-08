import { PVP_LIMITS } from '../config/pvpRules'
import { EXAMPLE_MAPS, SKIRMISH } from '../levels'
import { MAP_SIZES } from '../levels/board'
import { mirrored } from '../levels/mirrored'
import type { Order } from '../sim/orders'
import type { LevelDef, Side } from '../types'
import type { Snap } from './snapshot'
import { isSkin, type SideSkins, type SkinId } from '../config/skins'
import { isTeamColour, type SideColours, type TeamColourId } from '../config/teamColours'

/**
 * Online player vs player: the messages between the game and the server
 * (server/). The round itself uses the Phase 0 messages (start, snap, order,
 * ack); the lobby adds a few.
 */

/** Game to server. */
export type ClientMsg =
  /** First message on every connection; `token` is this tab's, so a reload gets the same seat back. */
  | { t: 'hello'; token: string; name: string; skin?: SkinId; colour?: TeamColourId }
  | { t: 'name'; name: string }
  /** Host: the map for the next match. */
  | { t: 'map'; id: string }
  /** Host, between matches: change the match settings (only the fields given). */
  | { t: 'settings'; countdown?: CountdownChoice; pauses?: boolean }
  /** Host, between matches: swap which seat plays the left side next match. */
  | { t: 'swap' }
  /** Give up the running match: the other seat wins (servers that list `surrender` in the room info). */
  | { t: 'surrender' }
  /** Host: start the match (both seats taken). */
  | { t: 'start' }
  /** After a match: ask for (or cancel) a rematch. It starts when both players ask. */
  | { t: 'rematch'; on: boolean }
  | { t: 'order'; seq: number; o: Order }
  /** Leave the room for good (a dropped connection only starts the grace time). */
  | { t: 'leave' }
  /** Keep-alive while a match runs (the plain {"t":"ping"} is answered without waking the room). */
  | { t: 'hb' }

/** Pre-round countdown choices, in seconds (0: "Chaotic rush", firing starts at once). */
export const COUNTDOWN_CHOICES = [0, 3, 5] as const
export type CountdownChoice = (typeof COUNTDOWN_CHOICES)[number]

/**
 * What the host can set in the room before a match. Every new room starts
 * with DEFAULT_SETTINGS; they carry over to rematches until the host changes
 * them between matches. The server is the authority. The 5-minute limit is
 * not a setting (yet).
 */
export interface RoomSettings {
  countdown: CountdownChoice
  /** Pauses allowed (PVP_RULES.pausesPerPlayer each). */
  pauses: boolean
}

export const DEFAULT_SETTINGS: Readonly<RoomSettings> = { countdown: 3, pauses: true }

export const isCountdownChoice = (v: unknown): v is CountdownChoice => (COUNTDOWN_CHOICES as readonly unknown[]).includes(v)

/** Settings from a message or stored state; anything missing or broken is the default (older servers send none). */
export function readSettings(v: unknown): RoomSettings {
  const s = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return {
    countdown: isCountdownChoice(s.countdown) ? s.countdown : DEFAULT_SETTINGS.countdown,
    pauses: typeof s.pauses === 'boolean' ? s.pauses : DEFAULT_SETTINGS.pauses,
  }
}

export interface SeatInfo {
  name: string
  connected: boolean
  /** An AI plays this seat for now. */
  ai: boolean
}

export interface MatchResult {
  /** Seat that won (null: draw). */
  winner: 0 | 1 | null
  why: 'wipe' | 'time' | 'empty' | 'surrender'
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
  /** The host's match settings (older servers leave them out: the defaults, not changeable). */
  settings?: RoomSettings
  /** The seat that plays the left side next match (older servers leave it out). */
  left?: 0 | 1
  /** The server takes `surrender` (older servers leave it out: the game shows no Surrender button). */
  surrender?: boolean
  /** Where the room runs: the region asked for, and the data centre it landed in (older servers leave it out). */
  server?: { region: ServerRegion; colo?: string }
}

/** Server to game. */
export type ServerMsg =
  | RoomInfo
  /**
   * `skins`: what each side wears, gold ('player') first, as the server
   * decided (every client and watcher shows the same). `colours`: the same
   * for team colours. Old servers leave them out. `pauses: false`: the host
   * turned pauses off for this match (left out when they're allowed).
   */
  | { t: 'start'; match: string; level: LevelDef; side: Side; stepMs: number; spectate?: boolean; skins?: SideSkins; colours?: SideColours; pauses?: boolean }
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
  // The obstacle examples (mirrored too).
  ...EXAMPLE_MAPS,
].filter((l) => (l.size ?? 'small') !== 'huge' && MAP_SIZES[l.size ?? 'small'])

export const pvpMap = (id: string): LevelDef | undefined => PVP_MAPS.find((l) => l.id === id)

/** The level as played: no AI settings, no hints. */
export function pvpLevel(map: LevelDef): LevelDef {
  const { hint: _h, par: _p, ai: _a, aims: _aims, ...rest } = map
  return { ...rest, kind: 'battle' as const }
}

// ------------------------------------------------------------------ where a room runs

/**
 * Cloudflare's location hints for a room (a Durable Object). A room is placed
 * once, when it is created, and stays there: near whoever creates it, unless
 * they pick a region (between two far-apart players, the Middle East keeps
 * both pings about equal). Centres are rough, for picking the nearest.
 */
/**
 * Cloudflare's location hints for a room. `pick: false`: Cloudflare runs those rooms somewhere
 * else (measured Oct 2026: Middle East in Vienna or Stockholm, South America in Atlanta, Africa
 * in Amsterdam), so the menu does not offer them; they still serve as the nearest region.
 */
export const SERVER_REGIONS = [
  { id: 'weur', label: 'Western Europe', lat: 50.5, lon: 4 },
  { id: 'eeur', label: 'Eastern Europe', lat: 52.2, lon: 21 },
  { id: 'me', label: 'Middle East', lat: 25.2, lon: 55.3, pick: false },
  { id: 'apac', label: 'Asia-Pacific', lat: 1.35, lon: 103.8 },
  { id: 'oc', label: 'Oceania', lat: -33.9, lon: 151.2 },
  { id: 'enam', label: 'North America (east)', lat: 39, lon: -77.5 },
  { id: 'wnam', label: 'North America (west)', lat: 37.3, lon: -121.9 },
  { id: 'sam', label: 'South America', lat: -23.5, lon: -46.6, pick: false },
  { id: 'afr', label: 'Africa', lat: -26.2, lon: 28, pick: false },
] as const

export type ServerRegion = (typeof SERVER_REGIONS)[number]['id']

export const isServerRegion = (v: unknown): v is ServerRegion => SERVER_REGIONS.some((r) => r.id === v)

export function regionLabel(id: ServerRegion): string {
  return SERVER_REGIONS.find((r) => r.id === id)?.label ?? id
}

/** Distance between two points on the globe (km). */
function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** The region nearest a place. */
export function nearestRegion(lat: number, lon: number): ServerRegion {
  let best: ServerRegion = 'apac'
  let bestKm = Infinity
  for (const r of SERVER_REGIONS) {
    const d = km(lat, lon, r.lat, r.lon)
    if (d < bestKm) {
      bestKm = d
      best = r.id
    }
  }
  return best
}

const BY_CONTINENT: Record<string, ServerRegion> = { AS: 'apac', OC: 'oc', EU: 'weur', NA: 'enam', SA: 'sam', AF: 'afr' }

/**
 * Where to put a new room: the region asked for, else the one nearest the
 * creator (Cloudflare tells the server roughly where a request comes from),
 * else by continent, else Asia-Pacific.
 */
export function pickRegion(asked: unknown, where: { latitude?: unknown; longitude?: unknown; continent?: unknown } | undefined): ServerRegion {
  if (isServerRegion(asked)) return asked
  const lat = Number(where?.latitude)
  const lon = Number(where?.longitude)
  if (where?.latitude !== undefined && where?.longitude !== undefined && Number.isFinite(lat) && Number.isFinite(lon)) return nearestRegion(lat, lon)
  return BY_CONTINENT[String(where?.continent ?? '')] ?? 'apac'
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
      return typeof m.token === 'string' && m.token.length >= 8 && m.token.length <= 64 ? { t: 'hello', token: m.token, name: cleanName(m.name, ''), ...(isSkin(m.skin) ? { skin: m.skin } : {}), ...(isTeamColour(m.colour) ? { colour: m.colour } : {}) }
        : null
    case 'name':
      return { t: 'name', name: cleanName(m.name, '') }
    case 'settings': {
      const out: Extract<ClientMsg, { t: 'settings' }> = { t: 'settings' }
      if (m.countdown !== undefined) {
        if (!isCountdownChoice(m.countdown)) return null
        out.countdown = m.countdown
      }
      if (m.pauses !== undefined) {
        if (typeof m.pauses !== 'boolean') return null
        out.pauses = m.pauses
      }
      return out
    }
    case 'swap':
      return { t: 'swap' }
    case 'surrender':
      return { t: 'surrender' }
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
