import type { Side } from '../types'

/**
 * Central palette. Swap these values to reskin the game (a softer set will
 * suit a later cosy theme). The page background in index.html mirrors `bgCss`.
 */
export const theme = {
  font: 'Verdana, Geneva, Tahoma, sans-serif',
  bg: 0x141821,
  bgCss: '#141821',
  hud: 0x10141c,
  board: 0x1c2330,
  boardEdge: 0x323c50,
  grid: 0x283143,
  text: '#f4f0e6',
  textMuted: '#9aa6ba',
  ink: '#2a2112',
  player: 0xf0b429,
  playerHot: 0xffd36a,
  enemy: 0xe85d4c,
  neutral: 0x8e99ad,
  wall: 0x7d8da0,
  wallEdge: 0x465364,
  wallShine: 0xd5e2ef,
  fan: 0x3ecfc1,
  fanBlade: 0xf3fffd,
  select: 0xfff6d4,
  panel: 0x171d2a,
} as const

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
