import { FX_DEFAULTS, FX_KEY, fxConfig, parseFxPrefs, resolveQuality, type DeviceHints, type FxConfig, type FxPrefs, type FxQuality, type FxScope } from './fxQuality'
import { motionOK, onMotionChange } from '../../ui/motion'

/** The saved Effects quality choice on this device, and who to tell when it changes. */
const listeners = new Set<() => void>()
let prefs: FxPrefs | null = null
/** The resolved quality, cached (read every battle frame); dropped whenever the prefs change. */
let resolved: { quality: FxQuality; auto: boolean } | null = null
let deviceHints: DeviceHints | null = null

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function hints(): DeviceHints {
  if (typeof navigator === 'undefined') return {}
  const nav = navigator as Navigator & { deviceMemory?: number }
  return {
    memoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
    cores: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : undefined,
    coarse: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  }
}

export function loadFxPrefs(): FxPrefs {
  if (!prefs) {
    let raw: string | null = null
    try {
      raw = store()?.getItem(FX_KEY) ?? null
    } catch {
      raw = null
    }
    prefs = parseFxPrefs(raw)
  }
  return prefs
}

function save(p: FxPrefs): void {
  prefs = p
  resolved = null
  try {
    store()?.setItem(FX_KEY, JSON.stringify(p))
  } catch {
    // Storage blocked: it lasts for this visit.
  }
  for (const fn of listeners) fn()
}

/** Settings: pick a quality (null: automatic again). */
export function saveFxChoice(choice: FxQuality | null): void {
  save({ choice, slow: choice === null ? false : loadFxPrefs().slow })
}

/** Automatic quality: battles run slowly here at High, so use Low from now on. */
export function noteSlowDevice(): void {
  const p = loadFxPrefs()
  if (p.choice || p.slow) return
  save({ ...p, slow: true })
}

/** Reset all preferences: forget the cached choice (the key itself is removed by the reset). */
export function forgetFxPrefs(): void {
  prefs = { ...FX_DEFAULTS }
  resolved = null
  for (const fn of listeners) fn()
}

/** The quality in use (cheap: cached until the prefs change). */
export function currentFx(): { quality: FxQuality; auto: boolean } {
  return (resolved ??= resolveQuality(loadFxPrefs(), (deviceHints ??= hints())))
}

export function currentFxConfig(scope: FxScope = 'battle'): FxConfig {
  return fxConfig(currentFx().quality, !motionOK(), scope)
}

/** For Copy debug info and the perf overlay, e.g. "high (auto)". */
export function fxLabel(): string {
  const p = loadFxPrefs()
  const { quality, auto } = currentFx()
  return auto ? `${quality} (auto${p.slow ? ', slow frames' : ''})` : quality
}

/** Told when the quality or Reduce motion changes. Returns an unsubscribe. */
export function onFxChange(fn: () => void): () => void {
  listeners.add(fn)
  const off = onMotionChange(fn)
  return () => {
    listeners.delete(fn)
    off()
  }
}
