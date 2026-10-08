import { describe, expect, it } from 'vitest'
import { CONTRAST, DEFAULT_SKIN, SKINS, flipSkins, isSkin, pvpSkins, vsAiSkins } from '../src/config/skins'
import { parseSkinPref } from '../src/menu/skinPref'
import { BattleSim } from '../src/sim/BattleSim'
import { mirrored } from '../src/levels/mirrored'
import { joinRoom, PvpHost, type HostMsg } from '../src/net/pvp'
import type { Transport } from '../src/net/transport'

describe('skins: rules', () => {
  it('the opponent never wears your skin, and round never faces hex', () => {
    for (const s of SKINS) {
      expect(CONTRAST[s]).not.toBe(s)
      expect(vsAiSkins(s)).toEqual({ player: s, enemy: CONTRAST[s], neutral: 'classic' })
    }
    expect(CONTRAST.classic).not.toBe('hex')
    expect(CONTRAST.hex).not.toBe('classic')
    expect(DEFAULT_SKIN).toBe('plated')
    expect(CONTRAST[DEFAULT_SKIN]).toBe('spiked')
  })

  it('two players keep their picks unless equal; then pink changes (deterministically)', () => {
    for (const g of SKINS)
      for (const p of SKINS) {
        const r = pvpSkins(g, p)
        expect(r.player).toBe(g)
        expect(r.enemy).toBe(g === p ? CONTRAST[g] : p)
        expect(r.enemy).not.toBe(r.player)
        expect(pvpSkins(g, p)).toEqual(r)
      }
    expect(pvpSkins(undefined, undefined)).toEqual({ player: 'plated', enemy: 'spiked', neutral: 'classic' })
    expect(flipSkins(pvpSkins('hex', 'plated'))).toEqual({ player: 'plated', enemy: 'hex', neutral: 'classic' })
  })

  it('the saved choice: only known skins, else the default', () => {
    expect(isSkin('hex')).toBe(true)
    expect(isSkin('HEX')).toBe(false)
    expect(parseSkinPref('spiked')).toBe('spiked')
    expect(parseSkinPref(null)).toBe(DEFAULT_SKIN)
    expect(parseSkinPref('{"x":1}')).toBe(DEFAULT_SKIN)
  })
})

describe('skins: on the board', () => {
  it('a cannon wears its current owner skin: the shape flips with the capture, neutrals stay Classic', () => {
    const sim = new BattleSim(mirrored(3), null, {})
    sim.setSkins(vsAiSkins('hex'))
    const skinOf = (c: (typeof sim.cannons)[number]) => c.skin
    const gold = sim.cannons.find((c) => c.side === 'player')!
    const pink = sim.cannons.find((c) => c.side === 'enemy')!
    const grey = sim.cannons.find((c) => c.side === 'neutral')!
    expect(skinOf(gold)).toBe('hex')
    expect(skinOf(pink)).toBe('spiked')
    expect(skinOf(grey)).toBe('classic')
    // Every cannon shares the round's skins object: changing it (or a capture) needs no per-cannon work.
    for (const c of sim.cannons) expect(c.skins).toBe(sim.skins)
    pink.side = 'player'
    expect(skinOf(pink)).toBe('hex')
    grey.side = 'enemy'
    expect(skinOf(grey)).toBe('spiked')
    sim.setSkins(vsAiSkins('classic'))
    expect(skinOf(gold)).toBe('classic')
    expect(skinOf(grey)).toBe('spiked')
  })
})

describe('skins: two tabs (LAN test mode)', () => {
  function pair(): [Transport & { out: unknown[] }, (msg: unknown, from: string) => void] {
    let handler: ((msg: unknown, from: string) => void) | null = null
    const t = {
      out: [] as unknown[],
      send(msg: unknown) {
        t.out.push(msg)
      },
      onMessage(fn: (msg: unknown, from: string) => void) {
        handler = fn
        return () => (handler = null)
      },
      close() {},
    } as unknown as Transport & { out: unknown[] }
    return [t, (msg, from) => handler?.(msg, from)]
  }

  it('the host sends both skins (pink differs on a tie); the joiner says its skin in hello', () => {
    const [t, deliver] = pair()
    const host = new PvpHost(t, mirrored(1), 'm1')
    host.localSkin = 'spiked'
    deliver({ t: 'hello', skin: 'spiked' }, 'peer-1')
    const start = t.out.find((m) => (m as HostMsg).t === 'start') as Extract<HostMsg, { t: 'start' }>
    expect(start.skins).toEqual({ player: 'spiked', enemy: 'plated', neutral: 'classic' })
    host.close(false)
    const [t2] = pair()
    const cancel = joinRoom(t2, () => {}, () => {}, 'hex')
    expect(t2.out[0]).toEqual({ t: 'hello', skin: 'hex' })
    cancel()
  })
})
