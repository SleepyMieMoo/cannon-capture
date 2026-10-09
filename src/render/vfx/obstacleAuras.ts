import Phaser from 'phaser'
import { VOID_COLOURS, portalColour, PORTAL } from '../../config/obstacles'
import { theme } from '../../config/theme'
import type { PortalMouth } from '../../sim/portals'
import type { FanDef, GlassDef, PillarDef, WallDef } from '../../types'
import type { FxConfig } from './fxQuality'

/**
 * Soft auras under the obstacles, at about half a tower aura's strength, in a
 * colour per type. Each one is a single image of a texture baked once when
 * the round starts (the obstacle's own shape, blurred), so a frame costs a
 * few alpha changes and nothing is allocated. Off: none; Low (or Reduce
 * motion): steady; High: a slow breath, subtler than the towers'.
 */
export const OBSTACLE_AURA = {
  alpha: 0.6,
  breathe: 0.1,
  /** Blur reach (px) and the margin baked round each shape for it. */
  blur: 16,
  margin: 30,
  depth: 0.6,
  colours: {
    wall: 0x9c8b78,
    rock: 0xa58f75,
    void: VOID_COLOURS.spark,
    brick: 0xd0784a,
    glass: 0xa8eef5,
  },
} as const

/** What a breakable wall's aura watches (hidden once it breaks). */
interface Breakable {
  readonly broken: boolean
}

interface Item {
  img: Phaser.GameObjects.Image
  phase: number
  wall: Breakable | null
}

type Shape = (ctx: CanvasRenderingContext2D) => void

let serial = 0

export interface ObstacleSet {
  walls: readonly { rect: WallDef; isBreakable: boolean; isVoid: boolean; broken: boolean }[]
  pillars: readonly PillarDef[]
  glass: readonly GlassDef[]
  fans: readonly FanDef[]
  mouths: readonly PortalMouth[]
}

export class ObstacleAuras {
  private readonly items: Item[] = []
  private readonly keys: string[] = []
  private cfg: FxConfig | null = null

  constructor(
    private readonly scene: Phaser.Scene,
    set: ObstacleSet,
    cfg: FxConfig,
    register: (o: Phaser.GameObjects.GameObject) => void = () => {},
  ) {
    const id = ++serial
    let n = 0
    const add = (minX: number, minY: number, maxX: number, maxY: number, colour: number, shape: Shape, wall: Breakable | null = null) => {
      const m = OBSTACLE_AURA.margin
      const w = Math.ceil(maxX - minX + m * 2)
      const h = Math.ceil(maxY - minY + m * 2)
      const key = `ob-aura-${id}-${n++}`
      const tex = scene.textures.createCanvas(key, w, h)
      if (!tex) return
      const ctx = tex.context
      // Only the blurred shadow of the shape lands on the canvas (the shape itself is drawn far off it).
      const off = w + h + 100
      ctx.save()
      ctx.shadowColor = '#ffffff'
      ctx.shadowBlur = OBSTACLE_AURA.blur
      ctx.shadowOffsetX = off
      ctx.translate(m - minX - off, m - minY)
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#ffffff'
      shape(ctx)
      ctx.restore()
      tex.refresh()
      this.keys.push(key)
      const img = scene.add.image(minX - m, minY - m, key).setOrigin(0, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(OBSTACLE_AURA.depth).setTint(colour).setVisible(false)
      register(img)
      this.items.push({ img, phase: this.items.length * 1.3, wall })
    }
    const C = OBSTACLE_AURA.colours
    for (const wall of set.walls) {
      const { x, y, w, h } = wall.rect
      const a = wall.rect.angle ?? 0
      const cx = x + w / 2
      const cy = y + h / 2
      const ex = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2
      const ey = (Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * h) / 2
      const colour = wall.isVoid ? C.void : wall.isBreakable ? C.brick : C.wall
      add(cx - ex, cy - ey, cx + ex, cy + ey, colour, (ctx) => {
        ctx.translate(cx, cy)
        ctx.rotate(a)
        ctx.fillRect(-w / 2, -h / 2, w, h)
      }, wall.isBreakable ? wall : null)
    }
    for (const p of set.pillars) {
      const ra = p.r
      const rb = p.ry ?? p.r
      const a = p.angle ?? 0
      const ex = Math.hypot(ra * Math.cos(a), rb * Math.sin(a))
      const ey = Math.hypot(ra * Math.sin(a), rb * Math.cos(a))
      add(p.x - ex, p.y - ey, p.x + ex, p.y + ey, C.rock, (ctx) => {
        ctx.beginPath()
        ctx.ellipse(p.x, p.y, ra, rb, a, 0, Math.PI * 2)
        ctx.fill()
      })
    }
    for (const g of set.glass) {
      const t = 4
      add(Math.min(g.x, g.x2) - t, Math.min(g.y, g.y2) - t, Math.max(g.x, g.x2) + t, Math.max(g.y, g.y2) + t, C.glass, (ctx) => {
        ctx.lineWidth = t * 2
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(g.x, g.y)
        ctx.lineTo(g.x2, g.y2)
        ctx.stroke()
      })
    }
    const disc = (x: number, y: number, r: number, colour: number) =>
      add(x - r, y - r, x + r, y + r, colour, (ctx) => {
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      })
    // Fans: round the hub (the field is already a soft disc of its own).
    for (const f of set.fans) disc(f.x, f.y, 22, theme.fan)
    for (const m of set.mouths) disc(m.x, m.y, PORTAL.radius, portalColour(m.pair))
    this.setConfig(cfg)
  }

  get count(): number {
    return this.items.length
  }

  setConfig(cfg: FxConfig): void {
    this.cfg = cfg
    for (const it of this.items) it.img.setVisible(cfg.aura && !it.wall?.broken).setAlpha(OBSTACLE_AURA.alpha)
  }

  /** Per frame: breathe (High, motion allowed) and hide broken walls' auras. */
  update(time: number): void {
    const cfg = this.cfg
    if (!cfg || !cfg.aura) return
    const moving = cfg.auraMotion && cfg.quality === 'high'
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]
      if (it.wall) {
        const show = !it.wall.broken
        if (it.img.visible !== show) it.img.setVisible(show)
      }
      if (moving) it.img.setAlpha(OBSTACLE_AURA.alpha + OBSTACLE_AURA.breathe * Math.sin(time / 1700 + it.phase))
    }
  }

  destroy(): void {
    for (const it of this.items) it.img.destroy()
    this.items.length = 0
    for (const key of this.keys) if (this.scene.textures.exists(key)) this.scene.textures.remove(key)
    this.keys.length = 0
  }
}
