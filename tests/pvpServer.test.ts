import { describe, expect, it } from 'vitest'
import { PVP_LIMITS, PVP_RULES } from '../src/config/pvpRules'
import { DEFAULT_SETTINGS, PVP_MAPS, isRoomCode, normaliseCode, parseClientMsg, cleanName, randomCode } from '../src/net/online'
import { mirrored } from '../src/levels/mirrored'
import { LOOP_MS, RoomCore, type RoomState } from '../server/src/room'

import { FakeHost, FakeConn, setup } from './helpers/fakeRoom'

const TOKEN_A = 'token-aaaaaaaa'
const TOKEN_B = 'token-bbbbbbbb'

describe('online room: lobby', () => {
  it('seats two players, the first is host and picks the map, the third watches', () => {
    const { room, join, host } = setup()
    expect(room.init('ABCD')).toBe(false)
    const a = join(TOKEN_A, 'Nova')
    expect(a.room_.you).toEqual({ seat: 0, host: true })
    const b = join(TOKEN_B, 'Friend')
    expect(b.room_.you).toEqual({ seat: 1, host: false })
    expect(a.room_.seats.map((s) => s?.name)).toEqual(['Nova', 'Friend'])
    const c = join('token-cccccccc', 'Watcher')
    expect(c.room_.you.seat).toBeNull()
    expect(a.room_.spectators).toBe(1)
    // Only the host picks the map, and only a PvP map.
    b.say({ t: 'map', id: PVP_MAPS[1].id })
    expect(b.last('error').code).toBe('notallowed')
    a.say({ t: 'map', id: 'huge-thing' })
    a.say({ t: 'map', id: PVP_MAPS[2].id })
    expect(b.room_.map).toBe(PVP_MAPS[2].id)
    expect(host.saved?.map).toBe(PVP_MAPS[2].id)
    // The guest can't start; the host can.
    b.say({ t: 'start' })
    expect(host.loop).toBeNull()
    a.say({ t: 'start' })
    expect(host.loop).not.toBeNull()
    expect(a.last('start').side).toBe('player')
    expect(b.last('start').side).toBe('enemy')
    expect(c.last('start')).toMatchObject({ side: 'player', spectate: true })
    expect(a.room_.phase).toBe('playing')
  })

  it("a code that isn't a room is refused", () => {
    const host = new FakeHost()
    const room = new RoomCore(host, null)
    const c = new FakeConn(host, room)
    expect(c.last('error').code).toBe('noroom')
    expect(c.closed?.code).toBe(4404)
  })

  it('the host leaving hands the host to the other player; the room lives on while anyone is in it', () => {
    const { join, host, room } = setup()
    const a = join(TOKEN_A, 'A')
    const b = join(TOKEN_B, 'B')
    a.say({ t: 'leave' })
    expect(a.closed?.code).toBe(1000)
    expect(b.room_.you).toEqual({ seat: 1, host: true })
    expect(b.room_.seats[0]).toBeNull()
    // A newcomer takes the free seat.
    const c = join('token-cccccccc', 'C')
    expect(c.room_.you).toEqual({ seat: 0, host: false })
    expect(room.state).not.toBeNull()
    // Everyone gone: deleted once the empty time passes (on the alarm).
    b.say({ t: 'leave' })
    c.drop()
    expect(host.alarm).not.toBeNull()
    host.t += PVP_LIMITS.emptyRoomMs + 1
    room.onAlarm()
    expect(room.state).toBeNull()
    expect(host.saved).toBeNull()
  })

  it('a reload in the same tab (same token) gets the seat back; a dropped seat is freed after the grace time', () => {
    const { join, host, room } = setup()
    const a = join(TOKEN_A, 'A')
    join(TOKEN_B, 'B')
    a.drop()
    const a2 = join(TOKEN_A, 'A')
    expect(a2.room_.you).toEqual({ seat: 0, host: true })
    // Two connections with one token: the old one is closed.
    const a3 = join(TOKEN_A, 'A')
    expect(a2.closed?.reason).toBe('replaced')
    a3.drop()
    host.t += PVP_RULES.graceMs + 1000
    room.onAlarm()
    const c = join('token-cccccccc', 'C')
    expect(c.room_.you.seat).toBe(0)
  })

  it('checks messages: shape, size, hello first, and a rate limit that closes floods', () => {
    const { host, room, join } = setup()
    const raw = new FakeConn(host, room)
    raw.say({ t: 'start' })
    expect(raw.last('error').msg).toMatch(/hello/)
    raw.say('not json')
    expect(raw.last('error').code).toBe('bad')
    raw.say(JSON.stringify({ t: 'name', name: 'x'.repeat(2000) }))
    expect(raw.last('error').msg).toMatch(/too long/i)
    const a = join(TOKEN_A, '<b>evil</b>\u0000name that is far too long')
    expect(a.room_.seats[0]!.name.length).toBeLessThanOrEqual(PVP_LIMITS.maxName)
    expect(a.room_.seats[0]!.name).not.toMatch(/[<>]/)
    for (let i = 0; i < PVP_LIMITS.rateBurst + PVP_LIMITS.floodClose + 5; i++) a.say({ t: 'hb' })
    expect(a.all('error').some((e) => e.code === 'rate')).toBe(true)
    expect(a.closed?.code).toBe(4429)
  })

  it('bursts now and then over a long match never add up to a hang-up (only drops in a row count)', () => {
    const { host, join } = setup()
    const a = join(TOKEN_A, 'A')
    // 40 bursts, each a little over the limit, with time to refill between them.
    for (let burst = 0; burst < 40; burst++) {
      for (let i = 0; i < PVP_LIMITS.rateBurst + 5; i++) a.say({ t: 'hb' })
      host.t += 5000
    }
    expect(a.closed).toBeNull()
  })
})

describe('online room: the match', () => {
  function started(mapId = PVP_MAPS[0].id, settings: Record<string, unknown> = {}) {
    const s = setup()
    const a = s.join(TOKEN_A, 'A')
    const b = s.join(TOKEN_B, 'B')
    a.say({ t: 'map', id: mapId })
    if (Object.keys(settings).length) a.say({ t: 'settings', ...settings })
    a.say({ t: 'start' })
    // Past the 3-2-1-Go (the match clock starts at Go).
    s.run(PVP_RULES.countdownMs + LOOP_MS)
    return { ...s, a, b }
  }
  /** Nothing changes hands: every cannon holds its fire. */
  const freeze = (room: RoomCore) => {
    const sim = room.match!.sim
    for (const c of sim.cannons) {
      c.setTarget(null)
      c.setAimPoint({ x: c.x, y: 2 })
    }
    sim.setAutoTarget(false, 'player')
    sim.setAutoTarget(false, 'enemy')
  }
  const order = (c: FakeConn, o: unknown, seq = 1) => {
    c.say({ t: 'order', seq, o })
    return c.last('ack').ok as boolean
  }

  it('takes orders only for your own side, and steps the round at 60 Hz with snapshots at 20 Hz', () => {
    const { a, b, run, room } = started()
    expect(order(a, { t: 'aim', cannon: 'p1', at: { cannon: 'e1' } })).toBe(true)
    expect(order(b, { t: 'aim', cannon: 'p1', at: { cannon: 'e1' } })).toBe(false)
    expect(order(b, { t: 'aim', cannon: 'e1', at: { cannon: 'p1' } })).toBe(true)
    expect(order(b, { t: 'aim', cannon: 'e1', at: { x: 'nope' } })).toBe(false)
    expect(order(b, { t: 'teleport' })).toBe(false)
    const before = a.all('snap').length
    const tick0 = room.match!.tick
    run(1000)
    expect(a.all('snap').length - before).toBeGreaterThanOrEqual(19)
    expect(a.all('snap').length - before).toBeLessThanOrEqual(21)
    expect(room.match!.tick - tick0).toBeGreaterThanOrEqual(59)
    expect(room.match!.tick - tick0).toBeLessThanOrEqual(61)
    expect(room.match!.sim.byId('e1')!.target?.id).toBe('p1')
  })

  it('3-2-1-Go: everyone gets the countdown in snapshots, nothing fires, no pausing, the clock starts at Go; a rematch counts down again', () => {
    const s = setup()
    const a = s.join(TOKEN_A, 'A')
    const b = s.join(TOKEN_B, 'B')
    const w = s.join('token-wwwwwwww', 'W')
    a.say({ t: 'start' })
    s.run(1000)
    for (const c of [a, b, w]) {
      expect(c.snap.cd).toBeGreaterThan(1500)
      expect(c.snap.cd).toBeLessThanOrEqual(2000)
      expect(c.snap.x!.tl).toBe(PVP_RULES.matchMs)
    }
    expect(s.room.match!.sim.shots.length).toBe(0)
    // Orders work; pausing doesn't (and costs nothing).
    expect(order(a, { t: 'aim', cannon: 'p1', at: { cannon: 'e1' } })).toBe(true)
    expect(order(a, { t: 'pause' })).toBe(false)
    expect(a.snap.x!.pl).toEqual([-1, -1])
    s.run(PVP_RULES.countdownMs - 1000 + 200)
    expect(a.snap.cd).toBeUndefined()
    expect(a.snap.x!.tl).toBeLessThan(PVP_RULES.matchMs)
    expect(a.snap.x!.tl).toBeGreaterThan(PVP_RULES.matchMs - 400)
    expect(order(a, { t: 'pause' })).toBe(true)
    expect(order(a, { t: 'resume' })).toBe(true)
    // Rematch: the countdown runs again.
    for (const c of s.room.match!.sim.cannons) if (c.side === 'enemy') c.side = 'player'
    s.run(100)
    a.say({ t: 'rematch', on: true })
    b.say({ t: 'rematch', on: true })
    s.run(100)
    expect(a.snap.cd).toBeGreaterThan(PVP_RULES.countdownMs - 300)
    expect(w.snap.cd).toBe(a.snap.cd)
  })

  it('pauses (3 each, up to 30 s): both screens pause, only the pauser resumes, and queued orders stay hidden', () => {
    const { a, b, run, room } = started(PVP_MAPS[0].id, { pauseCount: 3, pauseSecs: 30 })
    expect(order(a, { t: 'pause' })).toBe(true)
    expect(a.snap.paused).toBe(true)
    expect(b.snap.paused).toBe(true)
    expect(b.snap.x!.pz).toBe(0)
    // The other player can't resume, but can give orders (queued, hidden from A).
    expect(order(b, { t: 'resume' })).toBe(false)
    expect(order(b, { t: 'swap', cannon: 'e2', kind: 'sniper' })).toBe(true)
    expect(order(a, { t: 'aim', cannon: 'p2', at: { cannon: 'e3' } })).toBe(true)
    run(300)
    expect(b.snap.q.length).toBe(1)
    expect(a.snap.q.length).toBe(1)
    expect(a.snap.q[0][4]).toBe(-1) // A sees only its own aim, not B's swap
    expect(b.snap.q[0][4]).toBeGreaterThanOrEqual(0)
    // Runs out after 30 s by itself; the queued orders happen then.
    run(30_000 + 200)
    expect(a.snap.paused).toBe(false)
    expect(room.match!.sim.byId('e2')!.kind).toBe('sniper')
    expect(room.match!.sim.byId('p2')!.target?.id).toBe('e3')
    // Two more pauses for A, then no more.
    expect(order(a, { t: 'pause' })).toBe(true)
    expect(order(a, { t: 'resume' })).toBe(true)
    expect(order(a, { t: 'pause' })).toBe(true)
    expect(order(a, { t: 'resume' })).toBe(true)
    expect(order(a, { t: 'pause' })).toBe(false)
    expect(a.snap.x!.pl).toEqual([0, 3])
  })

  it('ends at the time limit: most cannons wins, equal is a draw', () => {
    {
      const { a, b, run, room } = started()
      freeze(room)
      run(PVP_RULES.matchMs + 2000)
      expect(room.match!.over).toBe(true)
      expect(a.room_.result).toEqual({ winner: null, why: 'time', cannons: [3, 3] })
      expect(a.snap.winner).toBe('neutral')
      expect(a.snap.x!.why).toBe('time')
      expect(b.room_.phase).toBe('ended')
    }
    {
      const { a, run, room } = started()
      freeze(room)
      room.match!.sim.byId('n2')!.side = 'enemy'
      run(PVP_RULES.matchMs + 2000)
      const r = a.room_.result!
      expect(r).toMatchObject({ winner: 1, why: 'time' })
      expect(r.cannons[1]).toBeGreaterThan(r.cannons[0])
      expect(a.snap.winner).toBe('enemy')
    }
  })

  it('wins when the other side holds no cannons; rematch needs both, and sides swap', () => {
    const { a, b, room, run } = started()
    const sim = room.match!.sim
    for (const c of sim.cannons) if (c.side === 'enemy') c.side = 'player'
    run(100)
    expect(a.room_.result).toMatchObject({ winner: 0, why: 'wipe' })
    expect(a.snap.winner).toBe('player')
    a.say({ t: 'rematch', on: true })
    expect(room.match!.over).toBe(true)
    expect(b.room_.rematch).toEqual([true, false])
    b.say({ t: 'rematch', on: true })
    expect(room.match!.over).toBe(false)
    expect(a.last('start').side).toBe('enemy')
    expect(b.last('start').side).toBe('player')
    expect(a.room_.sides).toEqual(['enemy', 'player'])
  })

  it('a dropped player has 45 s to come back; then a Hard AI plays their seat until they return', () => {
    const { a, b, run, room, join } = started()
    freeze(room)
    b.drop()
    run(PVP_RULES.graceMs - 1000)
    expect(room.match!.ai[1]).toBe(false)
    expect(a.snap.x!.on).toEqual([1, 0])
    run(2000)
    expect(room.match!.ai[1]).toBe(true)
    expect(room.match!.sim.aiFor('enemy')?.difficulty ?? 'hard').toBe('hard')
    expect(a.snap.x!.ai).toEqual([0, 1])
    // Back with the same token: the seat (and the start of the round) comes back.
    const b2 = join(TOKEN_B, 'B')
    expect(room.match!.ai[1]).toBe(false)
    expect(b2.last('start').side).toBe('enemy')
    expect(b2.all('snap').length).toBe(1)
    expect(order(b2, { t: 'aim', cannon: 'e1', at: { cannon: 'p1' } })).toBe(true)
  })

  it('leaving mid-match hands the seat to the AI at once; a newcomer watches until the match ends', () => {
    const { a, b, run, room, join } = started()
    b.say({ t: 'leave' })
    expect(room.match!.ai[1]).toBe(true)
    const c = join('token-cccccccc', 'C')
    expect(c.last('start').spectate).toBe(true)
    expect(order(c, { t: 'aim', cannon: 'e1', at: { cannon: 'p1' } })).toBe(false)
    expect(c.snap.q).toEqual([])
    // After the match, B's seat is free for C.
    const sim = room.match!.sim
    for (const x of sim.cannons) if (x.side === 'enemy') x.side = 'player'
    run(100)
    expect(a.room_.seats[1]).toBeNull()
  })

  it('everyone gone during a match: dropped after the grace time, then the room closes', () => {
    const { a, b, run, room, host } = started()
    a.drop()
    b.drop()
    run(PVP_RULES.graceMs + 500)
    expect(room.match!.over).toBe(true)
    expect(host.loop).toBeNull()
    host.t += PVP_LIMITS.emptyRoomMs + 1
    room.onAlarm()
    expect(room.state).toBeNull()
  })

  it('snapshot traffic per player stays small', () => {
    const { a, b, run } = started()
    order(a, { t: 'aim', cannon: 'p1', at: { cannon: 'e1' } })
    order(b, { t: 'aim', cannon: 'e1', at: { cannon: 'p1' } })
    const bytes = () => a.all('snap').reduce((n, m) => n + JSON.stringify(m).length, 0)
    const b0 = bytes()
    run(10_000)
    const perSec = (bytes() - b0) / 10
    console.log(`online snapshot traffic: ${Math.round(perSec)} bytes/s per player`)
    expect(perSec).toBeLessThan(25_000)
  })
})

describe('online room: skins', () => {
  const twoPlayers = (skinA?: string, skinB?: string, watcher = false) => {
    const s = setup()
    const say = (token: string, name: string, skin?: string) => {
      const c = new FakeConn(s.host, s.room)
      c.say({ t: 'hello', token, name, ...(skin ? { skin } : {}) })
      return c
    }
    const a = say(TOKEN_A, 'A', skinA)
    const b = say(TOKEN_B, 'B', skinB)
    const w = watcher ? say('token-wwwwwwww', 'W') : null
    a.say({ t: 'start' })
    const end = () => {
      for (const c of s.room.match!.sim.cannons) if (c.side === 'enemy') c.side = 'player'
      s.run(100)
      a.say({ t: 'rematch', on: true })
      b.say({ t: 'rematch', on: true })
    }
    return { ...s, a, b, w, end }
  }

  it('each player wears their pick; everyone (watchers too) gets the same skins, gold first', () => {
    const { a, b, w, host } = twoPlayers('hex', 'plated', true)
    for (const c of [a, b, w!]) expect(c.last('start').skins).toEqual({ player: 'hex', enemy: 'plated', neutral: 'classic' })
    expect(w!.last('start').spectate).toBe(true)
    expect(host.saved?.seats[0]?.skin).toBe('hex')
  })

  it('the same pick: both keep it (nobody is reskinned), also after sides swap', () => {
    const { a, b, end } = twoPlayers('plated', 'plated')
    expect(a.last('start').skins).toEqual({ player: 'plated', enemy: 'plated', neutral: 'classic' })
    end()
    expect(b.last('start').side).toBe('player')
    expect(a.last('start').skins).toEqual({ player: 'plated', enemy: 'plated', neutral: 'classic' })
    expect(b.last('start').skins).toEqual(a.last('start').skins)
  })

  it('different picks follow their players when sides swap', () => {
    const { a, b, end } = twoPlayers('hex', 'classic')
    expect(a.last('start').skins).toMatchObject({ player: 'hex', enemy: 'classic' })
    end()
    expect(b.last('start').skins).toMatchObject({ player: 'classic', enemy: 'hex' })
  })

  it('older clients (no skin) and junk skins fall back to defaults that still differ', () => {
    const { a } = twoPlayers(undefined, 'rainbow')
    expect(a.last('start').skins).toEqual({ player: 'plated', enemy: 'spiked', neutral: 'classic' })
    expect(parseClientMsg({ t: 'hello', token: TOKEN_A, name: 'x', skin: 'rainbow' })).toEqual({ t: 'hello', token: TOKEN_A, name: 'x' })
    expect(parseClientMsg({ t: 'hello', token: TOKEN_A, name: 'x', skin: 'hex' })).toEqual({ t: 'hello', token: TOKEN_A, name: 'x', skin: 'hex' })
  })
})

describe('online room: team colours', () => {
  const twoPlayers = (colourA?: string, colourB?: string, watcher = false) => {
    const s = setup()
    const say = (token: string, name: string, colour?: string) => {
      const c = new FakeConn(s.host, s.room)
      c.say({ t: 'hello', token, name, ...(colour ? { colour } : {}) })
      return c
    }
    const a = say(TOKEN_A, 'A', colourA)
    const b = say(TOKEN_B, 'B', colourB)
    const w = watcher ? say('token-wwwwwwww', 'W') : null
    a.say({ t: 'start' })
    const end = () => {
      for (const c of s.room.match!.sim.cannons) if (c.side === 'enemy') c.side = 'player'
      s.run(100)
      a.say({ t: 'rematch', on: true })
      b.say({ t: 'rematch', on: true })
    }
    return { ...s, a, b, w, end }
  }

  it('each keeps their pick when the two go together; players and watchers get the same colours, gold seat first', () => {
    const { a, b, w, host } = twoPlayers('blueberry', 'peach', true)
    for (const c of [a, b, w!]) expect(c.last('start').colours).toEqual({ player: 'blueberry', enemy: 'peach' })
    expect(host.saved?.seats[0]?.colour).toBe('blueberry')
  })

  it('a clashing pair: both keep their own (nobody is recoloured); colours follow their players when sides swap', () => {
    const { a, b, end } = twoPlayers('sky', 'blueberry')
    expect(a.last('start').colours).toEqual({ player: 'sky', enemy: 'blueberry' })
    end()
    expect(b.last('start').side).toBe('player')
    expect(b.last('start').colours).toEqual({ player: 'blueberry', enemy: 'sky' })
    expect(a.last('start').colours).toEqual(b.last('start').colours)
  })

  it('the same pick is kept; older clients (no colour) and junk get colours that go together', () => {
    expect(twoPlayers('grape', 'grape').a.last('start').colours).toEqual({ player: 'grape', enemy: 'grape' })
    expect(twoPlayers(undefined, 'rainbow').a.last('start').colours).toEqual({ player: 'gold', enemy: 'strawberry' })
    expect(parseClientMsg({ t: 'hello', token: TOKEN_A, name: 'x', colour: 'rainbow' })).toEqual({ t: 'hello', token: TOKEN_A, name: 'x' })
    expect(parseClientMsg({ t: 'hello', token: TOKEN_A, name: 'x', colour: 'lime' })).toEqual({ t: 'hello', token: TOKEN_A, name: 'x', colour: 'lime' })
  })
})

describe('online room: host settings', () => {
  const room3 = () => {
    const s = setup()
    const a = s.join(TOKEN_A, 'Nova')
    const b = s.join(TOKEN_B, 'Kim')
    const w = s.join('token-wwwwwwww', 'W')
    const end = () => {
      for (const c of s.room.match!.sim.cannons) if (c.side === 'enemy') c.side = 'player'
      s.run(100)
    }
    return { ...s, a, b, w, end }
  }

  it('every new room starts with the defaults: 3 s countdown, pauses on, host on the left', () => {
    const { a, b, w, room } = room3()
    for (const c of [a, b, w]) {
      expect(c.room_.settings).toEqual({ countdown: 3, pauses: true, pauseCount: null, pauseLimit: true, pauseSecs: 5 })
      expect(c.room_.left).toBe(0)
    }
    a.say({ t: 'start' })
    expect(room.match!.sim.countdown).toBe(3000)
    expect(a.last('start').side).toBe('player')
    expect(a.last('start').pauses).toBeUndefined()
    expect(room.match!.pausesLeft).toEqual([-1, -1])
    expect(room.match!.pauseMs).toBe(5000)
  })

  it('only the host changes them, only between matches; guest and watchers see every change', () => {
    const { a, b, w, room } = room3()
    b.say({ t: 'settings', countdown: 0 })
    expect(b.last('error').code).toBe('notallowed')
    w.say({ t: 'swap' })
    expect(w.last('error').code).toBe('notallowed')
    expect(room.settings()).toEqual(DEFAULT_SETTINGS)
    a.say({ t: 'settings', countdown: 5 })
    a.say({ t: 'settings', pauses: false })
    for (const c of [a, b, w]) expect(c.room_.settings).toEqual({ ...DEFAULT_SETTINGS, countdown: 5, pauses: false })
    a.say({ t: 'settings', countdown: 4 }) // not a choice: refused as a bad message
    expect(room.settings().countdown).toBe(5)
    a.say({ t: 'start' })
    a.say({ t: 'settings', countdown: 0 })
    expect(a.last('error').code).toBe('notallowed')
    expect(room.settings().countdown).toBe(5)
  })

  it('countdown 0 ("Chaotic rush"): firing starts at once', () => {
    const { a, room, run } = room3()
    a.say({ t: 'settings', countdown: 0 })
    a.say({ t: 'start' })
    expect(room.match!.sim.countdown).toBe(0)
    run(1500)
    expect(room.match!.sim.shots.length + room.match!.sim.cannons.filter((c) => c.captureProgress > 0).length).toBeGreaterThan(0)
  })

  it('pauses off: nobody can pause, the start says so (older games see 0 pauses left)', () => {
    const { a, b, w, room, run } = room3()
    a.say({ t: 'settings', pauses: false })
    a.say({ t: 'start' })
    for (const c of [a, b, w]) expect(c.last('start').pauses).toBe(false)
    run(PVP_RULES.countdownMs + 200)
    a.say({ t: 'order', seq: 1, o: { t: 'pause' } })
    expect(a.last('ack')).toEqual({ t: 'ack', seq: 1, ok: false })
    expect(room.match!.sim.paused).toBe(false)
    expect(a.snap.x?.pl).toEqual([0, 0])
  })

  it('swap sides: the host plays the right side; looks and "you" follow the person; rematches swap from there; settings carry over', () => {
    const s = setup()
    const say = (token: string, name: string, colour: string) => {
      const c = new FakeConn(s.host, s.room)
      c.say({ t: 'hello', token, name, colour })
      return c
    }
    const a = say(TOKEN_A, 'Nova', 'blueberry')
    const b = say(TOKEN_B, 'Kim', 'peach')
    a.say({ t: 'settings', countdown: 5 })
    a.say({ t: 'swap' })
    expect(b.room_.left).toBe(1)
    a.say({ t: 'swap' })
    expect(b.room_.left).toBe(0)
    a.say({ t: 'swap' })
    a.say({ t: 'start' })
    // Kim (seat 1) has the left, gold-side cannons; Nova plays the right.
    expect(a.last('start').side).toBe('enemy')
    expect(b.last('start').side).toBe('player')
    expect(a.last('start').colours).toEqual({ player: 'peach', enemy: 'blueberry' })
    expect(s.room.match!.sides).toEqual(['enemy', 'player'])
    // After the match the room shows the next sides: swapped back.
    for (const c of s.room.match!.sim.cannons) if (c.side === 'enemy') c.side = 'player'
    s.run(100)
    expect(a.room_.left).toBe(0)
    a.say({ t: 'rematch', on: true })
    b.say({ t: 'rematch', on: true })
    expect(a.last('start').side).toBe('player')
    expect(a.last('start').colours).toEqual({ player: 'blueberry', enemy: 'peach' })
    expect(s.room.match!.sim.countdown).toBe(5000)
    // The left side is the gold ('player') side on every PvP map.
    for (const l of PVP_MAPS) {
      const xs = (side: string) => l.cannons.filter((c) => c.side === side).map((c) => c.x)
      expect(Math.max(...xs('player'))).toBeLessThan(Math.min(...xs('enemy')))
    }
  })

  it('a change between matches resets rematch votes; a room saved before settings existed plays the defaults', () => {
    const { a, b, room, end } = room3()
    a.say({ t: 'start' })
    end()
    b.say({ t: 'rematch', on: true })
    a.say({ t: 'settings', countdown: 0 })
    expect(a.room_.rematch).toEqual([false, false])
    const st = JSON.parse(JSON.stringify(room.state)) as RoomState
    delete (st as Partial<RoomState>).settings
    delete (st as Partial<RoomState>).left
    const old = new RoomCore(new FakeHost(), st)
    expect(old.settings()).toEqual(DEFAULT_SETTINGS)
    expect(parseClientMsg({ t: 'settings', countdown: 0, pauses: false })).toEqual({ t: 'settings', countdown: 0, pauses: false })
    expect(parseClientMsg({ t: 'settings', pauses: 'no' })).toBeNull()
    expect(parseClientMsg({ t: 'swap' })).toEqual({ t: 'swap' })
  })
})

describe('online room: names for the name tags', () => {
  it('no name: the room says Player 1 / Player 2; names (and changes) reach both players and watchers', () => {
    const s = setup()
    const a = new FakeConn(s.host, s.room)
    a.say({ t: 'hello', token: TOKEN_A, name: '' })
    const b = new FakeConn(s.host, s.room)
    b.say({ t: 'hello', token: TOKEN_B, name: '  ' })
    const w = new FakeConn(s.host, s.room)
    w.say({ t: 'hello', token: 'token-wwwwwwww', name: 'W' })
    a.say({ t: 'start' })
    for (const c of [a, b, w]) expect(c.last('room').seats.map((x: { name: string } | null) => x?.name)).toEqual(['Player 1', 'Player 2'])
    b.say({ t: 'name', name: 'Kim<script>' })
    for (const c of [a, b, w]) expect(c.last('room').seats[1].name).toBe('Kimscript')
  })
})

describe('online protocol helpers', () => {
  it('room codes, names and message shapes', () => {
    for (let i = 0; i < 50; i++) expect(isRoomCode(randomCode())).toBe(true)
    expect(isRoomCode('ABCO')).toBe(false)
    expect(isRoomCode('abcd')).toBe(false)
    expect(normaliseCode(' ab-cd ')).toBe('ABCD')
    expect(cleanName('  a  b ', 'x')).toBe('a b')
    expect(cleanName(42, 'x')).toBe('x')
    expect(parseClientMsg({ t: 'hello', token: 'short', name: 'x' })).toBeNull()
    expect(parseClientMsg({ t: 'rematch', on: 'yes' })).toBeNull()
    expect(parseClientMsg({ t: 'map', id: 5 })).toBeNull()
    expect(parseClientMsg({ t: 'order', seq: 1, o: { t: 'pause' } })).toEqual({ t: 'order', seq: 1, o: { t: 'pause' } })
  })

  it('PvP maps are fair (mirrored, except Skirmish) and never Huge', () => {
    for (const l of PVP_MAPS) expect(l.size ?? 'small').not.toBe('huge')
    for (const l of PVP_MAPS.slice(1)) {
      const sw = (s: string) => (s === 'player' ? 'enemy' : s === 'enemy' ? 'player' : s)
      for (const c of l.cannons) expect(l.cannons.some((d) => Math.abs(d.x - (1200 - c.x)) < 1 && Math.abs(d.y - c.y) < 1 && d.side === sw(c.side))).toBe(true)
    }
    expect(PVP_MAPS[1].cannons).toEqual(mirrored(3).cannons)
  })
})

describe('online room: surrender', () => {
  const room3 = () => {
    const s = setup()
    const a = s.join(TOKEN_A, 'Nova')
    const b = s.join(TOKEN_B, 'Kim')
    const w = s.join('token-wwwwwwww', 'W')
    return { ...s, a, b, w }
  }

  it('the room says this server takes it (older servers leave it out: no button)', () => {
    const { a, w } = room3()
    expect(a.room_.surrender).toBe(true)
    expect(w.room_.surrender).toBe(true)
    expect(parseClientMsg({ t: 'surrender' })).toEqual({ t: 'surrender' })
  })

  it('a player surrenders: the other wins at once, everyone sees why, and a rematch works after', () => {
    const { a, b, w, room, run } = room3()
    a.say({ t: 'start' })
    run(PVP_RULES.countdownMs + 500)
    b.say({ t: 'surrender' })
    expect(room.match!.over).toBe(true)
    for (const c of [a, b, w]) {
      expect(c.room_.phase).toBe('ended')
      expect(c.room_.result).toMatchObject({ winner: 0, why: 'surrender' })
      expect(c.snap.x?.why).toBe('surrender')
    }
    // Nothing more happens to the finished match.
    b.say({ t: 'surrender' })
    expect(b.last('error').code).toBe('notallowed')
    a.say({ t: 'rematch', on: true })
    b.say({ t: 'rematch', on: true })
    expect(room.match!.over).toBe(false)
    expect(a.room_.phase).toBe('playing')
    // Sides swapped for the rematch: Nova is pink now; her surrender gives Kim (gold) the match.
    expect(a.last('start').side).toBe('enemy')
    a.say({ t: 'surrender' })
    expect(a.room_.result).toMatchObject({ winner: 1, why: 'surrender' })
  })

  it('watchers cannot surrender, nor anyone between matches; during the countdown or a pause works', () => {
    const { a, b, w, room, run } = room3()
    a.say({ t: 'surrender' })
    expect(a.last('error').code).toBe('notallowed')
    a.say({ t: 'start' })
    w.say({ t: 'surrender' })
    expect(w.last('error').code).toBe('notallowed')
    expect(room.match!.over).toBe(false)
    run(PVP_RULES.countdownMs + 300)
    b.say({ t: 'order', seq: 1, o: { t: 'pause' } })
    expect(room.match!.sim.paused).toBe(true)
    a.say({ t: 'surrender' })
    expect(room.match!.over).toBe(true)
    expect(a.room_.result).toMatchObject({ winner: 1, why: 'surrender' })
    // Countdown: a fresh match can be given up before Go.
    a.say({ t: 'rematch', on: true })
    b.say({ t: 'rematch', on: true })
    expect(room.match!.sim.countdown).toBeGreaterThan(0)
    b.say({ t: 'surrender' })
    expect(room.match!.over).toBe(true)
  })
})
