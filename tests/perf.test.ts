import { describe, expect, it } from 'vitest'
import { avgMax, browserLabel, fpsLevel, fpsOf, frameLevel, perfReport, Series, summarize, type PerfSnapshot } from '../src/perf/perfStats'
import { isPerfKey, loadPerfShown } from '../src/perf/perfPrefs'
import { BattleSim } from '../src/sim/BattleSim'
import { levelLanes } from '../src/sim/solver'
import { SKIRMISH } from '../src/levels/skirmish'
import { withDifficulty } from '../src/editor/maps'

describe('perf stats', () => {
  it('keeps only recent samples, oldest first, and wraps around', () => {
    const s = new Series(4)
    for (let t = 0; t < 6; t++) s.push(t * 100, t)
    expect(s.length).toBe(4)
    expect(s.since(500, 1000)).toEqual([2, 3, 4, 5])
    expect(s.since(500, 150)).toEqual([4, 5])
    s.clear()
    expect(s.since(500, 1000)).toEqual([])
  })

  it('summarizes frame times: average, 1% low and worst', () => {
    // 198 smooth frames, one hitch of 50 ms and one of 100 ms.
    const frames = [...Array(198).fill(16), 50, 100]
    const f = summarize(frames)!
    expect(f.count).toBe(200)
    expect(f.worst).toBe(100)
    // 1% of 200 frames = the 2 slowest: (100 + 50) / 2.
    expect(f.low1).toBe(75)
    expect(f.avg).toBeCloseTo((198 * 16 + 150) / 200, 6)
    // Fewer than 100 frames: the 1% low is the single slowest frame.
    expect(summarize([10, 20, 30])!.low1).toBe(30)
    expect(summarize([])).toBeNull()
  })

  it('turns frame times into FPS and colours', () => {
    expect(fpsOf(Array(60).fill(1000 / 60))).toBeCloseTo(60, 6)
    expect(fpsOf([])).toBe(0)
    expect(avgMax([1, 3])).toEqual({ avg: 2, max: 3 })
    expect(avgMax([])).toBeNull()
    expect([fpsLevel(144), fpsLevel(60), fpsLevel(55), fpsLevel(45), fpsLevel(30), fpsLevel(20)]).toEqual(['good', 'good', 'good', 'ok', 'ok', 'bad'])
    expect([frameLevel(16.7), frameLevel(25), frameLevel(40)]).toEqual(['good', 'ok', 'bad'])
  })

  it('names browsers and systems for the report', () => {
    expect(browserLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')).toBe('Chrome 141 · Windows')
    expect(browserLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9210 Chrome/134.0.6998.205 Electron/35.3.0 Safari/537.36')).toBe('Discord app 1.0.9210 · Windows')
    expect(browserLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari 18 · iOS')
    expect(browserLabel('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox 131 · Linux')
    expect(browserLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0')).toBe('Edge 141 · macOS')
  })

  it('writes a one-line report', () => {
    const snap: PerfSnapshot = {
      build: 'abc1234 2026-10-08',
      platform: 'web desktop',
      browser: 'Chrome 141 · Windows',
      renderer: 'WebGL',
      gpu: 'ANGLE (NVIDIA)',
      canvas: { w: 2400, h: 1440, cssW: 1200, cssH: 720, dpr: 2 },
      fps: 59.94,
      frame: { count: 300, avg: 16.68, low1: 21.2, worst: 33.4 },
      logic: { avg: 2.1, max: 6 },
      render: { avg: 3.25, max: 8 },
      sim: { avg: 1.5, max: 4 },
      ai: { avg: 0.9, max: 3.1 },
      look: { avg: 0.4, max: 3 },
      counts: { cannons: 40, shots: 31, sounds: 3 },
      context: 'Huge Arena (huge, impossible)',
    }
    const line = perfReport(snap)
    expect(line).not.toContain('\n')
    expect(line).toBe(
      'Cannon Capture perf | build abc1234 2026-10-08 | Huge Arena (huge, impossible) | FPS 59.9 | frame avg 16.7 ms, 1% low 21.2 ms (47 FPS), worst 33.4 ms over 300 frames | logic 2.10/6.00 ms | sim 1.50/4.00 ms (AI 0.90/3.10, look-ahead 0.40/3.00) | render 3.25/8.00 ms | 40 cannons, 31 shots, 3 sounds | canvas 2400x1440 (css 1200x720, DPR 2) | WebGL (ANGLE (NVIDIA)) | web desktop | Chrome 141 · Windows',
    )
    expect(perfReport({ ...snap, counts: { cannons: 1, shots: 0, sounds: 1 } })).toContain('| 1 cannon, 0 shots, 1 sound |')
    expect(perfReport({ ...snap, frame: null, sim: null, ai: null, look: null, counts: null, gpu: null })).toContain('frame - | logic 2.10/6.00 ms | sim - | render 3.25/8.00 ms | no battle')
  })
})

describe('perf toggle', () => {
  it('?perf forces it on; otherwise it is off without saved settings', () => {
    expect(loadPerfShown('?perf')).toBe(true)
    expect(loadPerfShown('?debug&perf=1')).toBe(true)
    expect(loadPerfShown('')).toBe(false)
  })

  it('F3 and backtick toggle, but not while typing or with modifiers', () => {
    const k = (code: string, extra: Partial<KeyboardEvent> = {}) => ({ code, key: code === 'F3' ? 'F3' : '`', ctrlKey: false, altKey: false, metaKey: false, repeat: false, ...extra })
    expect(isPerfKey(k('F3'), false)).toBe(true)
    expect(isPerfKey(k('Backquote'), false)).toBe(true)
    expect(isPerfKey(k('Backquote'), true)).toBe(false)
    expect(isPerfKey(k('F3', { ctrlKey: true }), false)).toBe(false)
    expect(isPerfKey(k('F3', { repeat: true }), false)).toBe(false)
    // None of the game's own keys.
    for (const code of ['KeyT', 'KeyM', 'KeyN', 'KeyR', 'Space', 'Escape', 'KeyW', 'ArrowUp']) expect(isPerfKey({ ...k(code), key: code }, false)).toBe(false)
  })
})

describe('sim timing hooks', () => {
  it('times the AI only when asked', () => {
    const level = withDifficulty(SKIRMISH, 'impossible')
    const sim = new BattleSim(level, null, {}, levelLanes(level))
    for (let i = 0; i < 60; i++) sim.step(16)
    expect(sim.aiMs).toBe(0)
    sim.timeAi = true
    for (let i = 0; i < 120; i++) sim.step(16)
    expect(sim.aiMs).toBeGreaterThan(0)
  })

  it('counts look-ahead time on Impossible', () => {
    const level = withDifficulty(SKIRMISH, 'impossible')
    const sim = new BattleSim(level, null, {}, levelLanes(level))
    for (let i = 0; i < 400 && sim.ai.lookahead.frames === 0; i++) sim.step(16)
    expect(sim.ai.lookahead.frames).toBeGreaterThan(0)
    expect(sim.ai.lookahead.pumpMs).toBeGreaterThan(0)
    // A fork (the look-ahead's own copy) never times anything.
    expect(sim.fork().timeAi).toBeFalsy()
  })
})
