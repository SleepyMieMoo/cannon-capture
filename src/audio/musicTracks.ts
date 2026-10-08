/**
 * The jukebox's songs: royalty-free tracks by Reganati on Pixabay, free to
 * use under the Pixabay Content License (credited on the Credits page).
 *
 * The files in public/music/ are the Pixabay downloads with the silence at
 * both ends trimmed (so they loop tightly), levelled to about the same
 * loudness, and re-encoded to 128 kbps MP3 (about 1.2 to 1.9 MB each). Only
 * the song being played is downloaded, after the menu is on screen.
 */
export interface MusicTrack {
  id: TrackId
  /** The title on Pixabay. */
  title: string
  /** Shorter title for small spaces (the menu's corner button). */
  short: string
  artist: string
  /** The track's page on Pixabay. */
  page: string
  /** Relative to the page, so it works on GitHub Pages and inside Discord. */
  file: string
  /** The title screen's song. */
  theme?: boolean
}

export type TrackId = 'fartysoup' | 'robotic-spaghetti' | 'singularity'

export const MUSIC_ARTIST = { name: 'Reganati', page: 'https://pixabay.com/users/reganati-46795721/' } as const

export const TRACKS: readonly MusicTrack[] = [
  {
    id: 'fartysoup',
    title: 'FartySoup McTriple',
    short: 'FartySoup McTriple',
    artist: MUSIC_ARTIST.name,
    page: 'https://pixabay.com/music/upbeat-fartysoup-mctriple-414508/',
    file: 'music/fartysoup.mp3',
    theme: true,
  },
  {
    id: 'robotic-spaghetti',
    title: 'Robotic Spaghetti',
    short: 'Robotic Spaghetti',
    artist: MUSIC_ARTIST.name,
    page: 'https://pixabay.com/music/beats-robotic-spaghetti-414385/',
    file: 'music/robotic-spaghetti.mp3',
  },
  {
    id: 'singularity',
    title: 'Singularity - Funky/Glitchy VideoGame Music',
    short: 'Singularity',
    artist: MUSIC_ARTIST.name,
    page: 'https://pixabay.com/music/funk-singularity-funkyglitchy-videogame-music-512162/',
    file: 'music/singularity.mp3',
  },
]

/** The title song, and the default until the player picks another. */
export const DEFAULT_TRACK: TrackId = 'fartysoup'

const BY_ID = new Map(TRACKS.map((t) => [t.id, t]))

export function isTrackId(id: unknown): id is TrackId {
  return typeof id === 'string' && BY_ID.has(id as TrackId)
}

export function trackById(id: TrackId): MusicTrack {
  return BY_ID.get(id) ?? TRACKS[0]
}

/** The next (dir 1) or previous (dir -1) song, wrapping around the list. */
export function stepTrack(id: TrackId, dir: 1 | -1): TrackId {
  const i = TRACKS.findIndex((t) => t.id === id)
  const n = TRACKS.length
  return TRACKS[(((i < 0 ? 0 : i) + dir) % n + n) % n].id
}
