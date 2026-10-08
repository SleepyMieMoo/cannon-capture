import { AUDIO_KEY } from '../audio/audioSettings'
import { DRAFT_KEY, STORE_KEY } from '../editor/maps'
import { NAME_KEY } from '../net/onlineClient'
import { PERF_KEY } from '../perf/perfPrefs'
import { PROGRESS_KEY } from '../progress'
import { clearColour, COLOUR_KEY } from './colourPref'
import { MENU_KEY } from './menuModel'
import { clearSkin, SKIN_KEY } from './skinPref'

/**
 * Every preference saved on this device, and what Profile → "Reset all
 * preferences" forgets. What you made or earned (maps, the editor's draft,
 * stars) is never touched by it.
 */
export const PREF_KEYS: readonly { key: string; what: string }[] = [
  { key: NAME_KEY, what: 'online name' },
  { key: SKIN_KEY, what: 'cannon skin' },
  { key: COLOUR_KEY, what: 'team colour' },
  { key: MENU_KEY, what: 'Play vs AI difficulty and map' },
  { key: AUDIO_KEY, what: 'sound and volume' },
  { key: PERF_KEY, what: 'performance overlay' },
]

/** Kept by the reset. */
export const KEPT_KEYS: readonly { key: string; what: string }[] = [
  { key: STORE_KEY, what: 'your maps' },
  { key: DRAFT_KEY, what: 'the editor’s working copy' },
  { key: PROGRESS_KEY, what: 'level stars' },
]

type Store = Pick<Storage, 'removeItem'>

function deviceStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Forget every preference in `store` (back to the defaults). Returns the keys it removed. */
export function resetPreferences(store: Store | null = deviceStore()): string[] {
  const removed: string[] = []
  for (const { key } of PREF_KEYS) {
    try {
      store?.removeItem(key)
      removed.push(key)
    } catch {
      // Storage blocked: nothing to forget.
    }
  }
  return removed
}

/**
 * Profile → Reset all preferences, on this device: forget them all, and let
 * skin and colour tell their listeners, so the title battle and the menu's
 * pictures change at once.
 */
export function resetAllPreferences(): string[] {
  const removed = resetPreferences()
  clearSkin()
  clearColour()
  return removed
}
