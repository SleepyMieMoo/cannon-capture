import { describe, expect, it } from 'vitest'
import { AI_LEVELS } from '../src/types'
import { BOTS, BOT_LINE_MAX, botAvatarSvg, botLine, botLines, botMoment, pickLine, type BotMoment } from '../src/ui/bots'
import { offlineResult, type OfflineResultInput } from '../src/ui/resultView'

const MOMENTS: BotMoment[] = ['youWin', 'youLose', 'youSurrender']

describe('bot characters', () => {
  it('every difficulty has its own named bot and face', () => {
    const names = AI_LEVELS.map((l) => BOTS[l].name)
    expect(new Set(names).size).toBe(AI_LEVELS.length)
    for (const l of AI_LEVELS) {
      const svg = botAvatarSvg(l, 0xff6680)
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg).toContain(`data-bot="${l}"`)
      // Tinted by its team colour.
      expect(svg.toLowerCase()).toContain('#ff6680')
      expect(svg).not.toMatch(/<image|href=/)
    }
  })

  it('6 to 8 short, distinct lines per bot per moment', () => {
    for (const l of AI_LEVELS) {
      for (const m of MOMENTS) {
        const lines = botLines(l, m)
        expect(lines.length, `${l} ${m}`).toBeGreaterThanOrEqual(6)
        expect(lines.length, `${l} ${m}`).toBeLessThanOrEqual(8)
        expect(new Set(lines).size).toBe(lines.length)
        for (const line of lines) {
          expect(line.length, line).toBeLessThanOrEqual(BOT_LINE_MAX)
          expect(line.trim()).toBe(line)
        }
      }
    }
  })

  it('the moment follows the outcome; surrendering has its own lines', () => {
    expect(botMoment('win', false)).toBe('youWin')
    expect(botMoment('lose', false)).toBe('youLose')
    expect(botMoment('lose', true)).toBe('youSurrender')
  })

  it('picks at random but never repeats the last line', () => {
    const pool = ['a', 'b', 'c']
    for (let i = 0; i < 50; i++) expect(pickLine(pool, 'b', () => (i % 10) / 10)).not.toBe('b')
    expect(pickLine(['only'], 'only')).toBe('only')
    expect(pickLine([], null)).toBe('')
    // Every line can come up.
    const seen = new Set(Array.from({ length: 30 }, (_, i) => pickLine(pool, null, () => i / 30)))
    expect(seen.size).toBe(3)
  })

  it('botLine remembers the last line (no repeat twice in a row)', () => {
    let prev = ''
    for (let i = 0; i < 40; i++) {
      const line = botLine('impossible', 'youWin')
      expect(botLines('impossible', 'youWin')).toContain(line)
      expect(line).not.toBe(prev)
      prev = line
    }
  })

  it('the result view carries the bot', () => {
    const base: OfflineResultInput = {
      result: 'win', campaign: false, hasNext: false, fromPuzzles: false, pvp: false, isPuzzle: false,
      surrendered: false, endReason: '', seconds: 42, aimsUsed: 3, countsAims: false, stars: 0, backLabel: 'Back',
    }
    const v = offlineResult({ ...base, bot: { level: 'hard', name: BOTS.hard.name, line: 'Hmph.' }, brag: { opponent: `${BOTS.hard.name} · Hard`, map: 'Skirmish', ms: 90_000 } })
    expect(v.bot?.name).toBe(BOTS.hard.name)
    expect(v.brag?.[0].value).toBe(`${BOTS.hard.name} · Hard`)
    expect(offlineResult(base).bot).toBeUndefined()
  })
})
