import { cssHex, lerpColor, shade, sideColor, theme } from '../config/theme'
import { SKIN_SHAPE, type SkinId } from '../config/skins'
import { BRICK, GLASS, GLASS_RIM, PORTAL, ROCK, VOID_COLOURS } from '../config/obstacles'

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
  profile: ic('<circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20c.8-3.8 3.9-6.2 7.5-6.2s6.7 2.4 7.5 6.2"/>'),
  credits: ic('<path d="M12 20s-7-4.4-7-9.6A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.4C19 15.6 12 20 12 20z"/>'),
  copy: ic('<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
  reset: ic('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 4v4h4"/>'),
  music: ic('<path d="M9 18V5.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5" fill="currentColor"/><circle cx="16.5" cy="16" r="2.5" fill="currentColor"/>'),
  pause: ic('<rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/>'),
  prev: ic('<path d="M18 5.5v13L9 12z" fill="currentColor" stroke="none"/><path d="M6.5 5.5v13"/>'),
  next: ic('<path d="M6 5.5v13l9-6.5z" fill="currentColor" stroke="none"/><path d="M17.5 5.5v13"/>'),
  star: ic('<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>'),
  starOn: ic('<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="currentColor"/>'),
}

const grey = cssHex(theme.neutral)
const board = cssHex(theme.hud)
const edge = cssHex(theme.boardEdge)
const ink = theme.text
const muted = theme.textMuted
const sel = cssHex(theme.select)
const ringYou = cssHex(theme.ringYou)
const ringEnemy = cssHex(theme.ringEnemy)
const ringEdge = cssHex(theme.ringEdge)

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

const pts = (list: readonly { x: number; y: number }[], x: number, y: number, k: number): string =>
  list.map((p) => `${(x + p.x * k).toFixed(1)},${(y + p.y * k).toFixed(1)}`).join(' ')

/** A cannon body in a skin, the same shapes as on the board (radius 26 scaled by `k`). */
export function skinBody(skin: SkinId, x: number, y: number, color: number, k = 1): string {
  const c = cssHex(color)
  const dark = '#000'
  if (skin === 'plated') {
    const { half, corner, rivet, rivetInset } = SKIN_SHAPE.plated
    const s = half * k
    const q = (half - rivetInset) * k
    const rv = cssHex(shade(color, 0.45))
    return `<rect x="${x - s}" y="${y - s}" width="${2 * s}" height="${2 * s}" rx="${corner * k}" fill="${c}" stroke="${dark}" stroke-opacity=".3" stroke-width="${3 * k}"/><rect x="${x - s + 4 * k}" y="${y - s + 4 * k}" width="${s * 0.95}" height="${s * 0.55}" rx="${4 * k}" fill="#fff" fill-opacity=".2"/>${[
      [-q, -q],
      [q, -q],
      [-q, q],
      [q, q],
    ]
      .map(([dx, dy]) => `<circle cx="${x + dx}" cy="${y + dy}" r="${rivet * k}" fill="${rv}"/>`)
      .join('')}`
  }
  if (skin === 'spiked')
    return `<polygon points="${pts(SKIN_SHAPE.spiked, x, y, k)}" fill="${c}" stroke="${dark}" stroke-opacity=".3" stroke-width="${2.5 * k}" stroke-linejoin="round"/><circle cx="${x - 5 * k}" cy="${y - 6 * k}" r="${26 * 0.36 * k}" fill="#fff" fill-opacity=".2"/>`
  if (skin === 'hex')
    return `<polygon points="${pts(SKIN_SHAPE.hex, x, y, k)}" fill="${cssHex(shade(color, 0.66))}" stroke="${dark}" stroke-opacity=".35" stroke-width="${3 * k}" stroke-linejoin="round"/><polygon points="${pts(SKIN_SHAPE.hexInner, x, y, k)}" fill="${c}" stroke="${dark}" stroke-opacity=".22" stroke-width="${1.5 * k}"/><circle cx="${x - 5 * k}" cy="${y - 6 * k}" r="${26 * 0.3 * k}" fill="#fff" fill-opacity=".2"/>`
  return `<circle cx="${x}" cy="${y}" r="${26 * k}" fill="${c}" stroke="${dark}" stroke-opacity=".28" stroke-width="${3 * k}"/><circle cx="${x - 6 * k}" cy="${y - 7 * k}" r="${26 * 0.42 * k}" fill="#fff" fill-opacity=".2"/>`
}

/** The skin and colour pickers' preview: a cannon in that skin and colour (default: your current one) with its barrel and ring. */
export function skinPreview(skin: SkinId, side: 'player' | 'enemy' = 'player', color = sideColor(side)): string {
  const ring = side === 'player' ? ringYou : ringEnemy
  const k = 0.62
  const r = 26 * k
  const ringR = 31 * k
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><line x1="32" y1="32" x2="${32 + r + 12}" y2="${32 - (r + 12) * 0.55}" stroke="${cssHex(color)}" stroke-opacity=".8" stroke-width="7" stroke-linecap="round"/>${skinBody(skin, 32, 32, color, k)}<circle cx="32" cy="32" r="${ringR}" fill="none" stroke="${ringEdge}" stroke-width="4"/><circle cx="32" cy="32" r="${ringR}" fill="none" stroke="${ring}" stroke-width="2.2"/></svg>`
}

/**
 * How to play, one picture per tip (a wide tip spans the whole row, picture
 * beside the text). Drawn in your team colours (yours and the AI's pick).
 */
export function howtoTips(): { title: string; text: string; art: string; wide?: boolean }[] {
  const gold = cssHex(sideColor('player'))
  const pink = cssHex(sideColor('enemy'))
  const tinted = cssHex(lerpColor(sideColor('enemy'), sideColor('player'), 0.55))
  const healing = cssHex(lerpColor(sideColor('player'), sideColor('enemy'), 0.32))
  const voidFill = cssHex(VOID_COLOURS.fill)
  const voidEdge = cssHex(VOID_COLOURS.edge)
  const voidRim = cssHex(VOID_COLOURS.rim)
  const voidSpark = cssHex(VOID_COLOURS.spark)
  const teal = cssHex(PORTAL.colours[0])
  // A portal mouth: dark well, rim and swirl in the pair's colour, a ring glyph and a facing notch (pointing right).
  const portal = (x: number, y: number, col: string): string =>
    `<circle cx="${x}" cy="${y}" r="21" fill="${col}" fill-opacity=".14"/><circle cx="${x}" cy="${y}" r="16" fill="#07090c" stroke="${col}" stroke-width="3"/><path d="M${x - 9} ${y - 3}q6-9 13-2M${x + 9} ${y + 3}q-6 9-13 2M${x - 3} ${y + 9}q-9-6-2-13" stroke="${col}" stroke-opacity=".75" stroke-width="2" fill="none"/><circle cx="${x}" cy="${y}" r="3.5" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.5"/><path d="M${x + 17} ${y - 4}l6 4-6 4z" fill="${col}"/>`
  const brick = cssHex(BRICK.base)
  const brickDark = cssHex(BRICK.dark)
  const brickLight = cssHex(BRICK.light)
  const brickEdge = cssHex(BRICK.edge)
  const brickCrack = cssHex(BRICK.crack)
  // A short brick wall (two courses, offset), standing at x 140..164.
  const bricks = (x: number, y: number, rows: number): string => {
    let out = `<rect x="${x}" y="${y}" width="24" height="${rows * 11 + 2}" rx="3" fill="${brickEdge}"/>`
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? 6 : 0
      for (const [bx, bw] of off ? [[1, 5], [7, 10], [18, 5]] : [[1, 10], [12, 11]]) out += `<rect x="${x + bx}" y="${y + 1.5 + r * 11}" width="${bw}" height="9.5" fill="${(r + bx) % 3 ? brick : brickDark}"/><rect x="${x + bx}" y="${y + 1.5 + r * 11}" width="${bw}" height="1.6" fill="${brickLight}" fill-opacity=".5"/>`
    }
    return out
  }
  const rockEdge = cssHex(ROCK.edge)
  const rockBase = cssHex(ROCK.base)
  const rockMid = cssHex(ROCK.mid)
  const rockCrack = cssHex(ROCK.crack)
  const moss = cssHex(ROCK.moss)
  const mossLight = cssHex(ROCK.mossLight)
  const glass = cssHex(GLASS)
  const glassRim = cssHex(GLASS_RIM)
  return [
  {
    title: 'Aim',
    text: 'Click one of your cannons (the light ring means yours to steer), then click a cannon or a spot to aim at. It keeps firing there by itself.',
    art: svg(
      `${cannon(46, 58, gold, -0.25)}${own(46, 58, ringYou)}<line x1="74" y1="51" x2="178" y2="34" stroke="${sel}" stroke-width="2.5" stroke-dasharray="7 6"/>${cannon(196, 32, grey, Math.PI)}<circle cx="196" cy="32" r="22" fill="none" stroke="${sel}" stroke-width="2"/>${pointer(50, 62)}${pointer(200, 36)}${label(30, 92, '1  click yours', muted, 10, 'start')}${label(212, 92, '2  click a target', muted, 10, 'end')}`,
    ),
  },
  {
    title: 'Capture',
    text: 'Hits fill a cannon’s outer ring in your colour; eight flip it. The solid ring is the owner right now: light = yours, red = theirs. Take every cannon to win; your shots heal your own. The bar up top shows who holds how many; Surrender (it asks first) gives up the round.',
    art: svg(
      `${cannon(40, 50, gold)}${own(40, 50, ringYou)}<circle cx="96" cy="50" r="4" fill="${gold}"/><circle cx="124" cy="50" r="4" fill="${gold}"/><circle cx="152" cy="50" r="4" fill="${gold}"/>${cannon(196, 50, tinted, Math.PI)}${own(196, 50, ringEnemy)}<circle cx="196" cy="50" r="23.5" fill="none" stroke="${edge}" stroke-width="3.5"/><path d="M196 26.5 A23.5 23.5 0 1 1 173.2 55.9" fill="none" stroke="${gold}" stroke-width="3.5" stroke-linecap="round"/>${label(120, 90, '8 hits flip it')}`,
    ),
  },
  {
    title: 'Swap type',
    text: 'Hover a cannon (long-press on touch) for its menu: Normal, Sniper, Machine gun or Shield. The barrel shows the type; the body’s shape and colour are just its owner’s skin and team colour (pick yours in Settings). Each side’s edge of the board glows in its team’s colour.',
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
    text: 'Space (or the Pause button) freezes the round. Aim and swap as much as you like; it all happens at once when you resume. Online, the room’s host can turn pauses off.',
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
  {
    title: 'Void walls',
    text: 'The dark purple walls with a slow swirl swallow any shot that touches them: no bounce, just a puff. Aim around them; the AI won’t waste shots into them either.',
    art: svg(
      `${cannon(40, 50, gold, 0)}<circle cx="92" cy="50" r="4" fill="${gold}"/><circle cx="122" cy="50" r="4" fill="${gold}" fill-opacity=".7"/><rect x="150" y="18" width="22" height="64" rx="4" fill="${voidFill}" stroke="${voidEdge}" stroke-width="3"/><path d="M155 30q8 8 0 16t0 16" stroke="${voidRim}" stroke-opacity=".7" stroke-width="2" fill="none"/><circle cx="146" cy="50" r="9" fill="${voidRim}" fill-opacity=".35"/><circle cx="141" cy="44" r="2" fill="${voidSpark}"/><circle cx="140" cy="57" r="1.6" fill="${voidSpark}"/>${label(120, 92, 'swallows shots')}`,
    ),
  },
  {
    title: 'Rock pillars',
    text: 'Shots glance off a rock’s curve, round or oval: hit it off-centre and the shot flies off at a wide angle, while a long flat side bounces almost like a wall. The dark outline is its exact edge. Great for bank shots around a crowd.',
    art: svg(
      `${cannon(36, 66, gold, -0.32)}<polyline points="62,58 128,40 206,72" fill="none" stroke="${sel}" stroke-width="2.5" stroke-dasharray="6 5"/><ellipse cx="129.5" cy="23" rx="27" ry="14" fill="${rockEdge}"/><ellipse cx="129.5" cy="23" rx="24" ry="11" fill="${rockBase}"/><ellipse cx="124" cy="19" rx="14" ry="6" fill="${rockMid}"/><path d="M112 23l7 3 3 5M140 15l-4 6" stroke="${rockCrack}" stroke-width="1.5" fill="none"/><ellipse cx="146" cy="27" rx="4" ry="3" fill="${moss}"/><ellipse cx="141" cy="31" rx="3.5" ry="2.6" fill="${moss}"/><ellipse cx="145" cy="26" rx="2" ry="1.5" fill="${mossLight}"/>${cannon(212, 74, grey, Math.PI + 0.4, 12)}${label(120, 92, 'bounces off the curve')}`,
    ),
  },
  {
    title: 'One-way glass',
    text: 'Shots pass through a glass pane the way its arrows point and bounce off the bright side. Use it to guard a cannon from one side while you still fire out through it.',
    art: svg(
      `${cannon(34, 36, gold, 0, 13)}<line x1="56" y1="36" x2="196" y2="36" stroke="${gold}" stroke-width="2.5" stroke-dasharray="6 5"/><rect x="116" y="14" width="8" height="72" rx="2" fill="${glass}" fill-opacity=".2"/><line x1="124" y1="14" x2="124" y2="86" stroke="${glassRim}" stroke-width="2.5"/>${[26, 50, 74].map((y) => `<path d="M114 ${y - 5}l7 5-7 5z" fill="${glassRim}" fill-opacity=".8"/>`).join('')}${cannon(206, 66, pink, Math.PI, 13)}<polyline points="182,66 128,66 170,80" fill="none" stroke="${pink}" stroke-width="2.5" stroke-dasharray="6 5"/>${label(120, 96, 'through one way, bounce the other', muted, 9)}`,
    ),
  },
  {
    title: 'Breakable walls',
    text: 'Brick walls bounce shots like any wall, but every hit wears them down, whichever side fired it. They crack, then crumble for good and never come back, opening a new lane. The AI shoots them down when they hide its targets.',
    art: svg(
      `${cannon(34, 50, gold, 0, 13)}<line x1="56" y1="50" x2="136" y2="50" stroke="${gold}" stroke-width="2.5" stroke-dasharray="6 5"/>${bricks(140, 16, 6)}<path d="M146 18l4 9-3 8 5 9-2 10M158 50l-4 8 3 9-2 9" stroke="${brickCrack}" stroke-width="1.8" fill="none"/><rect x="172" y="30" width="7" height="5" rx="1" fill="${brick}" transform="rotate(25 175 32)"/><rect x="182" y="52" width="6" height="4" rx="1" fill="${brickLight}" transform="rotate(-30 185 54)"/><rect x="176" y="68" width="5" height="4" rx="1" fill="${brickDark}" transform="rotate(40 178 70)"/>${cannon(212, 50, pink, Math.PI, 12)}${label(120, 96, 'cracks, then crumbles for good', muted, 9)}`,
    ),
  },
  {
    title: 'Portals',
    text: 'A shot that falls into a portal comes out of its twin (same colour and mark) at the same speed. The notch on each rim shows its facing: same facing, the shot flies on the same way; otherwise it turns by the difference. No free range: the distance carries on.',
    art: svg(
      `${cannon(30, 62, gold, -0.12, 12)}<line x1="50" y1="60" x2="80" y2="56" stroke="${gold}" stroke-width="2.5" stroke-dasharray="6 5"/>${portal(96, 54, teal)}<rect x="128" y="14" width="12" height="74" rx="3" fill="${edge}"/>${portal(170, 26, teal)}<line x1="188" y1="24" x2="222" y2="20" stroke="${gold}" stroke-width="2.5" stroke-dasharray="6 5"/><path d="M110 70q30 14 56-30" stroke="${teal}" stroke-opacity=".5" stroke-width="1.5" stroke-dasharray="3 4" fill="none"/>${label(120, 98, 'in one, out the other', muted, 9)}`,
    ),
  },
  {
    title: 'Heal friends',
    wide: true,
    text: 'Select one of your cannons, then click one of yours that’s being captured: your hits heal it instead of hurting it. Once it’s whole: with auto-target on, the healer aims at the nearest foe by itself. With it off (or that cannon on manual, M), it goes back to its earlier aim, or waits for you to aim it if it had none or that target is now yours. Tip: heal a cannon a few hits from flipping; a sniper heals 2 per shot.',
    art: svg(
      `${cannon(40, 58, gold, -0.06)}${own(40, 58, ringYou)}<circle cx="94" cy="54" r="4" fill="${gold}"/><circle cx="120" cy="53" r="4" fill="${gold}"/><circle cx="146" cy="52" r="4" fill="${gold}"/>${cannon(196, 50, healing, Math.PI)}${own(196, 50, ringYou)}<circle cx="196" cy="50" r="23.5" fill="none" stroke="${edge}" stroke-width="3.5"/><path d="M196 26.5 A23.5 23.5 0 0 1 212.6 66.6" fill="none" stroke="${pink}" stroke-width="3.5" stroke-linecap="round"/><circle cx="196" cy="50" r="30" fill="none" stroke="${gold}" stroke-opacity=".45" stroke-width="2"/>${label(196, 15, '+1 heal', gold, 11)}${label(92, 90, 'your hits heal yours')}`,
    ),
  },
]
}

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
