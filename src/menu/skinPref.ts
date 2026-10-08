import { DEFAULT_SKIN, isSkin, type SkinId } from '../config/skins'

/** Your cannon skin, saved on this device. */
export const SKIN_KEY = 'cannon-capture:skin:v1'
const KEY = SKIN_KEY

export function parseSkinPref(raw: string | null | undefined): SkinId {
  return isSkin(raw) ? raw : DEFAULT_SKIN
}

export function loadSkin(): SkinId {
  try {
    return parseSkinPref(localStorage.getItem(KEY))
  } catch {
    return DEFAULT_SKIN
  }
}

const listeners = new Set<(skin: SkinId) => void>()

/** Hear about a new pick (the title screen's demo round re-skins itself). Returns an unsubscribe. */
export function onSkinChange(fn: (skin: SkinId) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Back to the default skin (Profile → Reset): forget the pick and tell the listeners. */
export function clearSkin(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Storage blocked: nothing saved anyway.
  }
  for (const fn of listeners) fn(DEFAULT_SKIN)
}

export function saveSkin(skin: SkinId): void {
  for (const fn of listeners) fn(skin)
  try {
    localStorage.setItem(KEY, skin)
  } catch {
    // Private mode or storage full: the choice lasts until the page closes.
  }
}
