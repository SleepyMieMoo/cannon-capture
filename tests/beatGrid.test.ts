import { describe, expect, it } from 'vitest'
import { BAR, BEAT, NO_BEAT, beatAt, beatLength, beatTime, followBeat, type BeatFollower, type BeatGrid, type BeatPhase } from '../src/audio/beatGrid'
import { TRACKS } from '../src/audio/musicTracks'

const phase = (): BeatPhase => ({ beat: 0, frac: 0, since: 0, downbeat: false })
const grid: BeatGrid = { bpm: 120, firstBeat: 0.5, barOffset: 2 }

describe('beat phase', () => {
  it('counts beats from the first beat, with the bar offset', () => {
    const p = phase()
    expect(beatAt(0.5, grid, p)).toMatchObject({ beat: 0, frac: 0, downbeat: false })
    expect(beatAt(1.5, grid, p)).toMatchObject({ beat: 2, downbeat: true })
    expect(beatAt(1.75, grid, p).frac).toBeCloseTo(0.5, 9)
    expect(p.since).toBeCloseTo(0.25, 9)
    expect(beatAt(3.5, grid, p)).toMatchObject({ beat: 6, downbeat: true })
    expect(beatAt(2.0, grid, p)).toMatchObject({ beat: 3, downbeat: false })
  })

  it('runs back before the first beat too (bars still line up)', () => {
    const p = phase()
    expect(beatAt(0.25, grid, p)).toMatchObject({ beat: -1, downbeat: false })
    expect(p.frac).toBeCloseTo(0.5, 9)
    expect(beatAt(-0.5, grid, p)).toMatchObject({ beat: -2, downbeat: true })
  })

  it('beatTime is the inverse', () => {
    const p = phase()
    for (const b of [-3, 0, 1, 17, 400]) {
      expect(beatAt(beatTime(b, grid) + 1e-6, grid, p).beat).toBe(b)
    }
    expect(beatLength(grid)).toBeCloseTo(0.5, 9)
  })

  it('every song has a measured grid: tempo, a first beat inside the first beat length, a bar offset', () => {
    for (const t of TRACKS) {
      expect(t.beat.bpm).toBeGreaterThan(60)
      expect(t.beat.bpm).toBeLessThan(200)
      expect(t.beat.firstBeat).toBeGreaterThanOrEqual(0)
      expect(t.beat.firstBeat).toBeLessThan(beatLength(t.beat))
      expect(Number.isInteger(t.beat.barOffset) && t.beat.barOffset >= 0 && t.beat.barOffset < 4).toBe(true)
    }
    const farty = TRACKS.find((t) => t.id === 'fartysoup')!.beat
    // Its first bar starts on the first hit, two beats in.
    expect(beatAt(beatTime(2, farty) + 0.001, farty, phase()).downbeat).toBe(true)
  })
})

/** Play `song` from `from` for `secs` at 60 fps (looping like the player does) and collect what fires. */
function play(song: string, g: BeatGrid, from: number, secs: number, loop: { start: number; end: number }, f: BeatFollower = { song: '', beat: 0 }) {
  const p = phase()
  const fired: { pos: number; beat: number; kind: number }[] = []
  for (let t = 0; t <= secs; t += 1 / 60) {
    let pos = from + t
    if (pos >= loop.end) pos = loop.start + ((pos - loop.start) % (loop.end - loop.start))
    const kind = followBeat(f, song, pos, g, p)
    if (kind !== NO_BEAT) fired.push({ pos, beat: p.beat, kind })
  }
  return fired
}

describe('following the beat', () => {
  it('fires each beat once, on time, and marks each bar’s first beat', () => {
    const fired = play('a', grid, 0, 10.1, { start: 0, end: 1000 })
    // Beats at 0.5, 1.0 ... 10.0: 20 of them (the grid's beat -1 at 0 is before the song's first beat).
    expect(fired.length).toBe(20)
    for (const f of fired) {
      expect(f.pos - beatTime(f.beat, grid)).toBeGreaterThanOrEqual(0)
      expect(f.pos - beatTime(f.beat, grid)).toBeLessThan(1 / 60 + 1e-9)
      expect(f.kind).toBe(((f.beat - 2) % 4 + 4) % 4 === 0 ? BAR : BEAT)
    }
    expect(fired.filter((f) => f.kind === BAR).length).toBe(5)
  })

  it('a loop that isn’t whole bars wraps without a stray or doubled pulse, and stays on the song’s grid', () => {
    const t = TRACKS.find((x) => x.id === 'fartysoup')!
    const loop = { start: 0, end: 89.1868 }
    const fired = play(t.id, t.beat, 80, 30, loop)
    for (const f of fired) {
      const off = f.pos - beatTime(f.beat, t.beat)
      expect(off).toBeGreaterThanOrEqual(0)
      expect(off).toBeLessThan(1 / 60 + 1e-9)
    }
    // Around the wrap: the last beat before the loop end, then beat 0 of the next pass.
    const wrap = fired.findIndex((f, i) => i > 0 && f.pos < fired[i - 1].pos)
    expect(wrap).toBeGreaterThan(0)
    expect(fired[wrap].beat).toBe(0)
    expect(fired[wrap - 1].beat).toBe(Math.floor((loop.end - t.beat.firstBeat) / beatLength(t.beat)))
    // Nothing from the grid's run back before the first beat.
    expect(fired.every((f) => f.beat >= 0)).toBe(true)
    // Bars restart from the song's own first bar (beat 2), not from where the last pass left off.
    expect(fired.find((f, i) => i >= wrap && f.kind === BAR)?.beat).toBe(2)
  })

  it('a song switch starts on the new song’s grid and never fires mid-beat', () => {
    const f: BeatFollower = { song: '', beat: 0 }
    const p = phase()
    const a: BeatGrid = { bpm: 120, firstBeat: 0, barOffset: 0 }
    const b: BeatGrid = { bpm: 100, firstBeat: 0.2, barOffset: 1 }
    followBeat(f, 'a', 5.01, a, p)
    // The new song starts at its loop start (0), 0.2 s before its first beat: nothing yet.
    expect(followBeat(f, 'b', 0.0, b, p)).toBe(NO_BEAT)
    expect(followBeat(f, 'b', 0.1, b, p)).toBe(NO_BEAT)
    expect(followBeat(f, 'b', 0.21, b, p)).toBe(BEAT) // beat 0, not a bar's first (offset 1)
    expect(followBeat(f, 'b', 0.81, b, p)).toBe(BAR) // beat 1
    // Switching to a song mid-beat waits for its next beat.
    expect(followBeat(f, 'a', 7.3, a, p)).toBe(NO_BEAT)
    expect(followBeat(f, 'a', 7.51, a, p)).toBe(BEAT)
    // Switching right on a beat fires it.
    expect(followBeat(f, 'b', 0.82, b, p)).toBe(BAR)
  })

  it('a long gap (hidden tab, seek, slow frame) never queues pulses: at most one, and only fresh', () => {
    const f: BeatFollower = { song: '', beat: 0 }
    const p = phase()
    followBeat(f, 'a', 1.01, grid, p)
    expect(followBeat(f, 'a', 31.25, grid, p)).toBe(NO_BEAT) // mid-beat: wait
    expect(followBeat(f, 'a', 31.27, grid, p)).toBe(NO_BEAT)
    expect(followBeat(f, 'a', 31.51, grid, p)).not.toBe(NO_BEAT)
    expect(followBeat(f, 'a', 60.53, grid, p)).not.toBe(NO_BEAT) // back right on a beat: just that one
    expect(followBeat(f, 'a', 60.6, grid, p)).toBe(NO_BEAT)
    // Seeking back.
    expect(followBeat(f, 'a', 10.05, grid, p)).not.toBe(NO_BEAT)
    expect(followBeat(f, 'a', 3.3, grid, p)).toBe(NO_BEAT)
  })
})
