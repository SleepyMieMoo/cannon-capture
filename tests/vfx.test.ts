import { describe, expect, it } from 'vitest'
import { PREF_KEYS } from '../src/menu/prefs'
import { settingsText } from '../src/menu/debugInfo'
import { perfReport, type PerfSnapshot } from '../src/perf/perfStats'
import { FX_DEFAULTS, FX_KEY, SlowWatch, fxConfig, lowEndDevice, parseFxPrefs, resolveQuality } from '../src/render/vfx/fxQuality'
import { FADE_INOUT, FADE_LATE, ParticlePool, type Spawn } from '../src/render/vfx/particlePool'

const desktop = { memoryGb: 8, cores: 8, coarse: false }

describe('effects quality', () => {
  it('starts High on a desktop and Low on a low-end device', () => {
    expect(resolveQuality(FX_DEFAULTS, desktop)).toEqual({ quality: 'high', auto: true })
    expect(resolveQuality(FX_DEFAULTS, {})).toEqual({ quality: 'high', auto: true }) // the browser says nothing
    expect(lowEndDevice({ memoryGb: 2, cores: 8 })).toBe(true)
    expect(lowEndDevice({ cores: 2 })).toBe(true)
    expect(lowEndDevice({ coarse: true, memoryGb: 4, cores: 8 })).toBe(true)
    expect(lowEndDevice({ coarse: true, memoryGb: 8, cores: 8 })).toBe(false)
    expect(lowEndDevice({ coarse: false, memoryGb: 4, cores: 4 })).toBe(false)
    expect(resolveQuality(FX_DEFAULTS, { cores: 2 })).toEqual({ quality: 'low', auto: true })
  })

  it('a pick always wins; a slow device (automatic) starts Low', () => {
    expect(resolveQuality({ choice: 'high', slow: true }, { cores: 2 })).toEqual({ quality: 'high', auto: false })
    expect(resolveQuality({ choice: 'off', slow: false }, desktop)).toEqual({ quality: 'off', auto: false })
    expect(resolveQuality({ choice: null, slow: true }, desktop)).toEqual({ quality: 'low', auto: true })
  })

  it('reads saved prefs safely', () => {
    expect(parseFxPrefs(null)).toEqual(FX_DEFAULTS)
    expect(parseFxPrefs('not json')).toEqual(FX_DEFAULTS)
    expect(parseFxPrefs('{"choice":"ultra","slow":1}')).toEqual(FX_DEFAULTS)
    expect(parseFxPrefs('{"choice":"low","slow":true}')).toEqual({ choice: 'low', slow: true })
  })

  it('Off draws nothing; Low trims High', () => {
    const off = fxConfig('off', false)
    expect(off.particles).toBe(0)
    expect(off.aura || off.shotFx || off.shake || off.recoil).toBeFalsy()
    const high = fxConfig('high', false)
    const low = fxConfig('low', false)
    expect(high.aura && low.aura).toBe(true)
    expect(low.particles).toBeLessThan(high.particles)
    expect(low.perFrame).toBeLessThan(high.perFrame)
    expect(low.shotFx).toBeLessThan(high.shotFx)
    expect(high.shake && high.smoke && high.shotGlow).toBe(true)
    expect(low.shake || low.smoke || low.shotGlow).toBe(false)
  })

  it('Reduce motion keeps the glows but stills shakes and moving effects', () => {
    for (const q of ['high', 'low'] as const) {
      const c = fxConfig(q, true)
      expect(c.aura).toBe(true)
      expect(c.particles).toBeGreaterThan(0)
      expect(c.shake || c.rings || c.recoil || c.wobble || c.auraMotion).toBe(false)
      expect(c.fanAir).toBe(0)
    }
  })

  it('is a preference (Reset forgets it) and shows in debug info and the perf report', () => {
    expect(PREF_KEYS.map((k) => k.key)).toContain(FX_KEY)
    const text = settingsText({ sound: true, volume: 1, perf: false, skin: 'classic', colour: 'gold', difficulty: 'normal', effects: 'low (auto, slow frames)' })
    expect(text.effects).toBe('low (auto, slow frames)')
    const snap = { build: 'x', platform: 'web', browser: 'b', renderer: 'WebGL', gpu: null, canvas: { w: 1, h: 1, cssW: 1, cssH: 1, dpr: 1 }, fps: 60, frame: null, logic: null, render: null, sim: null, ai: null, look: null, counts: { cannons: 8, shots: 20, sounds: 2, fx: 'high', particles: 42 }, context: 'Battle', net: null } as unknown as PerfSnapshot
    expect(perfReport(snap)).toContain('effects high (42 particles)')
  })

  it('the menu demo never goes above Low and never shakes', () => {
    expect(fxConfig('high', false, 'demo')).toEqual(fxConfig('low', false, 'demo'))
    expect(fxConfig('high', false, 'demo').quality).toBe('low')
    expect(fxConfig('high', false, 'demo').shake).toBe(false)
    expect(fxConfig('off', false, 'demo').particles).toBe(0)
  })
})

describe('slow-frame watch (automatic quality)', () => {
  const run = (w: SlowWatch, ms: number, frameMs: number) => {
    let fired = 0
    for (let t = 0; t < ms; t += frameMs) if (w.push(frameMs)) fired++
    return fired
  }
  it('never drops at 60 fps, drops once a window at 30 fps, after the warm-up', () => {
    expect(run(new SlowWatch(), 30_000, 1000 / 60)).toBe(0)
    const w = new SlowWatch()
    expect(run(w, 3000, 1000 / 30)).toBe(0) // warm-up only
    expect(run(w, 5100, 1000 / 30)).toBe(1)
  })
  it('ignores hidden-tab gaps, and starts over on reset', () => {
    const w = new SlowWatch()
    expect(run(w, 20_000, 400)).toBe(0) // every frame is a "gap"
    run(w, 3000, 1000 / 30)
    run(w, 4000, 1000 / 30)
    w.reset()
    expect(run(w, 2900, 1000 / 30)).toBe(0)
  })
})

const spark = (over: Partial<Spawn> = {}): Spawn => ({ x: 0, y: 0, vx: 100, vy: 0, lifeMs: 200, size0: 10, alpha: 1, tint: 0xffffff, tex: 0, ...over })

describe('particle pool', () => {
  it('never holds more than its cap, however many are asked for', () => {
    const p = new ParticlePool(64, 40, 1000)
    for (let i = 0; i < 500; i++) p.spawn(spark())
    expect(p.count).toBe(40)
    expect(p.dropped).toBe(460) // the rest took over the oldest slots
    let alive = 0
    for (let i = 0; i < p.capacity; i++) alive += p.alive[i]
    expect(alive).toBe(40)
  })

  it('starts at most perFrame particles a frame', () => {
    const p = new ParticlePool(100, 100, 10)
    let ok = 0
    for (let i = 0; i < 50; i++) if (p.spawn(spark()) >= 0) ok++
    expect(ok).toBe(10)
    p.step(16)
    for (let i = 0; i < 50; i++) if (p.spawn(spark()) >= 0) ok++
    expect(ok).toBe(20)
  })

  it('moves particles, frees them when their life is over, and reuses the slots', () => {
    const p = new ParticlePool(8)
    const i = p.spawn(spark({ lifeMs: 100, drag: 1 }))
    p.step(50)
    expect(p.x[i]).toBeCloseTo(5, 5)
    p.step(60)
    expect(p.count).toBe(0)
    expect(p.alive[i]).toBe(0)
    expect(p.spawn(spark())).toBeGreaterThanOrEqual(0)
    expect(p.count).toBe(1)
  })

  it('never makes new arrays (no allocation per particle)', () => {
    const p = new ParticlePool(32)
    const arrays = [p.x, p.y, p.vx, p.alive, p.tint]
    for (let f = 0; f < 200; f++) {
      for (let k = 0; k < 10; k++) p.spawn(spark({ lifeMs: 50 + k * 10 }))
      p.step(16)
    }
    expect([p.x, p.y, p.vx, p.alive, p.tint]).toEqual(arrays)
    expect(arrays.every((a, i) => a === [p.x, p.y, p.vx, p.alive, p.tint][i])).toBe(true)
  })

  it('a lower cap (Low, Off) lets the extra particles go at once', () => {
    const p = new ParticlePool(50)
    for (let i = 0; i < 50; i++) p.spawn(spark({ lifeMs: 10_000 }))
    p.setLimits(20, 10)
    expect(p.count).toBe(20)
    p.setLimits(0, 0)
    expect(p.count).toBe(0)
    expect(p.spawn(spark())).toBe(-1)
  })

  it('fades: out to nothing, in-and-out for air, late for debris', () => {
    const p = new ParticlePool(4)
    const a = p.spawn(spark({ lifeMs: 100 }))
    const b = p.spawn(spark({ lifeMs: 100, fade: FADE_INOUT }))
    const c = p.spawn(spark({ lifeMs: 100, fade: FADE_LATE }))
    expect(p.opacity(a)).toBeCloseTo(1, 5)
    expect(p.opacity(b)).toBeCloseTo(0, 5)
    p.step(50)
    expect(p.opacity(b)).toBeCloseTo(1, 5)
    expect(p.opacity(c)).toBe(1)
    p.step(49)
    expect(p.opacity(a)).toBeLessThan(0.05)
    expect(p.opacity(c)).toBeLessThan(0.05)
  })
})
