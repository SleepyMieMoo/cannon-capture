import type { LevelDef } from '../types'

const DOWN = Math.PI / 2
const UP = -Math.PI / 2
const LEFT = Math.PI

/**
 * The campaign, in unlock order. Each level introduces one idea:
 * capture -> enemy -> bank shots -> walls in battle -> fans -> everything ->
 * a fan-and-wall puzzle -> outnumbered finale -> snipers (a puzzle, then a battle).
 *
 * Board: x 24..1176, y 88..696. Cannon radius 26.
 */
export const CAMPAIGN: LevelDef[] = [
  {
    id: 'first-shots',
    name: 'First Shots',
    kind: 'puzzle',
    hint: 'Click your gold cannon, then click a grey one. Captured cannons join you, so aim them too.',
    par: 40,
    cannons: [
      { id: 'p1', name: 'P1', x: 220, y: 400, side: 'player' },
      { id: 'n1', name: 'N1', x: 560, y: 250, side: 'neutral' },
      { id: 'n2', name: 'N2', x: 560, y: 550, side: 'neutral' },
      { id: 'n3', name: 'N3', x: 940, y: 400, side: 'neutral' },
    ],
    walls: [],
    fans: [],
  },
  {
    id: 'tug-of-war',
    name: 'Tug of War',
    hint: 'Pink fights back. Win the middle cannon first, then push.',
    par: 30,
    ai: { retargetMs: 2200, fireMs: 1300 },
    cannons: [
      { id: 'p1', name: 'P1', x: 200, y: 260, side: 'player', aimAt: 'n1' },
      { id: 'p2', name: 'P2', x: 200, y: 540, side: 'player' },
      { id: 'n1', name: 'N1', x: 600, y: 400, side: 'neutral' },
      { id: 'e1', name: 'E1', x: 1000, y: 400, side: 'enemy', aimAt: 'n1' },
    ],
    walls: [],
    fans: [],
  },
  {
    id: 'bank-shot',
    name: 'Bank Shot',
    kind: 'puzzle',
    hint: 'Shots bounce off walls. Aim at the long wall to curve over the blocker.',
    aims: 3,
    par: 2,
    cannons: [
      { id: 'p1', name: 'P1', x: 200, y: 560, side: 'player' },
      { id: 'n1', name: 'N1', x: 700, y: 560, side: 'neutral' },
      { id: 'n2', name: 'N2', x: 1000, y: 330, side: 'neutral' },
    ],
    walls: [
      { x: 300, y: 200, w: 600, h: 24 },
      { x: 440, y: 400, w: 26, h: 296 },
    ],
    fans: [],
  },
  {
    id: 'walls-up',
    name: 'Walls Up',
    hint: 'The middle is walled off. Take the corners, then bank around.',
    par: 60,
    ai: { retargetMs: 2000, fireMs: 1200 },
    cannons: [
      { id: 'p1', name: 'P1', x: 170, y: 220, side: 'player', aimAt: 'n1' },
      { id: 'p2', name: 'P2', x: 170, y: 580, side: 'player', aimAt: 'n2' },
      { id: 'n1', name: 'N1', x: 600, y: 170, side: 'neutral' },
      { id: 'n2', name: 'N2', x: 600, y: 630, side: 'neutral' },
      { id: 'e1', name: 'E1', x: 1030, y: 300, side: 'enemy', aimAt: 'n1' },
      { id: 'e2', name: 'E2', x: 1030, y: 500, side: 'enemy', aimAt: 'n2' },
    ],
    walls: [
      { x: 588, y: 270, w: 24, h: 260 },
      { x: 860, y: 388, w: 120, h: 24 },
    ],
    fans: [],
  },
  {
    id: 'tailwind',
    name: 'Tailwind',
    kind: 'puzzle',
    hint: 'Fans push shots along their arrows. Lob a shot over the wall and let the wind carry it down.',
    aims: 3,
    par: 2,
    cannons: [
      { id: 'p1', name: 'P1', x: 200, y: 600, side: 'player' },
      { id: 'n1', name: 'N1', x: 1095, y: 625, side: 'neutral' },
      { id: 'n2', name: 'N2', x: 1060, y: 200, side: 'neutral' },
    ],
    walls: [{ x: 600, y: 330, w: 26, h: 366 }],
    fans: [{ x: 780, y: 260, radius: 150, angle: DOWN, force: 620 }],
  },
  {
    id: 'crossfire',
    name: 'Crossfire',
    hint: 'Walls and wind together. Lead your shots and watch the fan bend theirs.',
    par: 75,
    ai: { retargetMs: 1700, fireMs: 1100 },
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
    fans: [{ x: 760, y: 220, radius: 145, angle: DOWN, force: 540 }],
  },
  {
    id: 'cocoa-maze',
    name: 'Cocoa Maze',
    kind: 'puzzle',
    hint: 'Five cannons, five aims. Plan the capture order so every new cannon has a shot.',
    aims: 5,
    par: 4,
    cannons: [
      { id: 'p1', name: 'P1', x: 130, y: 600, side: 'player' },
      { id: 'n1', name: 'N1', x: 420, y: 300, side: 'neutral' },
      { id: 'n2', name: 'N2', x: 700, y: 600, side: 'neutral' },
      { id: 'n3', name: 'N3', x: 780, y: 200, side: 'neutral' },
      { id: 'n4', name: 'N4', x: 1070, y: 470, side: 'neutral' },
    ],
    walls: [
      { x: 300, y: 420, w: 260, h: 24 },
      { x: 560, y: 150, w: 24, h: 300 },
      { x: 880, y: 330, w: 24, h: 366 },
    ],
    fans: [{ x: 990, y: 230, radius: 110, angle: DOWN, force: 560 }],
  },
  {
    id: 'last-stand',
    name: 'Last Stand',
    hint: 'Outnumbered. Grab the neutrals fast and break their line one cannon at a time.',
    par: 50,
    ai: { retargetMs: 1400 },
    cannons: [
      { id: 'p1', name: 'P1', x: 140, y: 250, side: 'player', aimAt: 'n1' },
      { id: 'p2', name: 'P2', x: 140, y: 400, side: 'player', aimAt: 'n1' },
      { id: 'p3', name: 'P3', x: 140, y: 550, side: 'player', aimAt: 'n2' },
      { id: 'n1', name: 'N1', x: 470, y: 300, side: 'neutral' },
      { id: 'n2', name: 'N2', x: 470, y: 560, side: 'neutral' },
      { id: 'e1', name: 'E1', x: 1050, y: 180, side: 'enemy', aimAt: 'n1' },
      { id: 'e2', name: 'E2', x: 1060, y: 400, side: 'enemy', aimAt: 'n1' },
      { id: 'e3', name: 'E3', x: 1050, y: 620, side: 'enemy', aimAt: 'n2' },
      { id: 'e4', name: 'E4', x: 860, y: 400, side: 'enemy', aimAt: 'n2' },
    ],
    walls: [
      { x: 640, y: 160, w: 26, h: 150 },
      { x: 640, y: 490, w: 26, h: 150 },
    ],
    fans: [{ x: 760, y: 400, radius: 95, angle: UP, force: 480 }],
  },
  {
    id: 'long-shot',
    name: 'Long Shot',
    kind: 'puzzle',
    hint: 'Snipers (long barrel) shoot 2× as fast and far and punch through wind. Hover a gold cannon to swap its type, free here.',
    aims: 3,
    par: 3,
    cannons: [
      { id: 'p1', name: 'P1', x: 160, y: 400, side: 'player', kind: 'sniper' },
      { id: 'p2', name: 'P2', x: 160, y: 620, side: 'player' },
      { id: 'n1', name: 'N1', x: 1040, y: 400, side: 'neutral' },
      { id: 'n2', name: 'N2', x: 420, y: 180, side: 'neutral' },
      { id: 'n3', name: 'N3', x: 1040, y: 160, side: 'neutral' },
    ],
    walls: [
      { x: 588, y: 88, w: 26, h: 202 },
      { x: 588, y: 510, w: 26, h: 186 },
      { x: 900, y: 88, w: 26, h: 250 },
    ],
    fans: [
      { x: 600, y: 400, radius: 150, angle: LEFT, force: 600 },
      { x: 1040, y: 280, radius: 100, angle: DOWN, force: 1100 },
    ],
  },
  {
    id: 'sniper-duel',
    name: 'Sniper Duel',
    hint: 'Pink has a sniper behind the wind. Swap a cannon to Sniper to reach it, and heal anything close to flipping.',
    par: 55,
    ai: { retargetMs: 1400 },
    cannons: [
      { id: 'p1', name: 'P1', x: 150, y: 400, side: 'player', kind: 'sniper', aimAt: 'n1' },
      { id: 'p2', name: 'P2', x: 210, y: 200, side: 'player', aimAt: 'n1' },
      { id: 'p3', name: 'P3', x: 210, y: 600, side: 'player', aimAt: 'n2' },
      { id: 'n1', name: 'N1', x: 580, y: 250, side: 'neutral' },
      { id: 'n2', name: 'N2', x: 580, y: 570, side: 'neutral' },
      { id: 'e1', name: 'E1', x: 1080, y: 400, side: 'enemy', kind: 'sniper', delay: 3, aimAt: 'n1' },
      { id: 'e2', name: 'E2', x: 820, y: 200, side: 'enemy', aimAt: 'n1' },
      { id: 'e3', name: 'E3', x: 820, y: 600, side: 'enemy', aimAt: 'n2' },
      { id: 'e4', name: 'E4', x: 1080, y: 620, side: 'enemy', aimAt: 'e3' },
    ],
    walls: [
      { x: 690, y: 370, w: 26, h: 60 },
      { x: 940, y: 88, w: 26, h: 200 },
      { x: 940, y: 512, w: 26, h: 184 },
    ],
    fans: [{ x: 952, y: 400, radius: 120, angle: LEFT, force: 650 }],
  },
]
