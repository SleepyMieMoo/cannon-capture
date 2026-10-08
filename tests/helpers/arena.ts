import { BattleSim } from '../../src/sim/BattleSim'
import { levelLanes } from '../../src/sim/solver'
import { mirrored } from '../../src/levels/mirrored'
import { withDifficulty } from '../../src/editor/maps'
import type { AiLevel, LevelDef, Side } from '../../src/types'

export { mirrored }

const FRAME = 1000 / 60

/** AI vs AI: pink plays at `enemy`, gold at `player`. Returns who held more cannons at the end. */
export function match(base: LevelDef, enemy: AiLevel, player: AiLevel, maxMs = 150_000): Side | 'draw' {
  const level = withDifficulty({ ...base, kind: 'battle' }, enemy)
  const sim = new BattleSim(level, null, {}, levelLanes(level))
  sim.addAi('player', player)
  while (!sim.ended && sim.clock < maxMs) sim.step(FRAME)
  if (sim.ended) return sim.ended === 'win' ? 'player' : 'enemy'
  const p = sim.count('player')
  const e = sim.count('enemy')
  return p > e ? 'player' : e > p ? 'enemy' : 'draw'
}
