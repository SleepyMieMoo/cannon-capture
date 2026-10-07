import type { LevelDef } from '../types'

/**
 * One battle board.
 *
 * Opening lanes:
 * - P2 and P3 fire into N2. E2 and E3 do too.
 * - P1 fires at N1 and bounces off the tall wall, so that cannon starts wasted.
 * - E1 fires at N1 through the fan. The wind bends that shot down onto N2.
 * - The low wall sits under the fan.
 */
export const SKIRMISH: LevelDef = {
  id: 'skirmish',
  name: 'Skirmish',
  cannons: [
    { id: 'p1', name: 'P1', x: 150, y: 230, side: 'player', aimAt: 'n1' },
    { id: 'p2', name: 'P2', x: 160, y: 450, side: 'player', aimAt: 'n2' },
    { id: 'p3', name: 'P3', x: 280, y: 620, side: 'player', aimAt: 'n2' },
    { id: 'n1', name: 'N1', x: 520, y: 210, side: 'neutral' },
    { id: 'n2', name: 'N2', x: 490, y: 530, side: 'neutral' },
    { id: 'e1', name: 'E1', x: 1040, y: 200, side: 'enemy', aimAt: 'n1' },
    { id: 'e2', name: 'E2', x: 1040, y: 450, side: 'enemy', aimAt: 'n2' },
    { id: 'e3', name: 'E3', x: 900, y: 620, side: 'enemy', aimAt: 'n2' },
  ],
  walls: [
    { x: 340, y: 150, w: 28, h: 170 },
    { x: 680, y: 360, w: 200, h: 26 },
  ],
  fans: [{ x: 760, y: 220, radius: 145, angle: Math.PI / 2, force: 540 }],
}
