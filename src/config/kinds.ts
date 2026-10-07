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
  /** One-line description for menus. */
  blurb: string
  speedMul: number
  lifetimeMul: number
  turnMul: number
  /** Selectable fire delays in seconds (damage = delay), or null for the side's normal rate. */
  delays: readonly number[] | null
  defaultDelay: number
}

export const KINDS: Record<CannonKind, KindSpec> = {
  normal: {
    id: 'normal',
    label: 'Normal',
    blurb: 'Fires every second, 1 damage',
    speedMul: 1,
    lifetimeMul: 1,
    turnMul: 1,
    delays: null,
    defaultDelay: 1,
  },
  sniper: {
    id: 'sniper',
    label: 'Sniper',
    blurb: '2× speed and range, damage = delay',
    speedMul: TUNING.sniper.speedMul,
    lifetimeMul: TUNING.sniper.lifetimeMul,
    turnMul: TUNING.sniper.turnMul,
    delays: TUNING.sniper.delays,
    defaultDelay: TUNING.sniper.defaultDelay,
  },
}

export const KIND_IDS: readonly CannonKind[] = CANNON_KINDS

export function isKind(v: unknown): v is CannonKind {
  return typeof v === 'string' && (CANNON_KINDS as readonly string[]).includes(v)
}

/** A valid delay for this kind (snipers: 2 or 3 s; others ignore it). */
export function delayFor(kind: CannonKind, delay?: number): number {
  const spec = KINDS[kind]
  if (!spec.delays) return spec.defaultDelay
  return delay !== undefined && spec.delays.includes(delay) ? delay : spec.defaultDelay
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
export function fireMsFor(kind: CannonKind, delay: number, sideMs: number): number {
  return KINDS[kind].delays ? delay * 1000 : sideMs
}

/** Capture progress per hit (and heal per friendly hit). */
export function damageFor(kind: CannonKind, delay: number): number {
  return KINDS[kind].delays ? delay : 1
}

export function turnSpeedDegFor(kind: CannonKind): number {
  return TUNING.turnSpeedDeg * KINDS[kind].turnMul
}

/** Lane-table key for a cannon fitted as `kind` (normal keeps the bare id). */
export function laneKey(id: string, kind: CannonKind = 'normal'): string {
  return kind === 'normal' ? id : `${id}#${kind}`
}

export function kindLabel(kind: CannonKind, delay?: number): string {
  return KINDS[kind].delays ? `${KINDS[kind].label} ${delayFor(kind, delay)}s` : KINDS[kind].label
}
