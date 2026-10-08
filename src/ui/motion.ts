/**
 * "Reduce motion": the UI's movement (panels popping in, the floating title,
 * button bounces, the win confetti, the countdown punch) can be turned down.
 * Auto (the default) follows the device's own reduce-motion setting.
 *
 * CSS reads it from a class on <html> (cc-calm); canvas and script effects ask
 * motionOK(), a cached boolean that is cheap to call every frame.
 */
export type MotionPref = 'auto' | 'on' | 'off'

export const MOTION_KEY = 'cannon-capture:motion:v1'
const KEY = MOTION_KEY
const QUERY = '(prefers-reduced-motion: reduce)'

/** Reduce motion or not, for a preference and the device's setting. */
export function resolveReduce(pref: MotionPref, systemReduces: boolean): boolean {
  return pref === 'on' || (pref === 'auto' && systemReduces)
}

export function parseMotionPref(raw: string | null | undefined): MotionPref {
  return raw === 'on' || raw === 'off' ? raw : 'auto'
}

export function loadMotionPref(): MotionPref {
  try {
    return parseMotionPref(localStorage.getItem(KEY))
  } catch {
    return 'auto'
  }
}

/** The device asks for less motion. */
export function systemReduces(): boolean {
  return typeof matchMedia === 'function' && matchMedia(QUERY).matches
}

let reduced = false
let watching = false
const listeners = new Set<() => void>()

/** Is lively motion allowed right now? (No allocation: safe every frame.) */
export function motionOK(): boolean {
  return !reduced
}

/** Work it out again and mark the page (at start, on a change here, on a change of the device setting). */
export function applyMotion(): void {
  reduced = resolveReduce(loadMotionPref(), systemReduces())
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('cc-calm', reduced)
  if (!watching && typeof matchMedia === 'function') {
    watching = true
    matchMedia(QUERY).addEventListener?.('change', () => applyMotion())
  }
  for (const fn of listeners) fn()
}

export function saveMotionPref(pref: MotionPref): void {
  try {
    if (pref === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    // Private mode: it still applies for this visit.
  }
  applyMotion()
}

/** Told when reduce motion turns on or off. Returns the way to stop listening. */
export function onMotionChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
