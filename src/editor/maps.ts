import { isKind } from '../config/kinds'
import { TUNING } from '../config/tuning'
import { MAP_SIZE_IDS, boardFor } from '../levels/board'
import { inferDifficulty, isAiLevel, levelDifficulty } from '../ai/difficulty'
import type { AiLevel, CannonDef, FanDef, GlassDef, LevelDef, MapSize, PillarDef, PortalDef, PortalEnd, Side, WallDef } from '../types'
import { PORTAL } from '../config/obstacles'

/**
 * Custom maps: validation, share codes and localStorage. A custom map is a
 * plain LevelDef, so a shared map can be pasted into the campaign as-is.
 */

export const LIMITS = { cannons: 60, walls: 160, fans: 40, pillars: 80, glass: 60, name: 40 }
export const SHARE_PREFIX = 'CC1:'
export const STORE_KEY = 'cannon-capture:maps:v1'
export const DRAFT_KEY = 'cannon-capture:editor-draft:v1'

export type Difficulty = AiLevel
/** The editor's Difficulty menu. Difficulty is how smart pink plays, never how fast. */
export const DIFFICULTY: Record<Difficulty, { label: string; blurb: string }> = {
  easy: { label: 'Easy', blurb: 'Lands about 1 in 4 first shots, slowly corrects; straight shots only; slow to react' },
  normal: { label: 'Normal', blurb: 'Lands about half its first shots, then corrects; the odd simple bank shot' },
  hard: { label: 'Hard', blurb: 'Lands about 3 in 4 first shots, takes a moment to correct; every angle; quick reactions' },
  impossible: { label: 'Impossible', blurb: 'Perfect aim, and tries out its best plans a few seconds ahead before choosing' },
}

export function difficultyOf(level: LevelDef): Difficulty {
  return levelDifficulty(level)
}

export function withDifficulty(level: LevelDef, d: Difficulty): LevelDef {
  return { ...level, ai: { difficulty: d } }
}

export function blankMap(size: MapSize = 'small'): LevelDef {
  const b = boardFor(size)
  const midY = Math.round(b.y + b.h / 2)
  return withDifficulty(
    {
      id: newMapId(),
      name: 'My map',
      kind: 'battle',
      size,
      cannons: [
        { id: 'p1', name: 'P1', x: b.x + 120, y: midY, side: 'player' },
        { id: 'e1', name: 'E1', x: b.x + b.w - 120, y: midY, side: 'enemy' },
      ],
      walls: [],
      fans: [],
    },
    'normal',
  )
}

export function newMapId(): string {
  return `custom-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

// ------------------------------------------------------------------ sanitize

const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.min(max, Math.max(min, n))
}
const str = (v: unknown, fallback: string, max: number): string =>
  (typeof v === 'string' && v.trim() ? v.trim() : fallback).slice(0, max)

/**
 * Turns untrusted JSON (a share code, an uploaded file, old storage) into a
 * safe LevelDef: known fields only, numbers clamped to the board, sane counts.
 * Throws an Error with a readable message if it isn't a map at all.
 */
export function sanitizeLevel(raw: unknown): LevelDef {
  if (!raw || typeof raw !== 'object') throw new Error('That is not a Cannon Capture map.')
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.cannons)) throw new Error('That map has no cannons list.')
  const size: MapSize = MAP_SIZE_IDS.includes(r.size as MapSize) ? (r.size as MapSize) : 'small'
  const b = boardFor(size)
  const pad = TUNING.cannonRadius + 4
  const inX = (v: unknown): number => Math.round(num(v, b.x + b.w / 2, b.x + pad, b.x + b.w - pad))
  const inY = (v: unknown): number => Math.round(num(v, b.y + b.h / 2, b.y + pad, b.y + b.h - pad))

  const ids = new Set<string>()
  const cannons: CannonDef[] = []
  for (const c of r.cannons.slice(0, LIMITS.cannons)) {
    if (!c || typeof c !== 'object') continue
    const o = c as Record<string, unknown>
    const side: Side = o.side === 'player' || o.side === 'enemy' || o.side === 'neutral' ? o.side : 'neutral'
    let id = str(o.id, '', 24).replace(/[^\w-]/g, '')
    if (!id || ids.has(id)) id = nextCannonId(side, ids)
    ids.add(id)
    const def: CannonDef = { id, name: str(o.name, id.toUpperCase(), 16), x: inX(o.x), y: inY(o.y), side }
    // Tower type (added later): missing or unknown means normal, so old maps and CC1 codes still load.
    // Any old sniper delay (2 s / 3 s) is dropped: there is one sniper now.
    if (isKind(o.kind) && o.kind !== 'normal') def.kind = o.kind
    if (typeof o.aimAt === 'string') def.aimAt = o.aimAt
    else if (o.aimPoint && typeof o.aimPoint === 'object') {
      const p = o.aimPoint as Record<string, unknown>
      def.aimPoint = { x: Math.round(num(p.x, def.x, b.x, b.x + b.w)), y: Math.round(num(p.y, def.y, b.y, b.y + b.h)) }
    }
    cannons.push(def)
  }
  for (const c of cannons) if (c.aimAt && (!ids.has(c.aimAt) || c.aimAt === c.id)) delete c.aimAt

  const walls: WallDef[] = []
  for (const w of Array.isArray(r.walls) ? r.walls.slice(0, LIMITS.walls) : []) {
    if (!w || typeof w !== 'object') continue
    const o = w as Record<string, unknown>
    const ww = Math.round(num(o.w, 26, 8, b.w))
    const hh = Math.round(num(o.h, 26, 8, b.h))
    const wall: WallDef = {
      x: Math.round(num(o.x, b.x, b.x - ww / 2, b.x + b.w - ww / 2)),
      y: Math.round(num(o.y, b.y, b.y - hh / 2, b.y + b.h - hh / 2)),
      w: ww,
      h: hh,
    }
    // Wall type (added later): anything else is a plain wall, so old maps and codes load as before.
    if (o.kind === 'void') wall.kind = 'void'
    else if (o.kind === 'breakable') {
      wall.kind = 'breakable'
      const hp = Number(o.hp)
      if (Number.isFinite(hp)) wall.hp = Math.max(1, Math.min(TUNING.breakable.maxHp, Math.round(hp)))
    }
    walls.push(tidyWall(wall, num(o.angle, 0, -Math.PI * 4, Math.PI * 4)))
  }

  // Pillars and glass (added later): missing means none.
  const pillars: PillarDef[] = []
  for (const p of Array.isArray(r.pillars) ? r.pillars.slice(0, LIMITS.pillars) : []) {
    if (!p || typeof p !== 'object') continue
    const o = p as Record<string, unknown>
    const rr = Math.round(num(o.r, 28, 10, 120))
    // Ovals (added later): a half-height and a turn; a missing or equal half-height is a circle.
    const ry = o.ry === undefined ? rr : Math.round(num(o.ry, rr, 10, 120))
    const reach = Math.max(rr, ry)
    const pillar: PillarDef = {
      x: Math.round(num(o.x, b.x + b.w / 2, b.x + reach, b.x + b.w - reach)),
      y: Math.round(num(o.y, b.y + b.h / 2, b.y + reach, b.y + b.h - reach)),
      r: rr,
    }
    if (ry !== rr) {
      pillar.ry = ry
      const angle = num(o.angle, 0, -Math.PI * 4, Math.PI * 4)
      const a = Math.round((((angle % Math.PI) + Math.PI) % Math.PI) * 1e4) / 1e4
      if (a > 1e-3 && a < Math.PI - 1e-3) pillar.angle = a
    }
    pillars.push(pillar)
  }
  const glass: GlassDef[] = []
  for (const g of Array.isArray(r.glass) ? r.glass.slice(0, LIMITS.glass) : []) {
    if (!g || typeof g !== 'object') continue
    const o = g as Record<string, unknown>
    const at = (v: unknown, lo: number, size: number): number => Math.round(num(v, lo + size / 2, lo, lo + size))
    const pane: GlassDef = { x: at(o.x, b.x, b.w), y: at(o.y, b.y, b.h), x2: at(o.x2, b.x, b.w), y2: at(o.y2, b.y, b.h) }
    if (Math.hypot(pane.x2 - pane.x, pane.y2 - pane.y) < 20) continue
    if (o.flip === true) pane.flip = true
    glass.push(pane)
  }

  // Portal pairs (added later): both mouths on the board, a little apart; at most PORTAL.maxPairs.
  const portals: PortalDef[] = []
  for (const p of Array.isArray(r.portals) ? r.portals.slice(0, 12) : []) {
    if (portals.length >= PORTAL.maxPairs) break
    if (!p || typeof p !== 'object') continue
    const o = p as Record<string, unknown>
    const end = (v: unknown): PortalEnd | null => {
      if (!v || typeof v !== 'object') return null
      const e = v as Record<string, unknown>
      const r0 = PORTAL.radius
      return { x: Math.round(num(e.x, b.x + b.w / 2, b.x + r0, b.x + b.w - r0)), y: Math.round(num(e.y, b.y + b.h / 2, b.y + r0, b.y + b.h - r0)), angle: tidyAngle(num(e.angle, 0, -Math.PI * 4, Math.PI * 4)) }
    }
    const a = end(o.a)
    const z = end(o.b)
    if (!a || !z || Math.hypot(a.x - z.x, a.y - z.y) < PORTAL.radius * 2) continue
    portals.push({ a, b: z })
  }

  const fans: FanDef[] = []
  for (const f of Array.isArray(r.fans) ? r.fans.slice(0, LIMITS.fans) : []) {
    if (!f || typeof f !== 'object') continue
    const o = f as Record<string, unknown>
    fans.push({
      x: inX(o.x),
      y: inY(o.y),
      radius: Math.round(num(o.radius, 140, 40, 400)),
      angle: num(o.angle, 0, -Math.PI * 2, Math.PI * 2),
      force: Math.round(num(o.force, TUNING.fanForce, 50, 1500)),
    })
  }

  const level: LevelDef = {
    id: str(r.id, newMapId(), 48).replace(/[^\w-]/g, '') || newMapId(),
    name: str(r.name, 'Shared map', LIMITS.name),
    kind: r.kind === 'puzzle' ? 'puzzle' : 'battle',
    size,
    cannons,
    walls,
    fans,
  }
  if (pillars.length) level.pillars = pillars
  if (glass.length) level.glass = glass
  if (portals.length) level.portals = portals
  if (typeof r.hint === 'string' && r.hint.trim()) level.hint = r.hint.trim().slice(0, 160)
  if (level.kind === 'puzzle' && r.aims !== undefined && r.aims !== null) level.aims = Math.round(num(r.aims, 3, 1, 99))
  if (typeof r.par === 'number') level.par = Math.round(num(r.par, 0, 1, 999))
  if (level.kind === 'battle' || r.ai) {
    // Older maps stored a fire rate instead of a difficulty: read it once, keep only the difficulty.
    const ai = r.ai && typeof r.ai === 'object' ? (r.ai as Record<string, unknown>) : {}
    const fireMs = typeof ai.fireMs === 'number' && Number.isFinite(ai.fireMs) ? ai.fireMs : undefined
    level.ai = { difficulty: isAiLevel(ai.difficulty) ? ai.difficulty : inferDifficulty(fireMs) }
  }
  return level
}

/** An angle in (-pi, pi], rounded (portal mouths: a full turn matters, unlike a wall's). */
export function tidyAngle(angle: number): number {
  let a = Math.atan2(Math.sin(angle), Math.cos(angle))
  if (a <= -Math.PI + 1e-6) a = Math.PI
  return Math.round(a * 1e4) / 1e4
}

/**
 * A rectangle looks the same after a half turn, so angles are kept in [0, pi).
 * Quarter turns become plain axis-aligned boxes, so exported walls stay tidy.
 */
export function tidyWall(wall: WallDef, angle: number): WallDef {
  let a = angle % Math.PI
  if (a < 0) a += Math.PI
  const eps = 1e-3
  const { x, y, w, h } = wall
  const kind = { ...(wall.kind ? { kind: wall.kind } : {}), ...(wall.kind === 'breakable' && wall.hp !== undefined ? { hp: wall.hp } : {}) }
  if (a < eps || a > Math.PI - eps) return { x, y, w, h, ...kind }
  if (Math.abs(a - Math.PI / 2) < eps) {
    const cx = x + w / 2
    const cy = y + h / 2
    return { x: Math.round(cx - h / 2), y: Math.round(cy - w / 2), w: h, h: w, ...kind }
  }
  return { x, y, w, h, angle: Math.round(a * 1e4) / 1e4, ...kind }
}

/** The editor's view of a wall: w is always the length, rotation in `angle`. */
export function editorWall(wall: WallDef): WallDef {
  if (!wall.angle && wall.h > wall.w) {
    const cx = wall.x + wall.w / 2
    const cy = wall.y + wall.h / 2
    return { ...wall, x: cx - wall.h / 2, y: cy - wall.w / 2, w: wall.h, h: wall.w, angle: Math.PI / 2 }
  }
  return { ...wall }
}

export function nextCannonId(side: Side, taken: Set<string> | string[]): string {
  const set = taken instanceof Set ? taken : new Set(taken)
  const prefix = side === 'player' ? 'p' : side === 'enemy' ? 'e' : 'n'
  for (let i = 1; ; i++) if (!set.has(`${prefix}${i}`)) return `${prefix}${i}`
}

/** Problems that stop a map from being played. Empty means it's good to go. */
export function validateMap(level: LevelDef): string[] {
  const count = (side: Side): number => level.cannons.filter((c) => c.side === side).length
  const errors: string[] = []
  if (count('player') < 1) errors.push('Add at least one of your (player) cannons.')
  if (level.kind === 'puzzle') {
    if (count('neutral') < 1) errors.push('Puzzles need at least one neutral cannon to capture.')
    if (count('enemy') > 0) errors.push('Puzzles have no enemy: switch to Battle or remove the red cannons.')
  } else if (count('enemy') < 1) errors.push('Battles need at least one enemy (red) cannon.')
  return errors
}

// ------------------------------------------------------------------ share codes

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(code: string): string {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** The plain JSON for a map (what the .json download contains). */
export function mapToJson(level: LevelDef, pretty = true): string {
  return JSON.stringify(sanitizeLevel(level), null, pretty ? 2 : 0)
}

export function encodeShare(level: LevelDef): string {
  return SHARE_PREFIX + toBase64Url(mapToJson(level, false))
}

/** Accepts a share code (CC1:...) or raw map JSON. Throws a readable Error. */
export function decodeShare(input: string): LevelDef {
  const text = input.trim()
  if (!text) throw new Error('Paste a share code first.')
  let json: string
  if (text.startsWith('{')) json = text
  else {
    const body = text.startsWith(SHARE_PREFIX) ? text.slice(SHARE_PREFIX.length) : text
    try {
      json = fromBase64Url(body.replace(/\s+/g, ''))
    } catch {
      throw new Error('That share code looks damaged (it should start with CC1:).')
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('That share code looks damaged (it should start with CC1:).')
  }
  return sanitizeLevel(raw)
}

// ------------------------------------------------------------------ storage

export interface SavedMap {
  level: LevelDef
  updated: number
  /** Last editor camera for this map. */
  view?: MapView
}

/** A camera position: zoom (1 = near) and the world point at the centre. */
export interface MapView {
  zoom: number
  x: number
  y: number
}

export function sanitizeView(raw: unknown): MapView | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  if (!ok(o.zoom) || !ok(o.x) || !ok(o.y)) return undefined
  return { zoom: Math.min(4, Math.max(0.05, o.zoom)), x: o.x, y: o.y }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function listMaps(): SavedMap[] {
  const raw = storage()?.getItem(STORE_KEY)
  if (!raw) return []
  try {
    const data = JSON.parse(raw) as { maps?: unknown[] }
    const out: SavedMap[] = []
    for (const m of data.maps ?? []) {
      try {
        const o = m as { level?: unknown; updated?: unknown; view?: unknown }
        const entry: SavedMap = { level: sanitizeLevel(o.level), updated: typeof o.updated === 'number' ? o.updated : 0 }
        const view = sanitizeView(o.view)
        if (view) entry.view = view
        out.push(entry)
      } catch {
        /* skip a broken entry */
      }
    }
    return out.sort((a, b) => b.updated - a.updated)
  } catch {
    return []
  }
}

function writeMaps(maps: SavedMap[]): void {
  storage()?.setItem(STORE_KEY, JSON.stringify({ maps }))
}

export function getMap(id: string): LevelDef | null {
  return listMaps().find((m) => m.level.id === id)?.level ?? null
}

export function getMapView(id: string): MapView | undefined {
  return listMaps().find((m) => m.level.id === id)?.view
}

/** Insert or replace by id (keeping its last camera unless a new one is given). Returns the stored copy. */
export function saveMap(level: LevelDef, view?: MapView): LevelDef {
  const clean = sanitizeLevel(level)
  const all = listMaps()
  const keep = view ?? all.find((m) => m.level.id === clean.id)?.view
  const maps = all.filter((m) => m.level.id !== clean.id)
  const entry: SavedMap = { level: clean, updated: Date.now() }
  const v = sanitizeView(keep)
  if (v) entry.view = v
  maps.unshift(entry)
  writeMaps(maps)
  return clean
}

export function deleteMap(id: string): void {
  writeMaps(listMaps().filter((m) => m.level.id !== id))
}

export function renameMap(id: string, name: string): void {
  const maps = listMaps()
  const hit = maps.find((m) => m.level.id === id)
  if (!hit) return
  hit.level = { ...hit.level, name: str(name, hit.level.name, LIMITS.name) }
  hit.updated = Date.now()
  writeMaps(maps)
}

/** The editor's working copy (and its camera), kept across playtests and reloads. */
export function saveDraft(level: LevelDef, savedId: string | null, view?: MapView): void {
  storage()?.setItem(DRAFT_KEY, JSON.stringify({ level, savedId, view }))
}

export function loadDraft(): { level: LevelDef; savedId: string | null; view?: MapView } | null {
  const raw = storage()?.getItem(DRAFT_KEY)
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as { level: unknown; savedId?: unknown; view?: unknown }
    return {
      level: sanitizeLevel(d.level),
      savedId: typeof d.savedId === 'string' ? d.savedId : null,
      view: sanitizeView(d.view),
    }
  } catch {
    return null
  }
}
