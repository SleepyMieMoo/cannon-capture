import { describe, expect, it } from 'vitest'
import { MOTION_KEY, motionOK, parseMotionPref, resolveReduce } from '../src/ui/motion'
import { PREF_KEYS } from '../src/menu/prefs'
import { settingsText } from '../src/menu/debugInfo'

describe('Reduce motion', () => {
  it('Auto follows the device; On and Off override it', () => {
    expect(resolveReduce('auto', false)).toBe(false)
    expect(resolveReduce('auto', true)).toBe(true)
    expect(resolveReduce('on', false)).toBe(true)
    expect(resolveReduce('off', true)).toBe(false)
  })

  it('anything unknown saved reads as Auto', () => {
    expect(parseMotionPref(null)).toBe('auto')
    expect(parseMotionPref('maybe')).toBe('auto')
    expect(parseMotionPref('on')).toBe('on')
    expect(parseMotionPref('off')).toBe('off')
  })

  it('motion is allowed until something says otherwise (no DOM needed)', () => {
    expect(motionOK()).toBe(true)
  })

  it('is a preference: Reset forgets it, and debug info reports it', () => {
    expect(PREF_KEYS.map((k) => k.key)).toContain(MOTION_KEY)
    const text = settingsText({ sound: true, volume: 1, perf: false, skin: 'classic', colour: 'gold', difficulty: 'normal', motion: { pref: 'auto', reduced: true } })
    expect(text['reduce motion']).toBe('auto (reduced)')
  })
})
