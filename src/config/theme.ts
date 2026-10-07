import type { Side } from '../types'

/**
 * Palette source: ChocoNeko's colour themes (SleepyMie's studio), copied from
 * css/themes.css in the public choconeko-site repo
 * (https://github.com/SleepyMieMoo/choconeko-site/blob/main/css/themes.css).
 * Only the colours are shared, no ChocoNeko characters, story or assets.
 *
 * To re-sync, update CHOCO_THEMES from that file. To switch the look, change
 * ACTIVE_THEME. Gameplay code only reads `theme` below.
 */
interface ChocoTheme {
  name: string
  dark: boolean
  panel: string
  elevated: string
  button: string
  deep: string
  border: string
  text: string
  muted: string
  accent: string
  accentInk: string
  onAccent: string
  controlBorder: string
  edge: string
}

export const CHOCO_THEMES = {
  'dark-choco': { name: 'Dark Choco', dark: true, panel: '#140E0C', elevated: '#201612', button: '#2A1E18', deep: '#1C1410', border: '#48342A', text: '#F3E6D8', muted: '#B49E8A', accent: '#FFC800', accentInk: '#FFC800', onAccent: '#140E0C', controlBorder: '#7B695E', edge: '#0B0807' },
  'chocolate': { name: 'Chocolate', dark: true, panel: '#4A2E1C', elevated: '#5C3A24', button: '#6C442A', deep: '#442A1A', border: '#825C44', text: '#FFF4E6', muted: '#D2B49B', accent: '#FFC800', accentInk: '#FFC800', onAccent: '#4A2E1C', controlBorder: '#B49985', edge: '#29190F' },
  'dark': { name: 'Dark', dark: true, panel: '#08080A', elevated: '#101014', button: '#16161C', deep: '#0E0E12', border: '#2A2A32', text: '#EBEBF0', muted: '#A0A5B4', accent: '#FFC800', accentInk: '#FFC800', onAccent: '#08080A', controlBorder: '#66666D', edge: '#040406' },
  'light': { name: 'Light', dark: false, panel: '#F2F3F7', elevated: '#FFFFFF', button: '#E4E6EE', deep: '#DCDEE8', border: '#BEC2CE', text: '#16181E', muted: '#5A5E6C', accent: '#FFC800', accentInk: '#865609', onAccent: '#16181E', controlBorder: '#797C86', edge: '#797C86' },
  'vanilla': { name: 'Vanilla', dark: false, panel: '#F3E8D6', elevated: '#FFF6EA', button: '#E4D2BC', deep: '#DAC6AC', border: '#C6AC8E', text: '#3E2A1C', muted: '#674E39', accent: '#FFC800', accentInk: '#734907', onAccent: '#3E2A1C', controlBorder: '#7F6853', edge: '#7F6853' },
  'lemon': { name: 'Lemon', dark: false, panel: '#FCF6DA', elevated: '#FFFCEE', button: '#EEE0B2', deep: '#E4D6A8', border: '#D2C08A', text: '#483A1C', muted: '#6B5A33', accent: '#FFC800', accentInk: '#7F5108', onAccent: '#483A1C', controlBorder: '#85754C', edge: '#85754C' },
  'peach': { name: 'Peach', dark: false, panel: '#FFECDA', elevated: '#FFF8F0', button: '#F8D2B2', deep: '#EEC4A2', border: '#DCB28E', text: '#58301C', muted: '#784A31', accent: '#FFC800', accentInk: '#784C08', onAccent: '#58301C', controlBorder: '#8E654B', edge: '#8E654B' },
  'strawberry': { name: 'Strawberry', dark: false, panel: '#FCE8EC', elevated: '#FFF8FA', button: '#F0CCD4', deep: '#E8C4CC', border: '#DAA8B2', text: '#4E202A', muted: '#7D4650', accent: '#FFC800', accentInk: '#784C08', onAccent: '#4E202A', controlBorder: '#93636D', edge: '#93636D' },
  'mint': { name: 'Mint', dark: false, panel: '#E4F6EA', elevated: '#F4FCF8', button: '#C4E4D0', deep: '#B8DCC6', border: '#9EC6AC', text: '#1C3E2A', muted: '#3D6249', accent: '#FFC800', accentInk: '#7C5008', onAccent: '#1C3E2A', controlBorder: '#587D66', edge: '#587D66' },
  'blueberry': { name: 'Blueberry', dark: false, panel: '#E0EEFC', elevated: '#F4F9FF', button: '#C4DAF2', deep: '#C8DCF4', border: '#A8BEDC', text: '#1C304E', muted: '#4A5F83', accent: '#FFC800', accentInk: '#815308', onAccent: '#1C304E', controlBorder: '#637896', edge: '#657A98' },
  'lavender': { name: 'Lavender', dark: false, panel: '#EEE8FC', elevated: '#FAF8FF', button: '#D6CCF0', deep: '#D2C6EE', border: '#B8A8DA', text: '#30204E', muted: '#5E4B84', accent: '#FFC800', accentInk: '#784C08', onAccent: '#30204E', controlBorder: '#776797', edge: '#776797' },
} satisfies Record<string, ChocoTheme>

export type ChocoThemeId = keyof typeof CHOCO_THEMES

/** The one switch for the game's look. */
export const ACTIVE_THEME: ChocoThemeId = 'dark-choco'

const hex = (css: string): number => parseInt(css.replace('#', ''), 16)

function mix(a: string | number, b: string | number, t: number): number {
  return lerpColor(typeof a === 'string' ? hex(a) : a, typeof b === 'string' ? hex(b) : b, t)
}

/**
 * Maps a ChocoNeko site theme onto the game's slots.
 * - Player = ChocoNeko's shared gold accent (deepened on light themes so it
 *   reads on a pale board).
 * - Enemy = strawberry pink, neutral = the theme's warm grey, fan = mint.
 *   These three are game-only additions picked to stay clearly apart from the
 *   gold (and from each other) so the capture tint stays visible.
 * - Board, walls, HUD and text come straight from the theme's surfaces.
 */
function buildPalette(t: ChocoTheme) {
  const player = t.dark ? hex(t.accent) : 0xd99a00
  const enemy = t.dark ? 0xf2637e : 0xc8385a
  const fan = t.dark ? 0x5fd3a0 : 0x2e9c6e
  return {
    font: 'Verdana, Geneva, Tahoma, sans-serif',
    bg: hex(t.panel),
    bgCss: t.panel,
    hud: hex(t.deep),
    board: hex(t.elevated),
    boardEdge: hex(t.border),
    grid: hex(t.button),
    text: t.text,
    textMuted: t.muted,
    ink: t.dark ? t.onAccent : t.text,
    player,
    playerHot: mix(player, 0xffffff, 0.3),
    enemy,
    neutral: mix(t.muted, t.controlBorder, 0.5),
    wall: mix(t.border, t.muted, t.dark ? 0.3 : 0.45),
    wallEdge: t.dark ? hex(t.edge) : mix(t.border, t.text, 0.4),
    wallShine: hex(t.text),
    fan,
    fanBlade: t.dark ? mix(fan, 0xffffff, 0.85) : 0xffffff,
    select: mix(player, 0xffffff, 0.75),
    panel: hex(t.deep),
    dim: hex(t.edge),
    spark: hex(t.dark ? t.text : t.muted),
  } as const
}

export const theme = buildPalette(CHOCO_THEMES[ACTIVE_THEME])

export function sideColor(side: Side): number {
  if (side === 'player') return theme.player
  if (side === 'enemy') return theme.enemy
  return theme.neutral
}

export function cssHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

export function lerpColor(from: number, to: number, t: number): number {
  const u = Math.min(1, Math.max(0, t))
  const fr = (from >> 16) & 255
  const fg = (from >> 8) & 255
  const fb = from & 255
  const tr = (to >> 16) & 255
  const tg = (to >> 8) & 255
  const tb = to & 255
  const r = Math.round(fr + (tr - fr) * u)
  const g = Math.round(fg + (tg - fg) * u)
  const b = Math.round(fb + (tb - fb) * u)
  return (r << 16) | (g << 8) | b
}

export function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * factor))
  const g = Math.min(255, Math.round(((color >> 8) & 255) * factor))
  const b = Math.min(255, Math.round((color & 255) * factor))
  return (r << 16) | (g << 8) | b
}
