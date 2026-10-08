/**
 * Where the beats and bars fall in a song: pure maths, no browser, so the
 * tests can check it. Times are in the song's own seconds (the decoded
 * buffer's timeline, the same one the music player loops in), so a loop
 * that isn't a whole number of bars, a seek or a song switch never puts the
 * pulse off the beat: the phase is read from the playing position each time.
 */
export interface BeatGrid {
  bpm: number
  /** The song's first beat, in song seconds (the grid runs back from it too, but nothing fires there). */
  firstBeat: number
  /** How many beats after firstBeat a bar starts (0..beatsPerBar-1). */
  barOffset: number
  beatsPerBar?: number
}

/** Written in place (no allocation per frame). */
export interface BeatPhase {
  /** Beat number counted from firstBeat (negative before it). */
  beat: number
  /** How far into that beat (0..1). */
  frac: number
  /** Seconds since that beat started. */
  since: number
  /** This beat starts a bar. */
  downbeat: boolean
}

export function beatLength(grid: BeatGrid): number {
  return 60 / grid.bpm
}

/** The beat a song position is in. */
export function beatAt(pos: number, grid: BeatGrid, out: BeatPhase): BeatPhase {
  const len = 60 / grid.bpm
  const x = (pos - grid.firstBeat) / len
  const beat = Math.floor(x)
  const per = grid.beatsPerBar ?? 4
  out.beat = beat
  out.frac = x - beat
  out.since = out.frac * len
  out.downbeat = (((beat - grid.barOffset) % per) + per) % per === 0
  return out
}

/** Song time of beat number `beat`. */
export function beatTime(beat: number, grid: BeatGrid): number {
  return grid.firstBeat + (beat * 60) / grid.bpm
}

/** What a frame found: nothing new, a beat, or a bar's first beat. */
export const NO_BEAT = 0
export const BEAT = 1
export const BAR = 2

export interface BeatFollower {
  /** The song being followed (a switch starts afresh) and the last beat that fired. */
  song: string
  beat: number
}

/**
 * Called every frame with the audible song position: reports a beat the
 * moment one starts. Only a beat that began within `window` seconds fires,
 * so a frame that comes late (a hidden tab coming back, a loop wrapping back
 * to the start, a new song) never fires a stale or queued pulse: it just
 * picks up from the next beat. Nor does the grid's run back before the
 * first beat, which a loop wrapping to the start would otherwise hit.
 */
export function followBeat(f: BeatFollower, song: string, pos: number, grid: BeatGrid, phase: BeatPhase, window = 0.12): number {
  beatAt(pos, grid, phase)
  if (song !== f.song) {
    f.song = song
    f.beat = phase.since < window ? phase.beat - 1 : phase.beat
  }
  if (phase.beat === f.beat) return NO_BEAT
  f.beat = phase.beat
  // Before the song's first beat (just after a loop wraps to the start): no beat there.
  if (phase.since > window || phase.beat < 0) return NO_BEAT
  return phase.downbeat ? BAR : BEAT
}
