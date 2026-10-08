import { DEFAULT_SKIN, isSkin, type SkinId } from '../config/skins'

/** Your cannon skin, saved on this device. */
const KEY = 'cannon-capture:skin:v1'

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

export function saveSkin(skin: SkinId): void {
  for (const fn of listeners) fn(skin)
  try {
    localStorage.setItem(KEY, skin)
  } catch {
    // Private mode or storage full: the choice lasts until the page closes.
  }
}
