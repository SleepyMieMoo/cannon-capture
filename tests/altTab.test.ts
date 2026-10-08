import { describe, expect, it, vi } from 'vitest'
import { CatchUp, CATCH_UP } from '../src/sim/catchUp'
import { ResultGate } from '../src/scenes/resultGate'
import { TAB_DEFAULTS, TAB_KEY, loadTabPrefs, saveTabPrefs } from '../src/menu/tabPrefs'
import { cannonsFromResult, outcomeFromResult } from '../src/net/onlineView'
import { settingsText } from '../src/menu/debugInfo'
import { PREF_KEYS } from '../src/menu/prefs'
import { BattleSim, type SimEvents } from '../src/sim/BattleSim'
import { applyOrder } from '../src/sim/orders'
import { SIM_STEP_MS } from '../src/sim/fixedStep'
import { levelLanes } from '../src/sim/solver'
import { withDifficulty } from '../src/editor/maps'
import { PvpClient, PvpHost, flipLevel, joinRoom, type StartMsg } from '../src/net/pvp'
import { loopbackPair } from '../src/net/transport'
import type { LevelDef } from '../src/types'
import { mirrored } from './helpers/arena'

class MemoryStore {
  data = new Map<string, string>()
  getItem(k: string): string | null {
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v)
  }
}

describe('When tabbed out settings', () => {
  it('pause vs AI is on by default, saved, and part of Reset', () => {
    expect(TAB_DEFAULTS.pauseVsAi).toBe(true)
    const store = new MemoryStore()
    expect(loadTabPrefs(store)).toEqual({ pauseVsAi: true })
    saveTabPrefs({ pauseVsAi: false }, store)
    expect(loadTabPrefs(store)).toEqual({ pauseVsAi: false })
    store.setItem(TAB_KEY, '{nope')
    expect(loadTabPrefs(store)).toEqual({ pauseVsAi: true })
    expect(loadTabPrefs(null)).toEqual({ pauseVsAi: true })
    expect(PREF_KEYS.map((k) => k.key)).toContain(TAB_KEY)
  })

  it('shows in Copy debug info', () => {
    const t = settingsText({ sound: true, volume: 0.7, perf: false, skin: 'hex', colour: 'grape', difficulty: 'hard', tabbed: { music: true, pauseVsAi: false } })
    expect(t['tabbed out']).toBe('music keeps playing, vs AI keeps going')
  })
})

describe('ResultGate (the result panel safety net)', () => {
  it('shows the panel once when the round is over, however often it is asked', () => {
    let up = false
    let builds = 0
    const gate = new ResultGate(() => {
      builds++
      up = true
    }, () => up)
    expect(gate.check(null)).toBe(false)
    for (let i = 0; i < 10; i++) gate.check('win') // every frame, the watchdog, refocus...
    expect(builds).toBe(1)
    expect(gate.built).toBe(1)
  })

  it('retries when building fails, and shows again if the panel went away while the round is over', () => {
    let up = false
    let fail = true
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const gate = new ResultGate(() => {
      if (fail) throw new Error('boom')
      up = true
    }, () => up)
    expect(gate.check('lose')).toBe(false)
    expect(gate.failed).toBe(1)
    fail = false
    expect(gate.check('lose')).toBe(true)
    up = false // something destroyed it
    expect(gate.check('lose')).toBe(true)
    expect(gate.built).toBe(2)
    err.mockRestore()
  })

  it('waits while a restart is under way', () => {
    let builds = 0
    const gate = new ResultGate(() => builds++, () => false)
    expect(gate.check('win', true)).toBe(false)
    expect(builds).toBe(0)
  })
})

describe('CatchUp (vs AI with pausing off)', () => {
  it('plays back the time away in fixed steps, a frame budget at a time', () => {
    const c = new CatchUp(10, 60_000)
    c.add(1000)
    let t = 0
    const clock = () => t
    // Each step costs 1 ms of work: a 12 ms budget runs 12 steps per frame.
    const step = () => {
      t += 1
      return true
    }
    expect(c.run(step, clock, 12)).toBe(12)
    expect(c.active).toBe(true)
    let total = 12
    while (c.active) total += c.run(step, clock, 12)
    expect(total).toBe(100)
  })

  it('caps the time played back', () => {
    const c = new CatchUp(SIM_STEP_MS)
    c.add(10 * 60_000)
    expect(c.debtMs).toBe(CATCH_UP.maxMs)
    c.add(-5)
    c.add(NaN)
    expect(c.debtMs).toBe(CATCH_UP.maxMs)
  })

  it('stops when the round ends during catch-up (the rest is dropped)', () => {
    const c = new CatchUp(10)
    c.add(1000)
    let n = 0
    c.run(() => ++n < 30, () => 0, 1e9)
    expect(n).toBe(30)
    expect(c.active).toBe(false)
  })

  it('a real round against the AI that ends during catch-up ends exactly once, silently', () => {
    const level = withDifficulty(mirrored(3), 'impossible')
    let sounds = 0
    const events: SimEvents = { fired: () => sounds++, captured: () => sounds++ }
    const sim = new BattleSim(level, null, events, levelLanes(level))
    sim.startCountdown(3000)
    // You never aim (away the whole time): the AI wins eventually.
    const c = new CatchUp(SIM_STEP_MS)
    let ends = 0
    for (let i = 0; i < 20 && !sim.ended; i++) {
      c.add(60_000)
      c.run(() => {
        sim.step(SIM_STEP_MS)
        return !sim.ended
      }, () => 0, 1e9)
    }
    if (sim.ended) ends++
    expect(sim.ended).not.toBeNull()
    expect(ends).toBe(1)
    expect(c.active).toBe(false)
    expect(sounds).toBeGreaterThan(0) // the round itself ran; the screen mutes them (Sfx.silent)
  })
})

describe('pausing a round that is already decided', () => {
  it('ends it instead of pausing (the win is never stuck behind a pause)', () => {
    const level = withDifficulty(mirrored(3), 'hard')
    const sim = new BattleSim(level, null, {}, levelLanes(level))
    for (let i = 0; i < 10; i++) sim.step(SIM_STEP_MS)
    for (const c of sim.cannons) c.side = 'player'
    expect(sim.pause()).toBe(false)
    expect(sim.paused).toBe(false)
    expect(sim.ended).toBe('win')
  })
})

describe('online result without a final snapshot', () => {
  it('reads the room’s result in this view’s terms', () => {
    // Seat 0 played pink this match, seat 1 gold.
    const sides = ['enemy', 'player'] as const
    const r = { winner: 0 as const, why: 'wipe' as const, cannons: [7, 0] as [number, number] }
    expect(outcomeFromResult(r, sides, 'enemy')).toBe('win')
    expect(outcomeFromResult(r, sides, 'player')).toBe('lose')
    expect(outcomeFromResult({ ...r, winner: null }, sides, 'player')).toBe('draw')
    expect(outcomeFromResult(null, sides, 'player')).toBeNull()
    expect(outcomeFromResult(r, undefined, 'player')).toBeNull()
    expect(cannonsFromResult(r, sides, 'enemy')).toEqual({ mine: 7, theirs: 0 })
    expect(cannonsFromResult(r, sides, 'player')).toEqual({ mine: 0, theirs: 7 })
  })
})

describe('second player back from a hidden tab', () => {
  function setup(level: LevelDef) {
    const [hostEnd, clientEnd] = loopbackPair()
    const host = new PvpHost(hostEnd, level, 'match-h', 'enemy', SIM_STEP_MS)
    const sim = new BattleSim(level, null, host.log.tap({}), levelLanes(level))
    sim.makePvp()
    host.attach(sim)
    for (const c of sim.cannons) {
      if (c.side === 'neutral') continue
      const foe = sim.cannons.find((o) => o.side !== c.side && o.side !== 'neutral')!
      applyOrder(sim, c.side, { t: 'aim', cannon: c.id, at: { cannon: foe.id } })
    }
    let start: StartMsg | null = null
    const cancel = joinRoom(clientEnd, (s) => (start = s), () => {})
    hostEnd.flush()
    clientEnd.flush()
    cancel()
    const t = { now: 0 }
    const client = new PvpClient(clientEnd, start!, true, false, () => t.now)
    const view = new BattleSim(flipLevel(start!.level), null, {}, levelLanes(flipLevel(start!.level)))
    view.makePvp()
    const step = () => {
      t.now += SIM_STEP_MS
      sim.step(SIM_STEP_MS)
      host.stepped()
      clientEnd.flush()
    }
    return { host, sim, client, view, step, clientEnd }
  }

  it('drops every missed event on return (nothing replayed) and shows the live round', () => {
    const { host, sim, client, view, step } = setup(withDifficulty(mirrored(3), 'hard'))
    let replayed = 0
    const handlers: SimEvents = { fired: () => replayed++, bounce: () => replayed++, hit: () => replayed++, captured: () => replayed++ }
    for (let i = 0; i < 120; i++) {
      step()
      client.update(view, handlers, SIM_STEP_MS)
    }
    for (let i = 0; i < 60 * 20 && !sim.ended; i++) step()
    expect(client.pending).toBeGreaterThan(50)
    replayed = 0
    client.resync()
    client.update(view, handlers, SIM_STEP_MS)
    expect(replayed).toBe(0)
    expect(client.pending).toBe(0)
    expect(sim.clock - view.clock).toBeLessThan(250)
    host.close(false)
  })

  it('a match that ended while hidden is over on the first look back (the watchdog’s update)', () => {
    const { host, sim, client, view, step, clientEnd } = setup(withDifficulty(mirrored(3), 'hard'))
    for (let i = 0; i < 60; i++) step()
    client.update(view, {}, SIM_STEP_MS)
    sim.endMatch('win')
    host.sendSnap() // the host's frame() keeps snapshots coming once it's over
    clientEnd.flush()
    expect(view.ended).toBeNull()
    client.resync()
    client.update(view, {}, 0)
    // Gold won; this view is pink's (flipped), so it's a loss here.
    expect(view.ended).toBe('lose')
    host.close(false)
  })
})
