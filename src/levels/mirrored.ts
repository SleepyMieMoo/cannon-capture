import { seededRandom } from '../sim/random'
import type { CannonDef, LevelDef } from '../types'

/** A random map that is the same for both sides (mirrored left/right), so neither side has the better start. */
export function mirrored(seed: number): LevelDef {
  const r = seededRandom('mirror' + seed)
  const R = (a: number, b: number) => Math.round(a + r() * (b - a))
  const cannons: CannonDef[] = []
  const walls: LevelDef['walls'] = []
  const fans: LevelDef['fans'] = []
  const pairs = R(2, 3)
  for (let i = 0; i < pairs; i++) {
    const x = R(90, 260)
    const y = R(140, 650)
    cannons.push({ id: `p${i + 1}`, name: `P${i + 1}`, x, y, side: 'player' }, { id: `e${i + 1}`, name: `E${i + 1}`, x: 1200 - x, y, side: 'enemy' })
  }
  const np = R(1, 3)
  for (let i = 0; i < np; i++) {
    const x = R(330, 540)
    const y = R(130, 660)
    cannons.push({ id: `n${2 * i + 1}`, name: 'N', x, y, side: 'neutral' }, { id: `n${2 * i + 2}`, name: 'N', x: 1200 - x, y, side: 'neutral' })
  }
  if (r() < 0.6) cannons.push({ id: 'nc', name: 'NC', x: 600, y: R(150, 640), side: 'neutral' })
  for (let i = 0; i < R(0, 2); i++) {
    const w = R(20, 30)
    const h = R(90, 200)
    const x = R(280, 520)
    const y = R(120, 560)
    walls.push({ x, y, w, h }, { x: 1200 - x - w, y, w, h })
  }
  if (r() < 0.4) fans.push({ x: 600, y: R(200, 600), radius: 120, angle: r() < 0.5 ? Math.PI / 2 : -Math.PI / 2 })
  return { id: 'mirror' + seed, name: 'Mirror ' + seed, kind: 'battle', walls, fans, cannons }
}

