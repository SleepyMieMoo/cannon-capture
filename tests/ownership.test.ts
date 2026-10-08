import { afterEach, describe, expect, it } from 'vitest'
import { TUNING } from '../src/config/tuning'
import { ownerRing, sideColor, theme } from '../src/config/theme'
import { Cannon, RING, haloR, ownRingR, setRingScale, trackR } from '../src/entities/Cannon'
import { sideMapper } from '../src/net/snapshot'

// Relative luminance (sRGB), and the Machado et al. 2009 colour-blindness simulations (severity 1).
const lin = (v: number): number => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const rgb = (c: number): [number, number, number] => [lin((c >> 16) & 255), lin((c >> 8) & 255), lin(c & 255)]
const Y = ([r, g, b]: number[]): number => 0.2126 * r + 0.7152 * g + 0.0722 * b
const SIM: Record<string, number[][]> = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
}
const seen = (c: number, m: number[][]): number => Y(m.map((row) => Math.min(1, Math.max(0, row[0] * rgb(c)[0] + row[1] * rgb(c)[1] + row[2] * rgb(c)[2]))))
const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
const saturation = (c: number): number => {
  const v = [(c >> 16) & 255, (c >> 8) & 255, c & 255]
  const max = Math.max(...v)
  return max === 0 ? 0 : (max - Math.min(...v)) / max
}

describe('ownership rings', () => {
  afterEach(() => setRingScale(1))

  it('yours light, theirs red, neutrals none', () => {
    expect(ownerRing('player')).toBe(theme.ringYou)
    expect(ownerRing('enemy')).toBe(theme.ringEnemy)
    expect(ownerRing('neutral')).toBeNull()
  })

  it('follows the current owner only: unchanged by the capture tint, flips on the capture hit', () => {
    const theirs = new Cannon(null, 'e1', 'E1', 0, 0, 'enemy', 0)
    for (let i = 1; i < TUNING.captureThreshold; i++) {
      theirs.receiveHit('player', 1)
      expect(ownerRing(theirs.side)).toBe(theme.ringEnemy)
    }
    expect(theirs.captureProgress).toBe(TUNING.captureThreshold - 1)
    theirs.receiveHit('player', 1)
    expect(theirs.side).toBe('player')
    expect(ownerRing(theirs.side)).toBe(theme.ringYou)

    const free = new Cannon(null, 'n1', 'N1', 0, 0, 'neutral', 0)
    for (let i = 1; i < TUNING.captureThreshold; i++) free.receiveHit('enemy', 1)
    expect(ownerRing(free.side)).toBeNull()
    free.receiveHit('enemy', 1)
    expect(ownerRing(free.side)).toBe(theme.ringEnemy)
  })

  it('online: the light ring follows the local player; spectators see gold as light, pink as red', () => {
    // The second player's view is flipped: the host's pink cannons are theirs.
    const guest = sideMapper(true)
    expect(ownerRing(guest('enemy'))).toBe(theme.ringYou)
    expect(ownerRing(guest('player'))).toBe(theme.ringEnemy)
    expect(ownerRing(guest('neutral'))).toBeNull()
    // Host and spectators keep the host's sides.
    const host = sideMapper(false)
    expect(ownerRing(host('player'))).toBe(theme.ringYou)
    expect(ownerRing(host('enemy'))).toBe(theme.ringEnemy)
  })

  it('light vs red stays apart by brightness, also with deuteranopia and protanopia', () => {
    for (const [name, m] of Object.entries(SIM)) {
      const ratio = contrast(seen(theme.ringYou, m), seen(theme.ringEnemy, m))
      expect(ratio, name).toBeGreaterThan(3)
    }
    // Both read on the board.
    expect(contrast(Y(rgb(theme.ringYou)), Y(rgb(theme.board)))).toBeGreaterThan(7)
    expect(contrast(Y(rgb(theme.ringEnemy)), Y(rgb(theme.board)))).toBeGreaterThan(3)
  })

  it('the red is stronger than the pink team colour: more saturated and darker, so it shows on a pink tint', () => {
    expect(saturation(theme.ringEnemy)).toBeGreaterThan(saturation(sideColor('enemy')) + 0.2)
    expect(Y(rgb(theme.ringEnemy))).toBeLessThan(Y(rgb(sideColor('enemy'))) * 0.75)
    // And the light ring is lighter than the gold body it sits on.
    expect(Y(rgb(theme.ringYou))).toBeGreaterThan(Y(rgb(sideColor('player'))) * 1.15)
  })

  it('stays readable on a phone: at least about 2.4 CSS px, within a cap; the capture track and halo sit outside it', () => {
    setRingScale(1280 / 1200) // desktop
    expect(RING.width).toBe(RING.minPx)
    const phone = 390 / 1200 // 390 px wide, whole board on screen
    setRingScale(phone)
    expect(RING.width * phone).toBeGreaterThanOrEqual(2.4 - 1e-9)
    expect(RING.width).toBeLessThanOrEqual(RING.maxPx)
    setRingScale(0.05)
    expect(RING.width).toBe(RING.maxPx)
    for (const s of [1, phone, 0.05]) {
      setRingScale(s)
      const ringOut = ownRingR() + RING.width / 2 + 1.5
      expect(trackR() - 2).toBeGreaterThan(ringOut)
      expect(haloR()).toBeGreaterThan(trackR() + 3)
      expect(haloR()).toBeLessThan(TUNING.shield.reach - 4)
    }
  })
})
