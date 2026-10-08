import { beforeEach, describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning'
import { BattleSim } from '../src/sim/BattleSim'
import { MirrorBot } from '../src/sim/bots'
import { levelLanes } from '../src/sim/solver'
import { aiDifficulty, bestKind, swapPolicy } from '../src/ai/towerChoice'
import { listMaps, loadDraft, sanitizeLevel, withDifficulty } from '../src/editor/maps'
import type { CannonKind, LevelDef } from '../src/types'

class MemoryStorage {
  private data = new Map<string, string>()
  getItem(k: string): string | null {
    return this.data.has(k) ? (this.data.get(k) as string) : null
  }
  setItem(k: string, v: string): void {
    this.data.set(k, String(v))
  }
  removeItem(k: string): void {
    this.data.delete(k)
  }
  clear(): void {
    this.data.clear()
  }
}

/** Open board: one pink cannon and gold cannons at several distances (none in each other's way). */
function open(kind?: CannonKind): LevelDef {
  return {
    id: 'choice',
    name: 'Choice',
    kind: 'battle',
    walls: [],
    fans: [],
    cannons: [
      { id: 'e1', name: 'E1', x: 100, y: 380, side: 'enemy', kind },
      { id: 'near', name: 'Near', x: 300, y: 380, side: 'player' },
      { id: 'mid', name: 'Mid', x: 800, y: 650, side: 'player' },
      { id: 'far', name: 'Far', x: 1110, y: 120, side: 'player' },
    ],
  }
}

describe('tower type for the job', () => {
  it('close target -> machine gun, far target -> normal, from any starting type', () => {
    for (const start of [undefined, 'sniper', 'machinegun'] as const) {
      const level = open(start)
      const sim = new BattleSim(level, null, {}, levelLanes(level))
      const e1 = sim.byId('e1')!
      expect(bestKind(e1, sim.byId('near')!, sim.lanes, 1.15)).toBe('machinegun')
      expect(bestKind(e1, sim.byId('mid')!, sim.lanes, 1.15)).toBe('normal')
    }
  })

  it('beyond normal range only the sniper reaches, so it goes sniper', () => {
    // 2,000 px away on a Huge board: past the normal 1,530 px, inside the sniper's 3,060 px.
    const level: LevelDef = sanitizeLevel({
      id: 'long', name: 'Long', kind: 'battle', size: 'huge', walls: [], fans: [],
      cannons: [
        { id: 'e1', name: 'E1', x: 200, y: 900, side: 'enemy' },
        { id: 'p1', name: 'P1', x: 2200, y: 900, side: 'player' },
      ],
    })
    const sim = new BattleSim(level, null, {}, levelLanes(level, 2))
    expect(bestKind(sim.byId('e1')!, sim.byId('p1')!, sim.lanes, 1.15)).toBe('sniper')
  })

  it('a cannon about to finish a capture keeps its type (the swap reload would cost more)', () => {
    const level = open()
    const sim = new BattleSim(level, null, {}, levelLanes(level))
    const e1 = sim.byId('e1')!
    const near = sim.byId('near')!
    for (let i = 0; i < 7; i++) near.receiveHit('enemy', 1)
    expect(bestKind(e1, near, sim.lanes, 1.15)).toBe('normal')
  })

  it("Nova's case: a pink sniper healing the cannon right next to it swaps to a machine gun within a few seconds", () => {
    // An old-schema custom map: no kinds on normals, a sniper with the legacy delay field.
    const level = sanitizeLevel(
      withDifficulty(
        {
          id: 'custom-old', name: 'Old', kind: 'battle', size: 'small', walls: [], fans: [],
          cannons: [
            { id: 'p1', name: 'P1', x: 250, y: 400, side: 'player', aimAt: 'e1' },
            { id: 'p2', name: 'P2', x: 250, y: 600, side: 'player', aimAt: 'e1' },
            { id: 'e1', name: 'E1', x: 620, y: 420, side: 'enemy' },
            { id: 'e2', name: 'E2', x: 700, y: 350, side: 'enemy', kind: 'sniper', delay: 3 },
            { id: 'e3', name: 'E3', x: 1050, y: 150, side: 'enemy' },
          ],
        } as LevelDef,
        'normal',
      ),
    )
    const sim = new BattleSim(level, null, {}, levelLanes(level))
    const e2 = sim.byId('e2')!
    let gunAt = -1
    let healedAsGun = false
    while (sim.clock < 8000 && !sim.ended) {
      sim.step(1000 / 60)
      if (gunAt < 0 && e2.kind === 'machinegun') gunAt = sim.clock
      if (e2.kind === 'machinegun' && e2.healing) healedAsGun = true
    }
    expect(gunAt).toBeGreaterThan(0)
    expect(gunAt).toBeLessThan(5000)
    expect(healedAsGun).toBe(true)
  })

  it('no thrash: on a busy map no cannon swaps again before its cooldown unless it could not hit at all', () => {
    const level = withDifficulty(
      {
        id: 'busy', name: 'Busy', kind: 'battle', size: 'medium', walls: [{ x: 700, y: 250, w: 24, h: 300 }], fans: [{ x: 900, y: 700, radius: 160, angle: Math.PI }],
        cannons: [
          { id: 'p1', name: 'P1', x: 150, y: 200, side: 'player' },
          { id: 'p2', name: 'P2', x: 150, y: 450, side: 'player', kind: 'sniper' },
          { id: 'p3', name: 'P3', x: 150, y: 700, side: 'player' },
          { id: 'n1', name: 'N1', x: 500, y: 300, side: 'neutral' },
          { id: 'n2', name: 'N2', x: 600, y: 650, side: 'neutral' },
          { id: 'n3', name: 'N3', x: 1000, y: 450, side: 'neutral' },
          { id: 'e1', name: 'E1', x: 1300, y: 200, side: 'enemy', kind: 'sniper' },
          { id: 'e2', name: 'E2', x: 1300, y: 450, side: 'enemy' },
          { id: 'e3', name: 'E3', x: 1300, y: 700, side: 'enemy' },
        ],
      } as LevelDef,
      'hard',
    )
    const sim = new BattleSim(level, null, {}, levelLanes(level))
    const bot = new MirrorBot(sim)
    const log = new Map<string, { t: number; kind: CannonKind }[]>()
    const kinds = new Map(sim.cannons.map((c) => [c.id, c.kind]))
    while (sim.clock < 120_000 && !sim.ended) {
      bot.update(1000 / 60)
      sim.step(1000 / 60)
      for (const c of sim.cannons) {
        if (kinds.get(c.id) === c.kind) continue
        kinds.set(c.id, c.kind)
        log.set(c.id, [...(log.get(c.id) ?? []), { t: sim.clock, kind: c.kind }])
      }
    }
    const total = [...log.values()].reduce((n, l) => n + l.length, 0)
    expect(total).toBeGreaterThan(0) // types do change during a game
    const minGap = TUNING.aiSwap.cooldownMs / 2
    let quickBounces = 0
    for (const swaps of log.values()) {
      // At most one swap every few seconds on average.
      expect(swaps.length).toBeLessThan(120_000 / 4000)
      for (let i = 2; i < swaps.length; i++) {
        // A -> B -> A inside the cooldown would be a flip-flop.
        if (swaps[i].kind === swaps[i - 2].kind && swaps[i].t - swaps[i - 1].t < minGap) quickBounces++
      }
    }
    expect(quickBounces).toBe(0)
  })

  it('difficulty: every level follows the same swap restraint (difficulty is intelligence only)', () => {
    const policies = (['easy', 'normal', 'hard', 'impossible'] as const).map((d) => swapPolicy(withDifficulty(open(), d)))
    for (const p of policies) expect(p).toEqual(policies[0])
    expect(aiDifficulty(withDifficulty(open(), 'easy'))).toBe('easy')
    expect(aiDifficulty(withDifficulty(open(), 'impossible'))).toBe('impossible')
    // No ai block: the old maps' default fire rate was Hard's.
    expect(aiDifficulty(open())).toBe('hard')
  })
})

describe('old maps', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage()
  })

  const oldLevel = {
    id: 'custom-old1',
    name: 'Before towers',
    kind: 'battle',
    size: 'small',
    cannons: [
      { id: 'p1', name: 'P1', x: 200, y: 300, side: 'player' },
      { id: 'e1', name: 'E1', x: 420, y: 300, side: 'enemy' },
      { id: 'e2', name: 'E2', x: 520, y: 380, side: 'enemy', kind: 'sniper', delay: 2 },
      { id: 'e3', name: 'E3', x: 900, y: 500, side: 'enemy', kind: 'laser' },
    ],
    walls: [],
    fans: [],
    ai: { retargetMs: 1800, fireMs: 1150 },
  }

  it('maps saved before machine guns (and before tower types) load as normal / sniper', () => {
    localStorage.setItem('cannon-capture:maps:v1', JSON.stringify({ maps: [{ level: oldLevel, updated: 1 }] }))
    const [m] = listMaps()
    expect(m.level.cannons.map((c) => [c.id, c.kind ?? 'normal', c.delay])).toEqual([
      ['p1', 'normal', undefined],
      ['e1', 'normal', undefined],
      ['e2', 'sniper', undefined],
      ['e3', 'normal', undefined],
    ])
  })

  it('an old editor draft loads the same way', () => {
    localStorage.setItem('cannon-capture:editor-draft:v1', JSON.stringify({ level: oldLevel, savedId: 'custom-old1' }))
    const d = loadDraft()!
    expect(d.level.cannons.map((c) => c.kind ?? 'normal')).toEqual(['normal', 'normal', 'sniper', 'normal'])
  })

  it('and an old map plays with the new AI choosing types (the close pink cannons go machine gun)', () => {
    localStorage.setItem('cannon-capture:maps:v1', JSON.stringify({ maps: [{ level: oldLevel, updated: 1 }] }))
    const level = listMaps()[0].level
    const sim = new BattleSim(level, null, {}, levelLanes(level))
    const seen = new Set<string>()
    while (sim.clock < 6000 && !sim.ended) {
      sim.step(1000 / 60)
      for (const c of sim.cannons) if (c.side === 'enemy' && c.kind === 'machinegun') seen.add(c.id)
    }
    expect(seen.has('e1')).toBe(true)
  })
})
