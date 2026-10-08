import { cssHex, lerpColor, theme } from '../config/theme'

/** Small inline SVGs for the menu (static strings, crisp at any DPI). */

const ic = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const ICONS = {
  play: ic('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>'),
  puzzle: ic('<path d="M9 3h4v2.2a1.8 1.8 0 1 0 3.6 0V3H20v6h-2.2a1.8 1.8 0 1 0 0 3.6H20V21h-6v-2.2a1.8 1.8 0 1 0-3.6 0V21H4v-7h2.2a1.8 1.8 0 1 0 0-3.6H4V3z"/>'),
  levels: ic('<path d="M4 20c3-2 4-6 8-6s5 3 8 1"/><path d="M14 4v8"/><path d="M14 4l5 2-5 2"/>'),
  editor: ic('<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>'),
  maps: ic('<path d="M3 6h7l2 2h9v11H3z"/>'),
  settings: ic('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8"/>'),
  help: ic('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 1-1 1.7"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>'),
  friends: ic('<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3 2.8-5 5.5-5s4.9 2 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2c2.6-.2 4.5 1.6 5 4.3"/>'),
  back: ic('<path d="M15 5l-7 7 7 7"/>'),
}

const gold = cssHex(theme.player)
const pink = cssHex(theme.enemy)
const grey = cssHex(theme.neutral)
const board = cssHex(theme.hud)
const edge = cssHex(theme.boardEdge)
const ink = theme.text
const muted = theme.textMuted
const sel = cssHex(theme.select)
const ringYou = cssHex(theme.ringYou)
const ringEnemy = cssHex(theme.ringEnemy)
const ringEdge = cssHex(theme.ringEdge)
const tinted = cssHex(lerpColor(theme.enemy, theme.player, 0.55))

const cannon = (x: number, y: number, color: string, angle = 0, r = 15): string => {
  const bx = Math.cos(angle)
  const by = Math.sin(angle)
  return `<line x1="${x}" y1="${y}" x2="${x + bx * (r + 9)}" y2="${y + by * (r + 9)}" stroke="${color}" stroke-opacity=".7" stroke-width="7" stroke-linecap="round"/><circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/><circle cx="${x - r * 0.25}" cy="${y - r * 0.28}" r="${r * 0.38}" fill="#fff" fill-opacity=".22"/>`
}
/** The ownership ring a cannon wears in play: light for yours, red for theirs. */
const own = (x: number, y: number, color: string, r = 15): string =>
  `<circle cx="${x}" cy="${y}" r="${r + 2.5}" fill="none" stroke="${ringEdge}" stroke-width="4.5"/><circle cx="${x}" cy="${y}" r="${r + 2.5}" fill="none" stroke="${color}" stroke-width="2.5"/>`
const svg = (body: string): string =>
  `<svg viewBox="0 0 240 100" aria-hidden="true"><rect x="1" y="1" width="238" height="98" rx="10" fill="${board}" stroke="${edge}" stroke-width="1.5"/>${body}</svg>`
const label = (x: number, y: number, t: string, color = muted, size = 11, anchor = 'middle'): string =>
  `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-family="${theme.font}" font-weight="bold" text-anchor="${anchor}">${t}</text>`
const key = (x: number, y: number, t: string, w = 0): string => {
  const width = w || 10 + t.length * 8
  return `<rect x="${x - width / 2}" y="${y - 12}" width="${width}" height="20" rx="5" fill="${board}" stroke="${edge}" stroke-width="1.5"/><rect x="${x - width / 2}" y="${y + 5}" width="${width}" height="3" rx="1.5" fill="${edge}"/>${label(x, y + 2, t, ink, 11)}`
}
const pointer = (x: number, y: number): string =>
  `<path d="M${x} ${y}l0 16 4.5-4 3 7 3-1.4-3-6.6 6-.4z" fill="#fff" stroke="${board}" stroke-width="1.4"/>`

/** How to play, one picture per tip. */
export const HOWTO: { title: string; text: string; art: string }[] = [
  {
    title: 'Aim',
    text: 'Click one of your gold cannons (the light ring means yours to steer), then click a cannon or a spot to aim at. It keeps firing there by itself.',
    art: svg(
      `${cannon(46, 58, gold, -0.25)}${own(46, 58, ringYou)}<line x1="74" y1="51" x2="178" y2="34" stroke="${sel}" stroke-width="2.5" stroke-dasharray="7 6"/>${cannon(196, 32, grey, Math.PI)}<circle cx="196" cy="32" r="22" fill="none" stroke="${sel}" stroke-width="2"/>${pointer(50, 62)}${pointer(200, 36)}${label(30, 92, '1  click yours', muted, 10, 'start')}${label(212, 92, '2  click a target', muted, 10, 'end')}`,
    ),
  },
  {
    title: 'Capture',
    text: 'Hits fill a cannon’s outer ring in your colour; eight flip it. The solid ring is the owner right now: light = yours, red = theirs. Take every cannon to win; your shots heal your own.',
    art: svg(
      `${cannon(40, 50, gold)}${own(40, 50, ringYou)}<circle cx="96" cy="50" r="4" fill="${gold}"/><circle cx="124" cy="50" r="4" fill="${gold}"/><circle cx="152" cy="50" r="4" fill="${gold}"/>${cannon(196, 50, tinted, Math.PI)}${own(196, 50, ringEnemy)}<circle cx="196" cy="50" r="23.5" fill="none" stroke="${edge}" stroke-width="3.5"/><path d="M196 26.5 A23.5 23.5 0 1 1 173.2 55.9" fill="none" stroke="${gold}" stroke-width="3.5" stroke-linecap="round"/>${label(120, 90, '8 hits flip it')}`,
    ),
  },
  {
    title: 'Swap type',
    text: 'Hover a cannon (long-press on touch) for its menu: Normal, Sniper, Machine gun or Shield. T steps the selected one.',
    art: svg(
      `${['Normal', 'Sniper', 'MG', 'Shield']
        .map((t, i) => `<rect x="${18 + i * 52}" y="12" width="48" height="22" rx="7" fill="${i === 1 ? gold : board}" stroke="${i === 1 ? gold : edge}" stroke-width="1.5"/>${label(42 + i * 52, 27, t, i === 1 ? cssHex(theme.hud) : ink, 10)}`)
        .join('')}${cannon(68, 68, gold, -0.1)}${pointer(74, 72)}${key(190, 70, 'T')}`,
    ),
  },
  {
    title: 'Auto-target',
    text: 'When a target is captured, your gun picks the nearest foe. Press M over a cannon to keep it manual; the global switch is in Settings during a battle.',
    art: svg(
      `${cannon(70, 54, gold, -0.2, 17)}<g transform="translate(48 30)"><circle r="8" fill="${board}" stroke="${muted}" stroke-width="1.5"/><path d="M-5 0h10M0-5v10" stroke="${muted}" stroke-width="1.5"/><path d="M-6 6l12-12" stroke="${pink}" stroke-width="2"/></g>${key(170, 54, 'M')}${label(170, 86, 'manual / auto')}`,
    ),
  },
  {
    title: 'Pause',
    text: 'Space (or Pause) freezes the round. Aim and swap as much as you like; it all happens at once when you resume.',
    art: svg(
      `<rect x="28" y="30" width="10" height="34" rx="3" fill="${gold}"/><rect x="44" y="30" width="10" height="34" rx="3" fill="${gold}"/>${cannon(100, 64, gold, -0.35)}<line x1="124" y1="56" x2="200" y2="30" stroke="${sel}" stroke-width="2.5" stroke-dasharray="6 6"/><circle cx="104" cy="64" r="22" fill="none" stroke="${sel}" stroke-width="1.5" stroke-dasharray="5 5"/>${key(178, 76, 'Space', 56)}`,
    ),
  },
  {
    title: 'Camera',
    text: 'Big maps: scroll or pinch to zoom, drag empty space (or WASD / arrows) to pan. Fit shows the whole board.',
    art: svg(
      `<rect x="24" y="18" width="110" height="64" rx="8" fill="none" stroke="${edge}" stroke-width="2"/><rect x="48" y="32" width="58" height="36" rx="5" fill="none" stroke="${gold}" stroke-width="2" stroke-dasharray="5 4"/><path d="M77 50h22m-4-4 4 4-4 4M77 50H55m4-4-4 4 4 4" stroke="${gold}" stroke-width="2" fill="none"/>${key(176, 32, '+  −', 44)}${key(176, 68, 'WASD', 52)}`,
    ),
  },
]

/** The keys line under the tips. */
export const KEYS: [string, string][] = [
  ['Space', 'pause'],
  ['T', 'next type'],
  ['M', 'auto-target'],
  ['N', 'mute'],
  ['R', 'restart'],
  ['E', 'back to editor (playtest)'],
  ['Esc', 'menu / back'],
  ['F3', 'performance'],
]
