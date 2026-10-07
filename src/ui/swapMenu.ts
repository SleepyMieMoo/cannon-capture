import Phaser from 'phaser'
import { KINDS, KIND_IDS, kindLabel } from '../config/kinds'
import { theme } from '../config/theme'
import type { Cannon } from '../entities/Cannon'
import type { CannonKind } from '../types'

const PILL_W = 78
const PILL_H = 24
const GAP = 6
const PAD = 5

interface Pill {
  kind: CannonKind
  x: number
  y: number
}

/**
 * The little tower-type menu that pops up over one of your cannons in play.
 * Drawn on the fixed UI camera (constant size at any zoom) and hit-tested by
 * hand in layout units, so it never fights the board's click-to-aim input.
 * One pill per entry in KIND_IDS, so new types show up automatically.
 */
export class SwapMenu {
  cannon: Cannon | null = null
  /** Pinned by a long-press or a tap on the selected cannon (touch); stays until used or dismissed. */
  pinned = false
  private grace = 0
  private hot: CannonKind | null = null
  private pills: Pill[] = []
  private box = { x: 0, y: 0, w: 0, h: 0 }
  private readonly g: Phaser.GameObjects.Graphics
  private readonly labels: Map<CannonKind, Phaser.GameObjects.Text>

  constructor(scene: Phaser.Scene, ui: <T extends Phaser.GameObjects.GameObject>(obj: T) => T) {
    this.g = ui(scene.add.graphics().setDepth(40))
    this.labels = new Map(
      KIND_IDS.map((k) => [
        k,
        ui(
          scene.add
            .text(0, 0, KINDS[k].label, { fontFamily: theme.font, fontSize: '12px', fontStyle: 'bold', color: theme.text })
            .setOrigin(0.5)
            .setDepth(41)
            .setVisible(false),
        ),
      ]),
    )
  }

  get open(): boolean {
    return this.cannon !== null
  }

  show(cannon: Cannon, pinned = false): void {
    this.cannon = cannon
    this.pinned = pinned || (this.pinned && this.cannon === cannon)
    this.grace = 380
  }

  hide(): void {
    this.cannon = null
    this.pinned = false
    this.hot = null
  }

  /** True when the layout point is over the menu (pills or its backing). */
  contains(lx: number, ly: number): boolean {
    if (!this.cannon) return false
    const b = this.box
    return lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h
  }

  /** The type under a layout point, if any. */
  pillAt(lx: number, ly: number): CannonKind | null {
    if (!this.cannon) return null
    for (const p of this.pills) {
      if (lx >= p.x - PILL_W / 2 && lx <= p.x + PILL_W / 2 && ly >= p.y - PILL_H / 2 && ly <= p.y + PILL_H / 2) return p.kind
    }
    return null
  }

  setHot(kind: CannonKind | null): void {
    this.hot = kind
  }

  /**
   * Per frame. `candidate` is the cannon the pointer is on that may show the
   * menu (or null). The menu lingers briefly after the pointer leaves so it
   * can travel onto a pill.
   */
  update(dt: number, candidate: Cannon | null, pointerOnMenu: boolean): void {
    if (this.cannon && this.cannon.side !== 'player') this.hide()
    if (candidate && !(this.pinned && this.cannon && this.cannon !== candidate)) this.show(candidate)
    else if (this.cannon && !this.pinned && !pointerOnMenu) {
      this.grace -= dt
      if (this.grace <= 0) this.hide()
    }
  }

  /**
   * Draw above the cannon. `at` is the cannon's position in layout units,
   * `radius` its on-screen radius; `top` is the lowest y the menu may use.
   */
  draw(at: { x: number; y: number } | null, radius: number, top: number): void {
    this.g.clear()
    const cannon = this.cannon
    if (!cannon || !at) {
      for (const t of this.labels.values()) t.setVisible(false)
      this.pills = []
      return
    }
    const n = KIND_IDS.length
    const w = n * PILL_W + (n - 1) * GAP + PAD * 2
    const h = PILL_H + PAD * 2
    let y = at.y - radius - 18 - h
    if (y < top) y = at.y + radius + 18 // no room above: open below instead
    const x = at.x - w / 2
    this.box = { x, y, w, h }
    this.g.fillStyle(theme.hud, 0.94)
    this.g.fillRoundedRect(x, y, w, h, 10)
    this.g.lineStyle(1.5, theme.boardEdge, 1)
    this.g.strokeRoundedRect(x, y, w, h, 10)
    this.pills = []
    KIND_IDS.forEach((kind, i) => {
      const cx = x + PAD + PILL_W / 2 + i * (PILL_W + GAP)
      const cy = y + h / 2
      this.pills.push({ kind, x: cx, y: cy })
      const active = cannon.kind === kind
      const hot = this.hot === kind
      if (active) {
        this.g.fillStyle(theme.player, 1)
        this.g.fillRoundedRect(cx - PILL_W / 2, cy - PILL_H / 2, PILL_W, PILL_H, 8)
      } else {
        this.g.fillStyle(hot ? theme.grid : theme.board, 1)
        this.g.fillRoundedRect(cx - PILL_W / 2, cy - PILL_H / 2, PILL_W, PILL_H, 8)
        this.g.lineStyle(1.5, hot ? theme.player : theme.boardEdge, 1)
        this.g.strokeRoundedRect(cx - PILL_W / 2, cy - PILL_H / 2, PILL_W, PILL_H, 8)
      }
      const label = this.labels.get(kind)!
      const text = kind === cannon.kind ? kindLabel(kind, cannon.delay) : KINDS[kind].delays ? kindLabel(kind, cannon.rememberedDelay(kind)) : KINDS[kind].label
      label.setText(text).setPosition(cx, cy).setColor(active ? theme.ink : theme.text).setVisible(true)
    })
    // A small tick from the menu to the cannon.
    const tipY = y > at.y ? y : y + h
    this.g.fillStyle(theme.hud, 0.94)
    this.g.fillTriangle(at.x - 6, tipY, at.x + 6, tipY, at.x, tipY + (y > at.y ? -7 : 7))
  }
}
