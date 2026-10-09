import { describe, expect, it } from 'vitest'
import { PVP_RULES } from '../src/config/pvpRules'
import { DEFAULT_SETTINGS, PVP_MAPS, parseClientMsg, readSettings } from '../src/net/online'
import { netLine, pauseButton, pauseLockMs, pauseCheck, pauseLabel, pauseSecondsLeft } from '../src/net/onlineView'
import type { SnapExtra } from '../src/net/snapshot'
import { LOOP_MS } from '../server/src/room'
import { setup, type FakeConn } from './helpers/fakeRoom'

const TOKEN_A = 'token-aaaaaaaa'
const TOKEN_B = 'token-bbbbbbbb'

function started(settings: Record<string, unknown> = {}) {
  const s = setup()
  const a = s.join(TOKEN_A, 'A')
  const b = s.join(TOKEN_B, 'B')
  const w = s.join('token-wwwwwwww', 'W')
  a.say({ t: 'map', id: PVP_MAPS[0].id })
  if (Object.keys(settings).length) a.say({ t: 'settings', ...settings })
  a.say({ t: 'start' })
  s.run(PVP_RULES.countdownMs + LOOP_MS)
  // Nothing changes hands (long tests must not end in a wipe): every cannon holds its fire.
  const sim = s.room.match!.sim
  for (const c of sim.cannons) {
    c.setTarget(null)
    c.setAimPoint({ x: c.x, y: 2 })
  }
  sim.setAutoTarget(false, 'player')
  sim.setAutoTarget(false, 'enemy')
  let seq = 0
  const order = (c: FakeConn, o: unknown) => {
    c.say({ t: 'order', seq: ++seq, o })
    return c.last('ack').ok as boolean
  }
  return { ...s, a, b, w, order }
}

describe('room setting: pauses per player', () => {
  it('defaults: unlimited pauses, 5 s each', () => {
    expect(DEFAULT_SETTINGS).toEqual({ countdown: 3, pauses: true, pauseCount: null, pauseLimit: true, pauseSecs: 5 })
  })

  it('the server enforces the count per player per match, and everyone sees what is left', () => {
    const { a, b, w, order, room } = started({ pauseCount: 2 })
    expect(a.snap.x!.pl).toEqual([2, 2])
    for (let i = 0; i < 2; i++) {
      expect(order(a, { t: 'pause' })).toBe(true)
      expect(order(a, { t: 'resume' })).toBe(true)
    }
    expect(order(a, { t: 'pause' })).toBe(false)
    expect(room.match!.sim.paused).toBe(false)
    for (const c of [a, b, w]) expect(c.snap.x!.pl).toEqual([0, 2])
    // B's are their own.
    expect(order(b, { t: 'pause' })).toBe(true)
    expect(b.snap.x!.pl).toEqual([0, 1])
  })

  it('unlimited: pause as often as you like, at a sane pace (sent as -1)', () => {
    const { a, order, run } = started({ pauseCount: null })
    for (let i = 0; i < 12; i++) {
      expect(order(a, { t: 'pause' }), `pause ${i}`).toBe(true)
      expect(order(a, { t: 'resume' })).toBe(true)
      run(16_000)
    }
    expect(a.snap.x!.pl).toEqual([-1, -1])
  })

  it('the count carries to rematches (a fresh count each match)', () => {
    const { a, b, order, room, run } = started({ pauseCount: 1 })
    expect(order(a, { t: 'pause' })).toBe(true)
    expect(order(a, { t: 'resume' })).toBe(true)
    expect(order(a, { t: 'pause' })).toBe(false)
    for (const c of room.match!.sim.cannons) if (c.side === 'enemy') c.side = 'player'
    run(200)
    a.say({ t: 'rematch', on: true })
    b.say({ t: 'rematch', on: true })
    run(PVP_RULES.countdownMs + 200)
    expect(room.match!.pausesLeft).toEqual([1, 1])
  })

  it('pauses off beats the count: nobody can pause', () => {
    const { a, order } = started({ pauses: false, pauseCount: 5 })
    expect(order(a, { t: 'pause' })).toBe(false)
    expect(a.snap.x!.pl).toEqual([0, 0])
  })
})

describe('room setting: pause time limit', () => {
  it('on (default 5 s): resumes by itself, with the seconds left on both screens and for watchers', () => {
    const { a, b, w, order, run, room } = started()
    expect(order(a, { t: 'pause' })).toBe(true)
    for (const c of [a, b, w]) {
      expect(c.snap.paused).toBe(true)
      expect(c.snap.x!.pzl).toBeGreaterThan(4500)
      expect(c.snap.x!.pzl).toBeLessThanOrEqual(5000)
    }
    run(2000)
    expect(pauseSecondsLeft(b.snap.x)).toBe(3)
    expect(order(b, { t: 'resume' })).toBe(false)
    run(3200)
    expect(room.match!.sim.paused).toBe(false)
    for (const c of [a, b, w]) expect(c.snap.paused).toBeFalsy()
  })

  it('the pauser can still resume early', () => {
    const { a, order, room } = started({ pauseSecs: 60 })
    expect(order(a, { t: 'pause' })).toBe(true)
    expect(a.snap.x!.pzl).toBeGreaterThan(59_000)
    expect(order(a, { t: 'resume' })).toBe(true)
    expect(room.match!.sim.paused).toBe(false)
  })

  it('off: a pause lasts until its player resumes (pzl -1), with a safety cap', () => {
    const { a, b, order, run, room } = started({ pauseLimit: false })
    expect(order(a, { t: 'pause' })).toBe(true)
    run(120_000)
    expect(room.match!.sim.paused).toBe(true)
    expect(b.snap.x!.pzl).toBe(-1)
    expect(pauseSecondsLeft(b.snap.x)).toBeNull()
    expect(order(a, { t: 'resume' })).toBe(true)
    expect(room.match!.sim.paused).toBe(false)
    // Never forever.
    expect(order(a, { t: 'pause' })).toBe(true)
    run(PVP_RULES.pauseSafetyMs + 500)
    expect(room.match!.sim.paused).toBe(false)
  })
})

describe('pause settings: sync, validation, reconnects', () => {
  it('only the host sets them, between matches; guest and watchers see each change', () => {
    const s = setup()
    const a = s.join(TOKEN_A, 'A')
    const b = s.join(TOKEN_B, 'B')
    const w = s.join('token-wwwwwwww', 'W')
    b.say({ t: 'settings', pauseCount: 3 })
    expect(b.last('error').code).toBe('notallowed')
    a.say({ t: 'settings', pauseCount: 3 })
    a.say({ t: 'settings', pauseLimit: false })
    a.say({ t: 'settings', pauseSecs: 30 })
    for (const c of [a, b, w]) expect(c.room_.settings).toEqual({ ...DEFAULT_SETTINGS, pauseCount: 3, pauseLimit: false, pauseSecs: 30 })
    a.say({ t: 'settings', pauseCount: null })
    expect(w.room_.settings!.pauseCount).toBeNull()
    a.say({ t: 'start' })
    a.say({ t: 'settings', pauseCount: 1 })
    expect(a.last('error').code).toBe('notallowed')
    expect(s.room.settings().pauseCount).toBeNull()
  })

  it('refuses bad values, and old saved rooms read as the defaults', () => {
    for (const bad of [0, 11, 2.5, '3', -1]) expect(parseClientMsg({ t: 'settings', pauseCount: bad })).toBeNull()
    for (const bad of [7, 0, '5', null]) expect(parseClientMsg({ t: 'settings', pauseSecs: bad })).toBeNull()
    expect(parseClientMsg({ t: 'settings', pauseLimit: 'yes' })).toBeNull()
    expect(parseClientMsg({ t: 'settings', pauseCount: null, pauseLimit: false, pauseSecs: 15 })).toEqual({ t: 'settings', pauseCount: null, pauseLimit: false, pauseSecs: 15 })
    expect(parseClientMsg({ t: 'settings', pauseCount: 10 })).toEqual({ t: 'settings', pauseCount: 10 })
    expect(readSettings({ countdown: 5, pauses: false })).toEqual({ ...DEFAULT_SETTINGS, countdown: 5, pauses: false })
  })

  it('a player who reconnects mid-pause gets the room settings, pauses left and the pause countdown', () => {
    const { a, b, order, run, join } = started({ pauseCount: 3, pauseSecs: 10 })
    expect(order(b, { t: 'pause' })).toBe(true)
    run(3000)
    a.drop()
    const back = join(TOKEN_A, 'A')
    expect(back.room_.settings).toMatchObject({ pauseCount: 3, pauseLimit: true, pauseSecs: 10 })
    expect(back.snap.paused).toBe(true)
    expect(back.snap.x!.pl).toEqual([3, 2])
    expect(pauseSecondsLeft(back.snap.x)).toBe(7)
    run(7300)
    expect(back.snap.paused).toBeFalsy()
  })
})

describe('the Pause button and banner', () => {
  const info = null
  const x = (over: Partial<SnapExtra> = {}): SnapExtra => ({ tl: 100_000, pz: -1, pzl: 0, pl: [2, -1], ai: [0, 0], on: [1, 1], ...over })
  it('shows pauses left, greys out when there are none, and says unlimited', () => {
    expect(pauseButton(x(), 0, false, info)).toEqual({ label: 'Pause (2)', title: 'Pause the match (Space): 2 pauses left.', disabled: false })
    expect(pauseButton(x({ pl: [0, -1] }), 0, false, info)).toEqual({ label: 'Pause', title: 'No pauses left this match.', disabled: true })
    expect(pauseButton(x(), 1, false, info)).toEqual({ label: 'Pause', title: 'Pause the match (Space): unlimited pauses.', disabled: false })
    expect(pauseCheck('pause', x({ pl: [0, -1] }), 0, false, info).ok).toBe(false)
    expect(pauseCheck('pause', x({ pl: [0, -1] }), 1, false, info).ok).toBe(true)
    expect(netLine(x(), 1, 50)).toBe('unlimited pauses  ·  50 ms')
  })
  it('the banner counts down with a limit, and says so without one', () => {
    expect(pauseLabel(x({ pz: 1, pzl: 4200 }), 0, info)).toContain('resumes in 5 s')
    expect(pauseLabel(x({ pz: 1, pzl: -1 }), 0, info)).toContain('until Player 2 resumes')
    expect(pauseLabel(x({ pz: 0, pzl: -1 }), 0, info)).toContain('no time limit')
    expect(pauseCheck('resume', x({ pz: 1, pzl: -1 }), 0, true, info).why).toContain('no time limit')
  })
})

describe('pause anti-spam (even with unlimited pauses)', () => {
  const { count, windowMs, lockoutMs } = PVP_RULES.pauseSpam
  it('the numbers: 10 pauses within 30 s (wall clock) gives a 60 s lockout', () => {
    expect(PVP_RULES.pauseSpam).toEqual({ count: 10, windowMs: 30_000, lockoutMs: 60_000 })
  })

  it(`${count} pauses within the window: no pausing for the lockout, counted from when that pause ends; the other player is not affected`, () => {
    const { a, b, w, order, run, room } = started({ pauseCount: null })
    for (let i = 0; i < count; i++) {
      expect(order(a, { t: 'pause' })).toBe(true)
      run(1000)
      expect(order(a, { t: 'resume' })).toBe(true)
      run(1000)
    }
    expect(order(a, { t: 'pause' })).toBe(false)
    expect(room.match!.sim.paused).toBe(false)
    const lock = pauseLockMs(a.snap.x, 0)
    expect(lock).toBeGreaterThan(lockoutMs - 1500)
    expect(lock).toBeLessThanOrEqual(lockoutMs)
    expect(w.snap.x!.plk).toEqual(a.snap.x!.plk)
    // What the Pause button shows.
    const btn = pauseButton(a.snap.x, 0, false, null)
    expect(btn.disabled).toBe(true)
    expect(btn.title).toMatch(/^Pausing too fast, wait 0:5\d$/)
    expect(pauseButton({ ...a.snap.x!, plk: [60_000, 0] }, 0, false, null).title).toBe('Pausing too fast, wait 1:00')
    expect(pauseCheck('pause', a.snap.x, 0, false, null).why).toMatch(/Pausing too fast/)
    // B can still pause.
    expect(order(b, { t: 'pause' })).toBe(true)
    expect(order(b, { t: 'resume' })).toBe(true)
    run(lockoutMs - 1000)
    expect(order(a, { t: 'pause' })).toBe(true)
  })

  it('spread out (fewer than the count in any 30 s) never locks', () => {
    const { a, order, run } = started({ pauseCount: null })
    for (let i = 0; i < 8; i++) {
      expect(order(a, { t: 'pause' }), `pause ${i}`).toBe(true)
      expect(order(a, { t: 'resume' })).toBe(true)
      run(windowMs / (count - 1) + 500)
    }
  })

  it('a spammed pause that runs to its time limit locks from its end', () => {
    const { a, order, run } = started({ pauseCount: null, pauseSecs: 10 })
    for (let i = 0; i < count - 1; i++) {
      expect(order(a, { t: 'pause' })).toBe(true)
      expect(order(a, { t: 'resume' })).toBe(true)
    }
    expect(order(a, { t: 'pause' })).toBe(true)
    run(10_000 + 200)
    expect(a.snap.paused).toBeFalsy()
    expect(pauseLockMs(a.snap.x, 0)).toBeGreaterThan(lockoutMs - 600)
  })

  it('the window is wall-clock time: time spent paused counts (the match clock stands still then)', () => {
    const { a, order, run, room } = started({ pauseCount: null, pauseLimit: false })
    expect(order(a, { t: 'pause' })).toBe(true)
    const clockAt = room.match!.sim.clock
    run(windowMs + 1000) // paused all along: no match time passes
    expect(room.match!.sim.clock).toBe(clockAt)
    expect(order(a, { t: 'resume' })).toBe(true)
    // That first pause is now outside the window: count - 1 quick ones more never lock.
    for (let i = 0; i < count - 1; i++) {
      expect(order(a, { t: 'pause' }), `pause ${i}`).toBe(true)
      expect(order(a, { t: 'resume' })).toBe(true)
    }
    expect(pauseLockMs(a.snap.x, 0)).toBe(0)
    // One more within the window does.
    expect(order(a, { t: 'pause' })).toBe(true)
    expect(order(a, { t: 'resume' })).toBe(true)
    expect(pauseLockMs(a.snap.x, 0)).toBeGreaterThan(lockoutMs - 1000)
    expect(order(a, { t: 'pause' })).toBe(false)
  })

  it('a reconnect sees the lockout', () => {
    const { a, order, join } = started({ pauseCount: null })
    for (let i = 0; i < count; i++) {
      expect(order(a, { t: 'pause' })).toBe(true)
      expect(order(a, { t: 'resume' })).toBe(true)
    }
    a.drop()
    const back = join(TOKEN_A, 'A')
    expect(pauseLockMs(back.snap.x, 0)).toBeGreaterThan(lockoutMs - 1000)
  })
})
