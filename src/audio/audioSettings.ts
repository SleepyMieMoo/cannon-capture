import { SFX } from '../config/sfx'

/** Sound settings, kept on this device (unlike auto-target, which resets every game). */
export interface AudioSettings {
  volume: number
  muted: boolean
}

const KEY = 'cannon-capture:audio:v1'

export function loadAudioSettings(): AudioSettings {
  const fallback = { volume: SFX.defaultVolume, muted: false }
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return fallback
    const p = JSON.parse(raw) as Partial<AudioSettings>
    const volume = typeof p.volume === 'number' && Number.isFinite(p.volume) ? Math.max(0, Math.min(1, p.volume)) : fallback.volume
    return { volume, muted: p.muted === true }
  } catch {
    return fallback
  }
}

export function saveAudioSettings(s: AudioSettings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ volume: s.volume, muted: s.muted }))
  } catch {
    // Storage blocked: the setting just won't stick.
  }
}
