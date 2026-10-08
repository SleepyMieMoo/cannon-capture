/**
 * Settings → When tabbed out: what happens to a round against the AI while
 * the game is in the background. Music has its own switch (musicSettings.ts:
 * keepHidden). Saved on this device.
 */
export interface TabPrefs {
  /**
   * On (default): vs AI, puzzles and levels pause when you switch away, with
   * Resume when you're back. Off: the round keeps going, and on return it is
   * caught up to the time you were away (silently), up to CATCH_UP.maxMs.
   */
  pauseVsAi: boolean
}

export const TAB_KEY = 'cannon-capture:tabbed:v1'
export const TAB_DEFAULTS: Readonly<TabPrefs> = { pauseVsAi: true }

type Store = Pick<Storage, 'getItem' | 'setItem'>

function deviceStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadTabPrefs(store: Store | null = deviceStore()): TabPrefs {
  try {
    const raw = store?.getItem(TAB_KEY)
    if (!raw) return { ...TAB_DEFAULTS }
    const p = JSON.parse(raw) as Partial<TabPrefs> | null
    return { pauseVsAi: typeof p?.pauseVsAi === 'boolean' ? p.pauseVsAi : TAB_DEFAULTS.pauseVsAi }
  } catch {
    return { ...TAB_DEFAULTS }
  }
}

export function saveTabPrefs(p: TabPrefs, store: Store | null = deviceStore()): void {
  try {
    store?.setItem(TAB_KEY, JSON.stringify({ pauseVsAi: p.pauseVsAi }))
  } catch {
    // Storage blocked: the setting just won't stick.
  }
}
