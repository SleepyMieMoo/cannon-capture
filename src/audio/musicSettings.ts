import { SFX } from '../config/sfx'
import { DEFAULT_TRACK, isTrackId, type TrackId } from './musicTracks'

/**
 * Music settings, kept on this device, separate from the sound effects'
 * volume and mute (audioSettings.ts).
 */
export interface MusicSettings {
  /** Music volume, 0..1 (its own slider). */
  volume: number
  /** Music on (play) or off (pause). Remembered, so "off" stays off next time. */
  on: boolean
  /** The default song: the one that plays when the game starts. */
  track: TrackId
  /** Settings → When tabbed out: keep the music going while the tab is hidden (default), or pause it. */
  keepHidden: boolean
}

export const MUSIC_KEY = 'cannon-capture:music:v1'

/** About half as loud as the sound effects' default, so music sits under the pops. */
export const MUSIC_DEFAULT_VOLUME = Math.round(SFX.defaultVolume * 0.5 * 100) / 100

export const MUSIC_DEFAULTS: Readonly<MusicSettings> = { volume: MUSIC_DEFAULT_VOLUME, on: true, track: DEFAULT_TRACK, keepHidden: true }

type Store = Pick<Storage, 'getItem' | 'setItem'>

function deviceStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Saved settings, with anything missing or broken back at its default. */
export function loadMusicSettings(store: Store | null = deviceStore()): MusicSettings {
  try {
    const raw = store?.getItem(MUSIC_KEY)
    if (!raw) return { ...MUSIC_DEFAULTS }
    const p = JSON.parse(raw) as Partial<MusicSettings> | null
    const volume = typeof p?.volume === 'number' && Number.isFinite(p.volume) ? Math.max(0, Math.min(1, p.volume)) : MUSIC_DEFAULTS.volume
    return {
      volume,
      on: typeof p?.on === 'boolean' ? p.on : MUSIC_DEFAULTS.on,
      track: isTrackId(p?.track) ? p.track : MUSIC_DEFAULTS.track,
      keepHidden: typeof p?.keepHidden === 'boolean' ? p.keepHidden : MUSIC_DEFAULTS.keepHidden,
    }
  } catch {
    return { ...MUSIC_DEFAULTS }
  }
}

export function saveMusicSettings(s: MusicSettings, store: Store | null = deviceStore()): void {
  try {
    store?.setItem(MUSIC_KEY, JSON.stringify({ volume: s.volume, on: s.on, track: s.track, keepHidden: s.keepHidden }))
  } catch {
    // Storage blocked: the setting just won't stick.
  }
}
