import { withWin, type Progress } from './sim/stars'

/** Campaign progress lives in localStorage on this device only. */
export const PROGRESS_KEY = 'cannon-capture:progress:v1'
const KEY = PROGRESS_KEY

export function loadProgress(): Progress {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Progress>
      if (parsed && typeof parsed.stars === 'object' && parsed.stars) {
        const stars: Record<string, number> = {}
        for (const [id, value] of Object.entries(parsed.stars)) {
          if (typeof value === 'number' && value > 0) stars[id] = Math.min(3, Math.floor(value))
        }
        return { stars }
      }
    }
  } catch {
    // Private mode or corrupted data: start fresh.
  }
  return { stars: {} }
}

export function recordWin(levelId: string, stars: number): Progress {
  const next = withWin(loadProgress(), levelId, stars)
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage full or blocked: progress just won't persist.
  }
  return next
}

export function resetProgress(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
