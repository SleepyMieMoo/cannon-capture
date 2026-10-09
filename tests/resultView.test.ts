import { describe, expect, it } from 'vitest'
import { offlineResult, onlineResult, type OfflineResultInput, bragFor, fmtMatchTime } from '../src/ui/resultView'

const base: OfflineResultInput = {
  result: 'win', campaign: false, hasNext: false, fromPuzzles: false, pvp: false, isPuzzle: false,
  surrendered: false, endReason: '', seconds: 42, aimsUsed: 3, countsAims: false, stars: 0,
  backLabel: 'Change map or difficulty',
}
const labels = (v: { buttons: { label: string }[] }) => v.buttons.map((b) => b.label)

describe('result panel contents', () => {
  it('vs the AI: play again first, then the way back', () => {
    const win = offlineResult(base)
    expect(win.headline).toBe('All cannons captured')
    expect(labels(win)).toEqual(['Play again', 'Change map or difficulty'])
    expect(win.buttons.map((b) => b.primary)).toEqual([true, false])
    expect(win.stars).toBeNull()
    const lose = offlineResult({ ...base, result: 'lose' })
    expect(lose.headline).toBe('No cannons left')
    expect(lose.tone).toBe('lose')
    expect(lose.keys).toBe('R to restart')
  })

  it('surrendering says so, whatever else is true', () => {
    const v = offlineResult({ ...base, result: 'lose', surrendered: true, endReason: 'The AI takes this round.' })
    expect(v.headline).toBe('You surrendered')
    expect(v.detail).toBe('The AI takes this round.')
    expect(labels(v)).toEqual(['Play again', 'Change map or difficulty'])
  })

  it('campaign: next level with stars, try again on a loss, campaign complete at the end', () => {
    const next = offlineResult({ ...base, campaign: true, hasNext: true, stars: 2, par: 30, backLabel: 'Back to map' })
    expect(next.headline).toBe('Level complete')
    expect(next.stars).toBe(2)
    expect(next.detail).toBe('Won in 42s  ·  3 stars under 30s')
    expect(labels(next)).toEqual(['Next level', 'Back to map'])
    expect(next.keys).toBe('N for next  ·  R to replay')
    const last = offlineResult({ ...base, campaign: true, stars: 3, backLabel: 'Back to map' })
    expect(last.headline).toBe('Campaign complete!')
    expect(labels(last)).toEqual(['Back to map', 'Play again'])
    const lose = offlineResult({ ...base, campaign: true, result: 'lose', backLabel: 'Back to map' })
    expect(labels(lose)).toEqual(['Try again', 'Back to map'])
    expect(lose.stars).toBeNull()
  })

  it('puzzles count aims and say Next puzzle / Puzzle failed', () => {
    const win = offlineResult({ ...base, campaign: true, isPuzzle: true, countsAims: true, aimsUsed: 1, par: 1, hasNext: true, fromPuzzles: true, backLabel: 'Back to puzzles' })
    expect(win.detail).toBe('1 aim used  ·  3 stars at 1')
    expect(labels(win)).toEqual(['Next puzzle', 'Back to puzzles'])
    const fail = offlineResult({ ...base, campaign: true, isPuzzle: true, result: 'lose', endReason: 'Out of aims.' })
    expect(fail.headline).toBe('Puzzle failed')
  })

  it('player vs player', () => {
    expect(offlineResult({ ...base, pvp: true }).headline).toBe('You win')
    expect(offlineResult({ ...base, pvp: true, result: 'lose' }).detail).toBe('You have no cannons left.')
  })

  it('online: rematch for players (greyed out alone), the room for watchers', () => {
    const p = { rematchLine: 'Rematch when you both press it', otherWants: false, iWant: false, otherHere: true }
    const v = onlineResult({ result: 'win', headline: 'You win', detail: 'x', player: p })
    expect(labels(v)).toEqual(['Rematch', 'Back to the room'])
    expect(v.buttons[0].disabled).toBe(false)
    const asked = onlineResult({ result: 'lose', headline: 'h', detail: 'd', player: { ...p, iWant: true, otherWants: true, otherHere: false } })
    expect(labels(asked)).toEqual(['Cancel rematch', 'Back to the room'])
    expect(asked.buttons[0]).toMatchObject({ primary: false, disabled: true })
    expect(asked.extra).toEqual({ text: p.rematchLine, gold: true })
    const watch = onlineResult({ result: 'draw', headline: 'Draw', detail: 'd', player: null })
    expect(labels(watch)).toEqual(['Back to the room', 'Leave the room'])
    expect(watch.tone).toBe('draw')
    expect(watch.keysOnly).toBe(false)
  })

  it('always one primary button, listed first', () => {
    const inputs: Partial<OfflineResultInput>[] = [{}, { result: 'lose' }, { campaign: true }, { campaign: true, hasNext: true }, { campaign: true, result: 'lose' }]
    for (const extra of inputs) {
      const v = offlineResult({ ...base, ...extra })
      expect(v.buttons.length).toBe(2)
      expect(v.buttons.filter((b) => b.primary).length).toBe(1)
      expect(v.buttons[0].primary).toBe(true)
    }
  })
})

describe('brag row', () => {
  it('match time is m:ss', () => {
    expect(fmtMatchTime(0)).toBe('0:00')
    expect(fmtMatchTime(9_999)).toBe('0:09')
    expect(fmtMatchTime(65_400)).toBe('1:05')
    expect(fmtMatchTime(3_600_000)).toBe('60:00')
  })

  it('vs AI: opponent, map and time, in that order', () => {
    const v = offlineResult({ ...base, brag: { opponent: 'Hard AI', map: 'Warp Works', ms: 151_000 } })
    expect(v.brag).toEqual([
      { key: 'opponent', label: 'Against', value: 'Hard AI' },
      { key: 'map', label: 'Map', value: 'Warp Works' },
      { key: 'time', label: 'Time', value: '2:31' },
    ])
  })

  it('no opponent (a puzzle, the same-browser test): just map and time', () => {
    const v = offlineResult({ ...base, campaign: true, isPuzzle: true, brag: { opponent: null, map: 'Bank shot', ms: 12_000 } })
    expect(v.brag!.map((s) => s.key)).toEqual(['map', 'time'])
  })

  it('online: the other player and the time; left out when not given', () => {
    const v = onlineResult({ result: 'win', headline: 'You win', detail: '', player: null, brag: { opponent: 'Mie vs Moo', map: 'Skirmish', ms: 61_000 } })
    expect(bragFor({ opponent: 'Moo', map: '', ms: 1000 }).map((s) => s.key)).toEqual(['opponent', 'time'])
    expect(v.brag![0].value).toBe('Mie vs Moo')
    expect(onlineResult({ result: 'win', headline: 'x', detail: '', player: null }).brag).toBeUndefined()
  })
})
