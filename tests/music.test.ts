import { afterEach, describe, expect, it, vi } from 'vitest'
import { MusicPlayer, loopPoints, type MusicEnv } from '../src/audio/music'
import { MUSIC_DEFAULTS, MUSIC_DEFAULT_VOLUME, MUSIC_KEY, loadMusicSettings, saveMusicSettings, type MusicSettings } from '../src/audio/musicSettings'
import { DEFAULT_TRACK, TRACKS, isTrackId, stepTrack } from '../src/audio/musicTracks'
import { statusText } from '../src/ui/jukebox'
import { SFX } from '../src/config/sfx'

/** A fake AudioContext: time moves only when the test says so, and nothing plays. */
class FakeCtx {
  state: AudioContextState = 'suspended'
  currentTime = 0
  destination = {}
  private listeners = new Map<string, Set<() => void>>()
  started: { id: number; offset: number; loopStart: number; loopEnd: number }[] = []
  stopped: number[] = []
  private nextId = 1
  addEventListener(e: string, fn: () => void): void {
    const set = this.listeners.get(e) ?? new Set()
    set.add(fn)
    this.listeners.set(e, set)
  }
  removeEventListener(e: string, fn: () => void): void {
    this.listeners.get(e)?.delete(fn)
  }
  private emit(e: string): void {
    for (const fn of [...(this.listeners.get(e) ?? [])]) fn()
  }
  resume(): Promise<void> {
    if (this.state !== 'running') {
      this.state = 'running'
      this.emit('statechange')
    }
    return Promise.resolve()
  }
  suspend(): Promise<void> {
    if (this.state !== 'suspended') {
      this.state = 'suspended'
      this.emit('statechange')
    }
    return Promise.resolve()
  }
  createGain(): GainNode {
    const node = {
      gain: {
        value: 1,
        cancelScheduledValues: () => {},
        setValueAtTime: (_v: number) => {},
        setTargetAtTime: (v: number) => (node.gain.value = v),
        linearRampToValueAtTime: () => {},
      },
      connect: () => {},
      disconnect: () => {},
    }
    return node as unknown as GainNode
  }
  createBufferSource(): AudioBufferSourceNode {
    const id = this.nextId++
    const ctx = this
    const src = {
      id,
      buffer: null as AudioBuffer | null,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      connect: () => {},
      disconnect: () => {},
      onended: null as null | (() => void),
      start: (_when: number, offset = 0) => ctx.started.push({ id, offset, loopStart: src.loopStart, loopEnd: src.loopEnd }),
      stop: () => ctx.stopped.push(id),
    }
    return src as unknown as AudioBufferSourceNode
  }
  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
    const view = new DataView(bytes)
    const rate = view.getUint32(0)
    const samples = view.getUint32(4)
    const data = new Float32Array(samples)
    data[0] = 0.5
    data[samples - 1] = 0.5
    const buf = {
      duration: samples / rate,
      sampleRate: rate,
      numberOfChannels: 1,
      getChannelData: () => data,
    }
    return Promise.resolve(buf as unknown as AudioBuffer)
  }
  /** Move time on (a suspended context's clock stands still, like a real one). */
  tick(s: number): void {
    if (this.state === 'running') this.currentTime += s
  }
}

class FakeEvents {
  private listeners = new Map<string, Set<() => void>>()
  addEventListener(e: string, fn: () => void): void {
    const set = this.listeners.get(e) ?? new Set()
    set.add(fn)
    this.listeners.set(e, set)
  }
  removeEventListener(e: string, fn: () => void): void {
    this.listeners.get(e)?.delete(fn)
  }
  fire(e: string): void {
    for (const fn of [...(this.listeners.get(e) ?? [])]) fn()
  }
  get listening(): boolean {
    return [...this.listeners.values()].some((s) => s.size > 0)
  }
}

class FakeDoc {
  hidden = false
  private listeners = new Map<string, Set<() => void>>()
  addEventListener(e: string, fn: () => void): void {
    const set = this.listeners.get(e) ?? new Set()
    set.add(fn)
    this.listeners.set(e, set)
  }
  removeEventListener(e: string, fn: () => void): void {
    this.listeners.get(e)?.delete(fn)
  }
  hide(): void {
    this.hidden = true
    for (const fn of [...(this.listeners.get('visibilitychange') ?? [])]) fn()
  }
  show(): void {
    this.hidden = false
    for (const fn of [...(this.listeners.get('visibilitychange') ?? [])]) fn()
  }
}

class MemoryStore {
  data = new Map<string, string>()
  getItem(k: string): string | null {
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v)
  }
}

const song = (rate = 1000, samples = 100_000): ArrayBuffer => {
  const b = new ArrayBuffer(8)
  const v = new DataView(b)
  v.setUint32(0, rate)
  v.setUint32(4, samples)
  return b
}

interface Rig {
  player: MusicPlayer
  ctx: FakeCtx
  events: FakeEvents
  doc: FakeDoc
  store: MemoryStore
  fetched: string[]
  files: Map<string, ArrayBuffer | null>
}

function rig(over: Partial<MusicSettings> = {}, opts: { audio?: boolean } = {}): Rig {
  const ctx = new FakeCtx()
  const events = new FakeEvents()
  const doc = new FakeDoc()
  const store = new MemoryStore()
  if (Object.keys(over).length) saveMusicSettings({ ...MUSIC_DEFAULTS, ...over }, store)
  const files = new Map<string, ArrayBuffer | null>(TRACKS.map((t) => [t.file, song()]))
  const fetched: string[] = []
  const env: MusicEnv = {
    createContext: () => (opts.audio === false ? null : (ctx as unknown as AudioContext)),
    fetchBytes: async (url) => {
      fetched.push(url)
      const b = files.get(url)
      if (!b) throw new Error('missing')
      return b
    },
    store,
    events,
    doc,
  }
  return { player: new MusicPlayer(env), ctx, events, doc, store, fetched, files }
}

/** Let the player's pending promises settle. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

afterEach(() => vi.useRealTimers())

describe('music settings', () => {
  it('default to about half the sound effects’ volume, on, on the title song', () => {
    expect(MUSIC_DEFAULT_VOLUME).toBeGreaterThanOrEqual(SFX.defaultVolume * 0.4)
    expect(MUSIC_DEFAULT_VOLUME).toBeLessThanOrEqual(SFX.defaultVolume * 0.6)
    expect(MUSIC_DEFAULTS).toEqual({ volume: MUSIC_DEFAULT_VOLUME, on: true, track: DEFAULT_TRACK, keepHidden: true, pulse: true })
    expect(TRACKS.find((t) => t.theme)?.id).toBe(DEFAULT_TRACK)
    expect(loadMusicSettings({ getItem: () => null, setItem: () => {} })).toEqual({ ...MUSIC_DEFAULTS })
  })

  it('saves and loads the song, the volume and play/pause, and ignores broken values', () => {
    const store = new MemoryStore()
    saveMusicSettings({ volume: 0.2, on: false, track: 'singularity', keepHidden: false, pulse: false }, store)
    expect(loadMusicSettings(store)).toEqual({ volume: 0.2, on: false, track: 'singularity', keepHidden: false, pulse: false })
    store.setItem(MUSIC_KEY, JSON.stringify({ volume: 7, on: 'yes', track: 'no-such-song' }))
    expect(loadMusicSettings(store)).toEqual({ ...MUSIC_DEFAULTS, volume: 1 })
    store.setItem(MUSIC_KEY, JSON.stringify({ volume: 'loud' }))
    expect(loadMusicSettings(store)).toEqual({ ...MUSIC_DEFAULTS })
    store.setItem(MUSIC_KEY, '{broken')
    expect(loadMusicSettings(store)).toEqual({ ...MUSIC_DEFAULTS })
    expect(loadMusicSettings(null)).toEqual({ ...MUSIC_DEFAULTS })
    expect(loadMusicSettings({ getItem: () => { throw new Error('blocked') }, setItem: () => {} })).toEqual({ ...MUSIC_DEFAULTS })
  })
})

describe('tracks', () => {
  it('has the three Pixabay songs, with pages and files', () => {
    expect(TRACKS.map((t) => t.id)).toEqual(['fartysoup', 'robotic-spaghetti', 'singularity'])
    for (const t of TRACKS) {
      expect(t.page).toMatch(/^https:\/\/pixabay\.com\/music\//)
      expect(t.file).toMatch(/^music\/[\w-]+\.mp3$/)
      expect(t.artist).toBe('Reganati')
    }
    expect(isTrackId('fartysoup')).toBe(true)
    expect(isTrackId('other')).toBe(false)
  })

  it('previous and next wrap around the list', () => {
    expect(stepTrack('fartysoup', 1)).toBe('robotic-spaghetti')
    expect(stepTrack('robotic-spaghetti', 1)).toBe('singularity')
    expect(stepTrack('singularity', 1)).toBe('fartysoup')
    expect(stepTrack('fartysoup', -1)).toBe('singularity')
    expect(stepTrack('singularity', -1)).toBe('robotic-spaghetti')
  })
})

describe('loop points', () => {
  const rate = 10
  const ch = (values: number[]): Float32Array => Float32Array.from(values)
  const loud = (n: number): number[] => Array.from({ length: n }, () => 0.5)
  it('skips only the silence at both ends (an MP3’s padding)', () => {
    const left = ch([0, 0, ...loud(12), 0])
    const right = ch([0, 0, 0, ...loud(11), 0])
    expect(loopPoints([left, right], rate)).toEqual({ start: 0.2, end: 1.4 })
  })
  it('keeps a quiet fade: only near-silence is skipped', () => {
    expect(loopPoints([ch([0.001, ...loud(12), 0.001])], rate)).toEqual({ start: 0, end: 1.4 })
  })
  it('keeps the whole song when there is no padding', () => {
    expect(loopPoints([ch(loud(15))], rate)).toEqual({ start: 0, end: 1.5 })
  })
  it('leaves long silences alone (over half a second at the start, two at the end)', () => {
    const samples = new Float32Array(rate * 6)
    samples[rate * 2] = 0.5
    samples[rate * 3] = 0.5
    expect(loopPoints([samples], rate)).toEqual({ start: 0, end: 6 })
  })
  it('gives up on a song that is silent almost throughout', () => {
    expect(loopPoints([ch([0, 0, 0])], rate)).toEqual({ start: 0, end: 0.3 })
    expect(loopPoints([], rate)).toEqual({ start: 0, end: 0 })
  })
})

describe('MusicPlayer', () => {
  it('plays the default song on boot, from its start, and saves nothing new', async () => {
    const r = rig()
    r.player.boot()
    await flush()
    expect(r.fetched).toEqual(['music/fartysoup.mp3'])
    expect(r.ctx.started).toHaveLength(1)
    expect(r.ctx.started[0].offset).toBe(0)
    expect(r.player.status).toBe('playing')
    expect(r.player.current).toBe('fartysoup')
    expect(r.store.data.size).toBe(0)
  })

  it('waits for the first click when the browser blocks autoplay, then carries on', async () => {
    const r = rig()
    r.ctx.resume = () => Promise.resolve() // the resume is refused: the context stays suspended
    r.player.boot()
    await flush()
    expect(r.player.status).toBe('locked')
    expect(statusText(r.player.status)).toMatch(/click, tap or press/i)
    expect(r.events.listening).toBe(true)
    r.ctx.resume = FakeCtx.prototype.resume.bind(r.ctx)
    r.events.fire('pointerdown')
    await flush()
    expect(r.ctx.state).toBe('running')
    expect(r.player.status).toBe('playing')
    expect(r.events.listening).toBe(false)
  })

  it('keeps playing while the tab is hidden, by default', async () => {
    const r = rig()
    r.player.boot()
    await flush()
    r.ctx.tick(10)
    r.doc.hide()
    expect(r.ctx.state).toBe('running')
    r.ctx.tick(30)
    expect(r.player.position()).toBeCloseTo(40, 5)
    r.doc.show()
    expect(r.ctx.state).toBe('running')
  })

  it('with "keep playing" off it pauses while hidden and resumes when back', async () => {
    const r = rig({ keepHidden: false })
    r.player.boot()
    await flush()
    r.ctx.tick(10)
    expect(r.player.position()).toBeCloseTo(10, 5)
    r.doc.hide()
    expect(r.ctx.state).toBe('suspended')
    r.ctx.tick(30) // hidden time doesn't count
    r.doc.show()
    expect(r.ctx.state).toBe('running')
    expect(r.player.position()).toBeCloseTo(10, 5)
    expect(r.player.settings.on).toBe(true)
  })

  it('switching "keep playing" while hidden takes effect at once, and is saved', async () => {
    const r = rig()
    r.player.boot()
    await flush()
    r.doc.hide()
    r.player.setKeepHidden(false)
    expect(r.ctx.state).toBe('suspended')
    expect(loadMusicSettings(r.store).keepHidden).toBe(false)
    r.player.setKeepHidden(true)
    await flush()
    expect(r.ctx.state).toBe('running')
  })

  it('switches songs live and wraps around, keeping the place after a pause', async () => {
    const r = rig()
    r.player.boot()
    await flush()
    r.ctx.tick(5)
    r.player.next()
    await flush()
    expect(r.player.current).toBe('robotic-spaghetti')
    expect(r.fetched).toEqual(['music/fartysoup.mp3', 'music/robotic-spaghetti.mp3'])
    expect(r.ctx.stopped).toHaveLength(1)
    expect(r.ctx.started.at(-1)?.offset).toBe(0)
    r.ctx.tick(8)
    r.player.pause()
    expect(r.player.settings.on).toBe(false)
    expect(loadMusicSettings(r.store).on).toBe(false)
    r.ctx.tick(20)
    r.player.play()
    await flush()
    expect(r.ctx.started.at(-1)?.offset).toBeCloseTo(8, 5)
  })

  it('saves the default song and the volume, separately from what is playing now', async () => {
    const r = rig()
    r.player.boot()
    await flush()
    r.player.setDefault('singularity')
    r.player.setVolume(0.1)
    expect(loadMusicSettings(r.store)).toEqual({ volume: 0.1, on: true, track: 'singularity', keepHidden: true, pulse: true })
    expect(r.player.current).toBe('fartysoup')
    r.player.reload()
    expect(r.player.settings.track).toBe('singularity')
    expect(r.player.settings.volume).toBeCloseTo(0.1, 5)
  })

  it('a missing file is shown as missing and the game carries on', async () => {
    const r = rig()
    r.files.set('music/fartysoup.mp3', null)
    r.player.boot()
    await flush()
    expect(r.player.status).toBe('missing')
    expect(r.ctx.started).toHaveLength(0)
    r.player.next()
    await flush()
    expect(r.player.current).toBe('robotic-spaghetti')
    expect(r.player.status).toBe('playing')
  })

  it('with no audio at all it stays quiet and never throws', async () => {
    const r = rig({}, { audio: false })
    r.player.boot()
    await flush()
    expect(r.player.status).toBe('no-audio')
    expect(r.fetched).toHaveLength(0)
    r.player.next()
    r.player.setVolume(0.4)
    r.player.pause()
    expect(r.player.status).toBe('no-audio')
  })

  it('a song paused before it starts never downloads anything', async () => {
    const r = rig({ on: false })
    r.player.boot()
    await flush()
    expect(r.player.status).toBe('off')
    expect(r.fetched).toHaveLength(0)
  })
})

describe('the audible position (for the beat pulses)', () => {
  it('is NaN unless music is really audible', async () => {
    const r = rig()
    expect(r.player.audiblePosition(0)).toBeNaN()
    r.player.boot()
    await flush()
    r.ctx.tick(5)
    expect(r.player.audiblePosition(1000)).toBeCloseTo(5, 5)
    r.player.setVolume(0)
    expect(r.player.audiblePosition(1000)).toBeNaN()
    r.player.setVolume(0.4)
    r.player.pause()
    expect(r.player.audiblePosition(1000)).toBeNaN()
  })

  it('takes off the output latency the context reports', async () => {
    const r = rig()
    Object.assign(r.ctx, { outputLatency: 0.05, baseLatency: 0.01 })
    r.player.boot()
    await flush()
    r.ctx.tick(5)
    expect(r.player.audiblePosition(1000)).toBeCloseTo(4.94, 5)
  })

  it('follows getOutputTimestamp, moving with the page clock between samples, and wraps at the loop', async () => {
    const r = rig()
    let perf = 1000
    Object.assign(r.ctx, { getOutputTimestamp: () => ({ contextTime: r.ctx.currentTime - 0.04, performanceTime: perf }) })
    r.player.boot()
    await flush()
    r.ctx.tick(5)
    expect(r.player.audiblePosition(perf)).toBeCloseTo(4.96, 5)
    // 100 ms on, no new sample needed: the page clock carries it.
    r.ctx.tick(0.1)
    perf += 100
    expect(r.player.audiblePosition(perf)).toBeCloseTo(5.06, 5)
    // Past the loop end (the test song loops 0..~100 s).
    r.ctx.tick(100)
    perf += 100_000
    const pos = r.player.audiblePosition(perf)
    expect(pos).toBeGreaterThan(4.9)
    expect(pos).toBeLessThan(5.2)
  })
})
