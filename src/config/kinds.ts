import { TUNING } from './tuning'
import { CANNON_KINDS, type CannonKind } from '../types'

/**
 * Tower types. Each entry says how its shots fly and how often and how hard
 * it fires. Adding a type: extend CANNON_KINDS in types.ts, add a spec here,
 * and give it a look in Cannon.draw. The swap menu, editor, lanes and AI pick
 * it up from this table.
 */
export interface KindSpec {
  id: CannonKind
  label: string
  /** One-line description for menus and hints. */
  blurb: string
  speedMul: number
  lifetimeMul: number
  turnMul: number
  /** Milliseconds between shots, or null for the side's normal rate. */
  fireMs: number | null
  /** Capture progress per hit (and heal per friendly hit). May be a fraction. */
  damage: number
  /** Random aim error per shot, up to this many degrees either way. */
  spreadDeg: number
}

/** A number for the UI: whole numbers as is, fractions to one decimal (0.3, 1.5). */
export function fmtNum(n: number): string {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

function spec(id: CannonKind, label: string, extra: (t: Omit<KindSpec, 'id' | 'label' | 'blurb'>) => string): KindSpec {
  const t = TUNING.towers[id]
  const base = { speedMul: t.speedMul, lifetimeMul: t.lifetimeMul, turnMul: t.turnMul, fireMs: t.fireMs, damage: t.damage, spreadDeg: t.spreadDeg }
  return { id, label, ...base, blurb: extra(base) }
}

const reach = (m: number) => (m === 0.5 ? 'half the range' : `${fmtNum(m)}× range`)
const every = (ms: number | null) => (ms === null ? 'every second' : `every ${fmtNum(ms / 1000)} s`)

export const KINDS: Record<CannonKind, KindSpec> = {
  normal: spec('normal', 'Normal', (t) => `${fmtNum(t.damage)} damage ${every(t.fireMs)}`),
  sniper: spec(
    'sniper',
    'Sniper',
    (t) => `${fmtNum(t.damage)} damage ${every(t.fireMs)}, ${reach(t.speedMul * t.lifetimeMul)}, dead accurate, turns slowly`,
  ),
  machinegun: spec(
    'machinegun',
    'Machine gun',
    (t) => `${fmtNum(t.damage)} damage ${every(t.fireMs)}, ${reach(t.speedMul * t.lifetimeMul)}, spread ±${fmtNum(t.spreadDeg)}°, turns fast`,
  ),
}

export const KIND_IDS: readonly CannonKind[] = CANNON_KINDS

export function isKind(v: unknown): v is CannonKind {
  return typeof v === 'string' && (CANNON_KINDS as readonly string[]).includes(v)
}

export function shotSpeedFor(kind: CannonKind): number {
  return TUNING.shotSpeed * KINDS[kind].speedMul
}

/** Fan boosts are capped relative to the shot's own base speed. */
export function maxShotSpeedFor(kind: CannonKind): number {
  return shotSpeedFor(kind) * TUNING.shotSpeedCap
}

export function shotLifetimeFor(kind: CannonKind): number {
  return TUNING.shotLifetimeMs * KINDS[kind].lifetimeMul
}

/**
 * Milliseconds between shots. Normal cannons use their side's rate
 * (`sideMs`). Other types keep their own rate, scaled the same way when a
 * level slows a side down (ai.fireMs 1300 makes pink's machine guns fire
 * every 0.26 s), so no type dodges a level's handicap.
 */
export function fireMsFor(kind: CannonKind, sideMs: number): number {
  const own = KINDS[kind].fireMs
  return own === null ? sideMs : own * (sideMs / TUNING.fireIntervalMs)
}

/** Capture progress per hit (and heal per friendly hit). */
export function damageFor(kind: CannonKind): number {
  return KINDS[kind].damage
}

export function turnSpeedDegFor(kind: CannonKind): number {
  return TUNING.turnSpeedDeg * KINDS[kind].turnMul
}

export function spreadDegFor(kind: CannonKind): number {
  return KINDS[kind].spreadDeg
}

/** How far a shot of this type travels in open space (px). */
export function shotRangeFor(kind: CannonKind): number {
  return (shotSpeedFor(kind) * shotLifetimeFor(kind)) / 1000
}

/**
 * Narrowest lane (degrees) the AI and bots trust for this type: the usual
 * minimum, or the spread when that is wider, so most shots still land.
 */
export function minLaneFor(kind: CannonKind, base = 2): number {
  return Math.max(base, KINDS[kind].spreadDeg)
}

/** Lane-table key for a cannon fitted as `kind` (normal keeps the bare id). */
export function laneKey(id: string, kind: CannonKind = 'normal'): string {
  return kind === 'normal' ? id : `${id}#${kind}`
}

export function kindLabel(kind: CannonKind): string {
  return KINDS[kind].label
}

/** The next type in order (T key in play and in the editor). */
export function nextKind(kind: CannonKind): CannonKind {
  return KIND_IDS[(KIND_IDS.indexOf(kind) + 1) % KIND_IDS.length]
}
