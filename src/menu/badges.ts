import { AI_LEVELS, type AiLevel } from '../types'

/**
 * Win badges: per map (by its id: built-in maps and your own), which AI
 * levels you have beaten. Earned by winning a vs-AI round (not online, not a
 * surrender). Saved on this device; Profile → Reset forgets them.
 */
export const BADGES_KEY = 'cannon-capture:badges:v1'

/** Map id → the levels beaten on it, in AI_LEVELS order. */
export type Badges = Record<string, AiLevel[]>

type Store = Pick<Storage, 'getItem' | 'setItem'>

/** Caps against a corrupted or hand-edited store. */
const MAX_MAPS = 500
const MAX_ID = 64

function deviceStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

const isLevel = (v: unknown): v is AiLevel => (AI_LEVELS as readonly unknown[]).includes(v)

/** Only real map ids and known levels, each once, in AI_LEVELS order. */
export function cleanBadges(raw: unknown): Badges {
  const out: Badges = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [id, levels] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_MAPS) break
    if (!id || id.length > MAX_ID || !Array.isArray(levels)) continue
    const got = AI_LEVELS.filter((d) => levels.some((l) => l === d && isLevel(l)))
    if (got.length) out[id] = got
  }
  return out
}

export function loadBadges(store: Store | null = deviceStore()): Badges {
  try {
    const raw = store?.getItem(BADGES_KEY)
    return raw ? cleanBadges(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

export const hasBadge = (b: Badges, mapId: string, level: AiLevel): boolean => !!b[mapId]?.includes(level)

/** The badges with this one added (unchanged if you already had it). */
export function withBadge(b: Badges, mapId: string, level: AiLevel): Badges {
  if (hasBadge(b, mapId, level) || !mapId || mapId.length > MAX_ID) return b
  const got = new Set([...(b[mapId] ?? []), level])
  return { ...b, [mapId]: AI_LEVELS.filter((d) => got.has(d)) }
}

/** A vs-AI win: save the badge. True when it is new (the result panel celebrates). */
export function earnBadge(mapId: string, level: AiLevel, store: Store | null = deviceStore()): boolean {
  const before = loadBadges(store)
  const after = withBadge(before, mapId, level)
  if (after === before) return false
  try {
    store?.setItem(BADGES_KEY, JSON.stringify(after))
  } catch {
    // Storage full or blocked: still new this time, just not remembered.
  }
  return true
}

/** How many badges: all of them, or only on these maps (the ones Play vs AI lists now). */
export function badgeCount(b: Badges, mapIds?: readonly string[]): number {
  const ids = mapIds ?? Object.keys(b)
  return ids.reduce((n, id) => n + (b[id]?.length ?? 0), 0)
}
