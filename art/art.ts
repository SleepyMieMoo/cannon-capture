/**
 * Renders the store art (Discord cover, app icon, embedded background, README
 * preview) with the game's own drawing code: the real board, cannons, shots,
 * shield and fan, in a scripted mini battle. Dev only: served by Vite, driven
 * by scripts/render-art.mjs, never part of the game build.
 *
 *   /art/index.html?kind=cover|icon|background|preview[&t=ms]
 */
import Phaser from 'phaser'
import { BRAND } from '../src/config/brand'
import { cssHex, sideColor, theme } from '../src/config/theme'
import { TUNING } from '../src/config/tuning'
import { Fan } from '../src/entities/Fan'
import { Wall } from '../src/entities/Wall'
import { boardFor } from '../src/levels/board'
import { dash, drawShots } from '../src/render/battleMarks'
import { drawBoardSurface } from '../src/render/boardSurface'
import { BattleSim } from '../src/sim/BattleSim'
import { clipToWalls } from '../src/sim/geometry'
import type { CannonDef, FanDef, LevelDef, Rect } from '../src/types'

export type ArtKind = 'cover' | 'icon' | 'background' | 'preview'

/** Output size (px) per asset. */
export const ART_SIZES: Record<ArtKind, { w: number; h: number }> = {
  cover: { w: 1920, h: 1080 },
  background: { w: 1920, h: 1080 },
  preview: { w: 1280, h: 720 },
  icon: { w: 1024, h: 1024 },
}

interface Staging {
  /** The world area shown (its aspect is fitted to the output). */
  view: { cx: number; cy: number; w: number }
  cannons: CannonDef[]
  fans: FanDef[]
  /** Cannon whose capture ring should be mid-way when the frame is taken. */
  contested?: string
  /** Capture progress window (share of the threshold) to stop in. */
  progress?: [number, number]
  /** Fade-out of normal shots for stills (px). */
  trail: number
  /** Draw the dashed aim lines like the battle does. */
  aimLines: boolean
}

// Everything sits on a Medium board so the frame is board edge to edge.
const CX = 840
const CY = 504
const at = (dx: number, dy: number) => ({ x: CX + dx, y: CY + dy })

const BATTLE: Staging = {
  view: { cx: CX, cy: CY, w: 960 },
  cannons: [
    { id: 'c', name: 'A', ...at(0, 115), side: 'enemy', aimAt: 'g3' },
    { id: 'g1', name: 'B', ...at(-250, 120), side: 'player', aimAt: 'c' },
    { id: 'g4', name: 'C', ...at(-410, -30), side: 'player', kind: 'sniper', aimAt: 'c' },
    { id: 'g3', name: 'D', ...at(-140, 222), side: 'player', kind: 'shield', aimAt: 'p3' },
    { id: 'g2', name: 'E', ...at(-420, 215), side: 'player', kind: 'machinegun', aimAt: 'p1' },
    { id: 'p1', name: 'F', ...at(285, -5), side: 'enemy', aimAt: 'g1' },
    { id: 'p2', name: 'G', ...at(415, -95), side: 'enemy', kind: 'machinegun', aimAt: 'g4' },
    { id: 'p3', name: 'H', ...at(175, 228), side: 'enemy', aimAt: 'g3' },
    { id: 'n1', name: 'I', ...at(-330, -175), side: 'neutral' },
  ],
  fans: [{ x: CX + 385, y: CY + 185, radius: 60, angle: -Math.PI / 2 }],
  contested: 'c',
  progress: [0.5, 0.7],
  trail: 26,
  aimLines: true,
}

/** Embedded background: the action hugs the left and right edges, the middle stays calm. */
const EDGES: Staging = {
  view: { cx: CX, cy: CY, w: 960 },
  cannons: [
    { id: 'g1', name: 'A', ...at(-410, -190), side: 'player', aimAt: 'n1' },
    { id: 'g2', name: 'B', ...at(-330, 10), side: 'player', kind: 'machinegun', aimAt: 'n1' },
    { id: 'n1', name: 'C', ...at(-400, 200), side: 'neutral' },
    { id: 'p1', name: 'D', ...at(410, 190), side: 'enemy', aimAt: 'n2' },
    { id: 'p2', name: 'E', ...at(330, -10), side: 'enemy', kind: 'machinegun', aimAt: 'n2' },
    { id: 'n2', name: 'F', ...at(400, -200), side: 'neutral' },
    { id: 's1', name: 'G', ...at(-230, 195), side: 'player', kind: 'shield', aimPoint: at(-100, 270) },
    { id: 's2', name: 'H', ...at(230, -195), side: 'enemy', kind: 'shield', aimPoint: at(100, -270) },
  ],
  fans: [],
  contested: 'n1',
  progress: [0.4, 0.7],
  trail: 26,
  aimLines: true,
}

/** App icon: one bold gold cannon, barrel up and to the right. */
const ICON: Staging = {
  view: { cx: 500, cy: 500, w: 104 },
  cannons: [{ id: 'g', name: 'A', x: 500, y: 500, side: 'player', aimPoint: { x: 600, y: 400 } }],
  fans: [],
  trail: 0,
  aimLines: false,
}

const STAGING: Record<ArtKind, Staging> = { cover: BATTLE, preview: BATTLE, background: EDGES, icon: ICON }

/** Deterministic Math.random (the sim's spread), so every render is the same picture. */
function seedRandom(seed: number): void {
  let a = seed >>> 0
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const params = new URLSearchParams(location.search)
const kind = (params.get('kind') ?? 'cover') as ArtKind
const size = ART_SIZES[kind] ?? ART_SIZES.cover
const forceT = params.has('t') ? Number(params.get('t')) : null
const staging = STAGING[kind] ?? BATTLE

declare global {
  interface Window {
    __artReady?: { kind: ArtKind; t: number; shots: number; progress: number }
  }
}

class ArtScene extends Phaser.Scene {
  constructor() {
    super('art')
  }

  create(): void {
    seedRandom(7)
    const level: LevelDef = { id: 'art', name: 'Art', size: 'medium', cannons: staging.cannons, walls: [], fans: staging.fans }
    const board = boardFor(level)
    if (kind !== 'icon') {
      this.add.graphics().fillStyle(theme.bg, 1).fillRect(-400, -400, board.w + 800, board.h + 800)
      drawBoardSurface(this, board)
    }
    level.walls.forEach((rect) => new Wall(this, rect))
    const fans = level.fans.map((def) => new Fan(this, def))
    const fx = this.add.graphics().setDepth(3)

    const sim = new BattleSim(level, this, {}, 'progressive')
    // Scripted aims only: no AI on either side.
    sim.ais.length = 0

    const dt = 1000 / 60
    const contested = staging.contested ? sim.cannons.find((c) => c.id === staging.contested) : undefined
    const share = (): number => (contested ? contested.captureProgress / TUNING.captureThreshold : 0)
    let t = 0
    if (kind !== 'icon') {
      const [lo, hi] = staging.progress ?? [0, 1]
      const minShots = kind === 'background' ? 6 : 12
      while (t < 30_000) {
        sim.step(dt)
        t += dt
        if (forceT !== null) {
          if (t >= forceT) break
          continue
        }
        const p = share()
        if (t > 2500 && p >= lo && p <= hi && contested?.captureAttacker === 'player' && sim.shots.length >= minShots) break
      }
    }

    const time = t
    for (const fan of fans) fan.draw(time)
    for (const c of sim.cannons) c.draw(time)
    if (staging.aimLines) {
      for (const c of sim.cannons) {
        if (c.side === 'neutral' || !c.fires) continue
        const aim = c.aim()
        if (!aim) continue
        const end = clipToWalls(c.x, c.y, aim.x, aim.y, [] as Rect[])
        const color = c.side === 'player' ? theme.player : sideColor(c.side)
        dash(fx, c.x, c.y, end.x, end.y, TUNING.cannonRadius + 14, c.target ? TUNING.cannonRadius + 14 : 4, color, c.side === 'player' ? 0.4 : 0.34)
      }
    }
    drawShots(fx, sim.shots, staging.trail)
    if (kind === 'icon') drawIconRing(fx, sim.cannons[0].x, sim.cannons[0].y)

    const cam = this.cameras.main
    cam.setZoom(size.w / staging.view.w)
    cam.centerOn(staging.view.cx, staging.view.cy)

    let frames = 0
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, () => {
      if (++frames === 3) window.__artReady = { kind, t: Math.round(t), shots: sim.shots.length, progress: Math.round(share() * 100) / 100 }
    })
  }
}

/** The icon's ring: a capture tug-of-war, gold most of the way round, pink catching up. */
function drawIconRing(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  const r = TUNING.cannonRadius + 8
  const top = -Math.PI / 2
  const split = top + Math.PI * 2 * 0.62
  g.lineStyle(7, 0x000000, 0.3)
  g.strokeCircle(x, y + 1, r)
  g.lineStyle(6, theme.player, 1)
  g.beginPath()
  g.arc(x, y, r, top, split, false)
  g.strokePath()
  g.lineStyle(6, theme.enemy, 1)
  g.beginPath()
  g.arc(x, y, r, split + 0.12, top + Math.PI * 2 - 0.12, false)
  g.strokePath()
}

function styleOverlay(): void {
  const w = size.w
  const unit = w / 100
  const gold = cssHex(theme.player)
  const rgba = (c: number, a: number) => `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`
  const css = `
html, body { margin: 0; padding: 0; background: ${theme.bgCss}; overflow: hidden; }
#frame { position: relative; width: ${size.w}px; height: ${size.h}px; overflow: hidden;
  font-family: ${theme.font}; color: ${theme.text};
  ${kind === 'icon' ? `background: radial-gradient(circle at 50% 48%, ${cssHex(theme.board)} 0%, ${cssHex(theme.board)} 38%, ${theme.bgCss} 78%);` : ''} }
#stage, #overlay { position: absolute; inset: 0; }
#overlay { pointer-events: none; display: flex; flex-direction: column; align-items: center; }
.shade { position: absolute; inset: 0; background: radial-gradient(ellipse 46% 34% at 50% 27%, ${rgba(theme.bg, 0.86)} 0%, ${rgba(theme.bg, 0.55)} 55%, ${rgba(theme.bg, 0)} 100%); }
.title { position: relative; margin-top: ${size.h * 0.13}px; font-weight: bold; letter-spacing: .01em; line-height: 1.05; white-space: nowrap;
  font-size: ${unit * 6.4}px;
  text-shadow: 0 ${unit * 0.32}px 0 ${cssHex(theme.dim)}, 0 0 ${unit * 2.6}px ${rgba(theme.player, 0.28)}; }
.title span { color: ${gold}; }
.by { position: relative; color: ${theme.textMuted}; font-size: ${unit * 1.75}px; margin-top: ${unit * 0.5}px; text-shadow: 0 2px 0 ${cssHex(theme.dim)}; }
.tag { position: relative; color: ${theme.textMuted}; font-size: ${unit * 1.5}px; margin-top: ${unit * 0.35}px; opacity: .9; text-shadow: 0 2px 0 ${cssHex(theme.dim)}; }
`
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
  const overlay = document.getElementById('overlay')!
  if (kind === 'cover' || kind === 'preview') {
    overlay.innerHTML = `<div class="shade"></div><div class="title">${BRAND.title}</div><div class="by">${BRAND.byline}</div>${
      kind === 'preview' ? `<div class="tag">${BRAND.tagline}</div>` : ''
    }`
  }
}

styleOverlay()
void document.fonts.ready.then(() => {
  new Phaser.Game({
    // Canvas renderer: true arcs, so circles stay smooth at any zoom (the icon is ~9x).
    type: Phaser.CANVAS,
    parent: 'stage',
    width: size.w,
    height: size.h,
    transparent: kind === 'icon',
    backgroundColor: theme.bg,
    banner: false,
    audio: { noAudio: true },
    render: { antialias: true, antialiasGL: true, pixelArt: false, roundPixels: false, preserveDrawingBuffer: true },
    scale: { mode: Phaser.Scale.NONE, width: size.w, height: size.h },
    scene: [ArtScene],
  })
})
