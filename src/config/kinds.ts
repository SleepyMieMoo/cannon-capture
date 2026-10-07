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
  /** Capture progress per hit (and heal per friendly hit). */
  damage: number
}

export const KINDS: Record<CannonKind, KindSpec> = {
  normal: {
    id: 'normal',
    label: 'Normal',
    blurb: '1 damage every second',
    speedMul: 1,
    lifetimeMul: 1,
    turnMul: 1,
    fireMs: null,
    damage: 1,
  },
  sniper: {
    id: 'sniper',
    label: 'Sniper',
    blurb: `${TUNING.sniper.damage} damage every ${TUNING.sniper.fireMs / 1000} s, 2× shot speed and range`,
    speedMul: TUNING.sniper.speedMul,
    lifetimeMul: TUNING.sniper.lifetimeMul,
    turnMul: TUNING.sniper.turnMul,
    fireMs: TUNING.sniper.fireMs,
    damage: TUNING.sniper.damage,
  },
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

/** Milliseconds between shots. Normal cannons use their side's rate (`sideMs`). */
export function fireMsFor(kind: CannonKind, sideMs: number): number {
  return KINDS[kind].fireMs ?? sideMs
}

/** Capture progress per hit (and heal per friendly hit). */
export function damageFor(kind: CannonKind): number {
  return KINDS[kind].damage
}

export function turnSpeedDegFor(kind: CannonKind): number {
  return TUNING.turnSpeedDeg * KINDS[kind].turnMul
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
