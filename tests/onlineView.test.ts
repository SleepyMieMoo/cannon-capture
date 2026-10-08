import { describe, expect, it } from 'vitest'
import type { RoomInfo } from '../src/net/online'
import { clock, endTexts, nameOnSide, netLine, opponentLine, pauseCheck, pauseLabel, rematchLine } from '../src/net/onlineView'
import type { SnapExtra } from '../src/net/snapshot'

const info = (over: Partial<RoomInfo> = {}): RoomInfo => ({
  t: 'room',
  code: 'ABCD',
  you: { seat: 0, host: true },
  seats: [
    { name: 'Nova', connected: true, ai: false },
    { name: 'Kim', connected: true, ai: false },
  ],
  host: 0,
  spectators: 0,
  map: 'skirmish',
  phase: 'playing',
  match: 2,
  // Second match: sides swapped, so Nova (seat 0) plays pink.
  sides: ['enemy', 'player'],
  rematch: [false, false],
  result: null,
  ...over,
})

const x = (over: Partial<SnapExtra> = {}): SnapExtra => ({ tl: 125_000, pz: -1, pzl: 0, pl: [3, 1], ai: [0, 0], on: [1, 1], ...over })

describe('online battle texts', () => {
  it('clock and names follow the seats and their sides', () => {
    expect(clock(300_000)).toBe('5:00')
    expect(clock(61_001)).toBe('1:02')
    expect(clock(-5)).toBe('0:00')
    expect(nameOnSide(info(), 0)).toBe('Kim')
    expect(nameOnSide(info(), 1)).toBe('Nova')
    expect(nameOnSide(null, 1)).toBe('Player 2')
  })

  it('pauses: only with pauses left, only the pauser resumes, watchers never', () => {
    expect(pauseCheck('pause', x(), 1, false, info()).ok).toBe(true)
    expect(pauseCheck('pause', x({ pl: [3, 0] }), 1, false, info())).toEqual({ ok: false, why: 'No pauses left this match.' })
    expect(pauseCheck('resume', x({ pz: 0, pzl: 12_400 }), 1, true, info()).why).toContain('Only Kim can resume early (it resumes by itself in 13 s)')
    expect(pauseCheck('resume', x({ pz: 1 }), 1, true, info()).ok).toBe(true)
    expect(pauseCheck('pause', x(), null, false, info()).ok).toBe(false)
    expect(pauseLabel(x({ pz: 1, pzl: 20_000 }), 1, info())).toContain('hidden from Kim')
    expect(pauseLabel(x({ pz: 0, pzl: 20_000 }), 1, info())).toContain('Kim paused')
    expect(netLine(x(), 1, 42)).toBe('1 pause left  ·  42 ms')
    expect(netLine(x(), null, null)).toBe('watching  ·  … ms')
  })

  it('the other player dropping, then an AI', () => {
    expect(opponentLine(x(), 1, info(), null, 0)).toBeNull()
    expect(opponentLine(x({ on: [0, 1] }), 1, info(), 1000, 11_000)).toContain('takes over in 35 s')
    expect(opponentLine(x({ on: [0, 1], ai: [1, 0] }), 1, info(), 1000, 11_000)).toBe('Kim left: a Hard AI is playing their side.')
  })

  it('end screen and rematch lines', () => {
    expect(endTexts('win', 1, info(), 'wipe', { mine: 6, theirs: 0 }).headline).toBe('You win')
    expect(endTexts('draw', 1, info(), 'time', { mine: 3, theirs: 3 })).toEqual({ headline: 'Draw', detail: "Time's up: 3 – 3 cannons." })
    expect(endTexts('win', null, info({ you: { seat: null, host: false } }), 'time', { mine: 4, theirs: 2 })).toEqual({ headline: 'Kim wins', detail: "Time's up: Kim 4 – 2 Nova." })
    // Surrender: the winner and watchers see who gave up; the one who did sees it plainly.
    expect(endTexts('win', 1, info(), 'surrender', { mine: 2, theirs: 5 })).toEqual({ headline: 'You win', detail: 'Kim surrendered.' })
    expect(endTexts('lose', 1, info(), 'surrender', { mine: 5, theirs: 2 })).toEqual({ headline: 'You surrendered', detail: 'Kim wins this match.' })
    expect(endTexts('lose', null, info({ you: { seat: null, host: false } }), 'surrender', { mine: 4, theirs: 2 })).toEqual({ headline: 'Nova wins', detail: 'Kim surrendered.' })
    expect(rematchLine(info({ phase: 'ended' }))).toContain('both press')
    expect(rematchLine(info({ rematch: [true, false] }))).toBe('Waiting for Kim to press Rematch…')
    expect(rematchLine(info({ rematch: [false, true] }))).toBe('Kim wants a rematch!')
    expect(rematchLine(info({ seats: [{ name: 'Nova', connected: true, ai: false }, null] }))).toBe('The other player left the room.')
  })
})
