import { afterEach, describe, expect, it } from 'vitest'
import { SFX } from '../src/config/sfx'
import { PopPlanner, type PopRequest } from '../src/audio/popPlanner'
import { loadAudioSettings, saveAudioSettings } from '../src/audio/audioSettings'
import { BattleSim } from '../src/sim/BattleSim'
import { levelLanes } from '../src/sim/solver'
import type { CannonKind, LevelDef } from '../src/types'

const VIEW = { x: 24, y: 88, w: 1152, h: 608 }
const req = (over: Partial<PopRequest> = {}): PopRequest => ({ kind: 'normal', source: 'p1', side: 'player', x: 600, y: 400, now: 0, view: VIEW, zoom: 1, ...over })
const mid = () => 0.5 // no detune

describe('sound config', () => {
  it('per-type loudness and pitch: sniper louder and deeper, machine gun ~30-40% and higher', () => {
    const { normal, sniper, machinegun } = SFX.shot
    expect(sniper.volume).toBeGreaterThan(normal.volume)
    expect(sniper.volume).toBeLessThan(normal.volume * 1.5)
    expect(sniper.rate).toBeLessThan(normal.rate)
    expect(sniper.rate).toBeGreaterThan(0.7)
    expect(machinegun.volume / normal.volume).toBeGreaterThanOrEqual(0.3)
    expect(machinegun.volume / normal.volume).toBeLessThanOrEqual(0.4)
    expect(machinegun.rate).toBeGreaterThan(normal.rate)
    expect(machinegun.jitterCents).toBeGreaterThan(normal.jitterCents)
    expect(SFX.shot).not.toHaveProperty('shield')
  })

  it('every volume stays in 0..1 and every rate is a sane playback rate', () => {
    for (const s of [...Object.values(SFX.shot), SFX.capture, SFX.shieldBreak]) {
      expect(s.volume).toBeGreaterThanOrEqual(0)
      expect(s.volume).toBeLessThanOrEqual(1)
      expect(s.rate).toBeGreaterThan(0.4)
      expect(s.rate).toBeLessThan(2)
    }
  })
})

describe('PopPlanner', () => {
  it('plays a pop at the configured volume and rate, detuned within ±jitter', () => {
    const p = new PopPlanner(SFX, mid)
    const plan = p.plan(req())!
    expect(plan.volume).toBeCloseTo(SFX.shot.normal.volume, 6)
    expect(plan.rate).toBe(SFX.shot.normal.rate)
    expect(plan.detune).toBe(0)
    let seed = 0
    const spread = new PopPlanner(SFX, () => ((seed = (seed * 9301 + 49297) % 233280) / 233280))
    const detunes = new Set<number>()
    for (let i = 0; i < 40; i++) {
      const pl = spread.plan(req({ kind: 'machinegun', source: 'm' + i, now: i * 1000 }))!
      expect(Math.abs(pl.detune)).toBeLessThanOrEqual(SFX.shot.machinegun.jitterCents)
      detunes.add(pl.detune)
    }
    expect(detunes.size).toBeGreaterThan(20)
  })

  it('rate-limits each cannon', () => {
    const p = new PopPlanner(SFX, mid)
    expect(p.plan(req({ kind: 'machinegun', now: 0 }))).not.toBeNull()
    expect(p.plan(req({ kind: 'machinegun', now: SFX.sourceGapMs - 1 }))).toBeNull()
    expect(p.plan(req({ kind: 'machinegun', now: SFX.sourceGapMs + 1 }))).not.toBeNull()
    expect(p.stats.skipped.source).toBe(1)
  })

  it('merges many machine guns into a patter (kind gap)', () => {
    const p = new PopPlanner(SFX, mid)
    let played = 0
    // 10 machine guns all firing within the same 1 s, every 200 ms, offset by 20 ms.
    for (let t = 0; t < 1000; t += 200) for (let i = 0; i < 10; i++) if (p.plan(req({ kind: 'machinegun', source: 'mg' + i, now: t + i * 20 }))) played++
    expect(played).toBeLessThanOrEqual(Math.ceil(1000 / SFX.kindGapMs.machinegun))
    expect(played).toBeGreaterThan(5)
  })

  it('caps simultaneous pops; a clearly louder pop takes the quietest voice', () => {
    const p = new PopPlanner(SFX, mid)
    // Pink snipers all at once (no kind gap for snipers).
    for (let i = 0; i < SFX.maxVoices; i++) expect(p.plan(req({ kind: 'sniper', source: 'e' + i, side: 'enemy', now: 0 }))).not.toBeNull()
    const t = 10
    expect(p.playing(t)).toBe(SFX.maxVoices)
    // Another quiet one: dropped.
    expect(p.plan(req({ kind: 'machinegun', source: 'mg', side: 'enemy', now: t }))).toBeNull()
    expect(p.stats.skipped.voices).toBe(1)
    // Your sniper: louder, so it steals.
    const sn = p.plan(req({ kind: 'sniper', source: 's', now: t }))!
    expect(sn.steal).not.toBeNull()
    expect(p.playing(t)).toBe(SFX.maxVoices)
    expect(p.stats.stolen).toBe(1)
    // Voices end when the sample does (longer when pitched down).
    expect(p.playing(t + SFX.sampleMs / SFX.shot.sniper.rate + 1)).toBe(0)
  })

  it('lowers new pops while others play (crowd)', () => {
    const p = new PopPlanner(SFX, mid)
    const a = p.plan(req({ source: 'a' }))!
    const b = p.plan(req({ source: 'b', now: 30 }))!
    expect(b.volume).toBeCloseTo(a.volume / (1 + SFX.crowd), 6)
  })

  it('other sides are quieter; off-screen fades; zoomed out is quieter', () => {
    const p = new PopPlanner(SFX, mid)
    const base = p.gain(req())
    expect(p.gain(req({ side: 'enemy' }))).toBeCloseTo(base * SFX.otherSideGain, 6)
    expect(p.gain(req({ x: VIEW.x + VIEW.w + SFX.offscreen.fadePx / 2 }))).toBeCloseTo(base * (1 - (1 - SFX.offscreen.gain) / 2), 6)
    expect(p.gain(req({ x: 5000 }))).toBeCloseTo(base * SFX.offscreen.gain, 6)
    expect(p.gain(req({ zoom: 0.5 }))).toBeCloseTo(base * (SFX.zoomedOutMin + (1 - SFX.zoomedOutMin) * 0.5), 6)
    // Captures keep their volume whoever flipped (you want to hear yours being taken).
    expect(p.gain(req({ kind: 'capture', side: 'enemy' }))).toBeCloseTo(SFX.capture.volume, 6)
  })

  it('pans by position in view', () => {
    const p = new PopPlanner(SFX, mid)
    expect(p.plan(req({ source: 'l', x: VIEW.x }))!.pan).toBeCloseTo(-SFX.pan, 6)
    expect(p.plan(req({ source: 'r', x: VIEW.x + VIEW.w, now: 100 }))!.pan).toBeCloseTo(SFX.pan, 6)
    expect(p.plan(req({ source: 'c', x: VIEW.x + VIEW.w / 2, now: 200 }))!.pan).toBeCloseTo(0, 6)
  })
})

describe('shot events', () => {
  const level: LevelDef = {
    id: 'sfx',
    name: 'Sfx',
    kind: 'battle',
    walls: [],
    fans: [],
    cannons: [
      { id: 'p1', name: 'P1', x: 200, y: 200, side: 'player', kind: 'normal', aimPoint: { x: 400, y: 200 } },
      { id: 'p2', name: 'P2', x: 200, y: 400, side: 'player', kind: 'sniper', aimPoint: { x: 400, y: 400 } },
      { id: 'p3', name: 'P3', x: 200, y: 600, side: 'player', kind: 'machinegun', aimPoint: { x: 400, y: 600 } },
      { id: 'p4', name: 'P4', x: 300, y: 300, side: 'player', kind: 'shield', aimPoint: { x: 400, y: 300 } },
      { id: 'e1', name: 'E1', x: 1000, y: 400, side: 'enemy' },
    ],
  }

  it('reports every shot with its cannon and type; no shot from a shield; none while paused', () => {
    const fired: CannonKind[] = []
    const sim = new BattleSim(level, null, { fired: (c, shot) => (expect(shot.kind).toBe(c.kind), fired.push(c.kind)) }, levelLanes(level))
    ;(sim as unknown as { aiOff: boolean }).aiOff = true
    for (let i = 0; i < 60 * 4; i++) sim.step(1000 / 60)
    const count = (k: CannonKind) => fired.filter((x) => x === k).length
    expect(count('machinegun')).toBeGreaterThan(count('normal'))
    expect(count('normal')).toBeGreaterThan(count('sniper'))
    expect(count('sniper')).toBeGreaterThan(0)
    expect(count('shield')).toBe(0)
    const n = fired.length
    sim.pause()
    for (let i = 0; i < 120; i++) sim.step(1000 / 60)
    expect(fired.length).toBe(n)
    // Look-ahead copies play silently.
    const copy = sim.fork()
    copy.paused = false
    for (let i = 0; i < 120; i++) copy.step(1000 / 60)
    expect(fired.length).toBe(n)
  })
})

describe('sound settings', () => {
  const g = globalThis as unknown as { window?: unknown }
  const had = 'window' in g
  const before = g.window
  afterEach(() => {
    if (had) g.window = before
    else delete g.window
  })

  it('remembers volume and mute on the device, with safe fallbacks', () => {
    const store = new Map<string, string>()
    g.window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } }
    expect(loadAudioSettings()).toEqual({ volume: SFX.defaultVolume, muted: false })
    saveAudioSettings({ volume: 0.35, muted: true })
    expect(loadAudioSettings()).toEqual({ volume: 0.35, muted: true })
    store.set('cannon-capture:audio:v1', '{"volume": 7, "muted": "yes"}')
    expect(loadAudioSettings()).toEqual({ volume: 1, muted: false })
    store.set('cannon-capture:audio:v1', 'not json')
    expect(loadAudioSettings()).toEqual({ volume: SFX.defaultVolume, muted: false })
  })
})
