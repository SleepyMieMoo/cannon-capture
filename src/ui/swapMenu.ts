import Phaser from 'phaser'
import { KIND_IDS, kindLabel } from '../config/kinds'
import { theme } from '../config/theme'
import { GAME_WIDTH } from '../config/layout'
import type { Cannon } from '../entities/Cannon'
import type { CannonKind } from '../types'

const PILL_W = 90
const PILL_H = 24
const GAP = 6
const PAD = 5
/** The auto-target toggle at the end of the row. */
const AUTO_W = 92
const AUTO_GAP = 14

/** What a pill does: swap to a tower type, or flip the cannon's auto-target toggle. */
export type MenuPick = CannonKind | 'auto'

/**
 * The cannon's auto-target state as the toggle pill shows it: on, off (its
 * own toggle), all-off (the global setting is off; its own toggle is kept),
 * or null to leave the pill out (puzzles: nothing auto-targets there).
 */
export type AutoState = 'on' | 'off' | 'all-off' | null

interface Pill {
  kind: MenuPick
  x: number
  y: number
  w: number
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
  private hot: MenuPick | null = null
  private pills: Pill[] = []
  private box = { x: 0, y: 0, w: 0, h: 0 }
  private readonly g: Phaser.GameObjects.Graphics
  private readonly labels: Map<MenuPick, Phaser.GameObjects.Text>

  constructor(
    scene: Phaser.Scene,
    ui: <T extends Phaser.GameObjects.GameObject>(obj: T) => T,
    private readonly autoState: (cannon: Cannon) => AutoState = () => null,
    /** A type swap queued for this cannon during a pause (shown outlined), if any. */
    private readonly pending: (cannon: Cannon) => CannonKind | null = () => null,
  ) {
    this.g = ui(scene.add.graphics().setDepth(40))
    this.labels = new Map(
      [...KIND_IDS, 'auto' as const].map((k) => [
        k,
        ui(
          scene.add
            .text(0, 0, k === 'auto' ? 'Auto' : kindLabel(k), { fontFamily: theme.font, fontSize: '12px', fontStyle: 'bold', color: theme.text })
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

  /** The pill (a type, or the auto-target toggle) under a layout point, if any. */
  pillAt(lx: number, ly: number): MenuPick | null {
    if (!this.cannon) return null
    for (const p of this.pills) {
      if (lx >= p.x - p.w / 2 && lx <= p.x + p.w / 2 && ly >= p.y - PILL_H / 2 && ly <= p.y + PILL_H / 2) return p.kind
    }
    return null
  }

  setHot(kind: MenuPick | null): void {
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
    const auto = this.autoState(cannon)
    const w = n * PILL_W + (n - 1) * GAP + PAD * 2 + (auto ? AUTO_GAP + AUTO_W : 0)
    const h = PILL_H + PAD * 2
    let y = at.y - radius - 18 - h
    if (y < top) y = at.y + radius + 18 // no room above: open below instead
    // Keep it on screen near the board's left and right edges 
    const x = Math.max(6, Math.min(GAME_WIDTH - 6 - w, at.x - w / 2))
    this.box = { x, y, w, h }
    this.g.fillStyle(theme.hud, 0.94)
    this.g.fillRoundedRect(x, y, w, h, 10)
    this.g.lineStyle(1.5, theme.boardEdge, 1)
    this.g.strokeRoundedRect(x, y, w, h, 10)
    this.pills = []
    const queued = this.pending(cannon)
    KIND_IDS.forEach((kind, i) => {
      const cx = x + PAD + PILL_W / 2 + i * (PILL_W + GAP)
      const cy = y + h / 2
      this.pills.push({ kind, x: cx, y: cy, w: PILL_W })
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
      if (queued === kind) {
        // Queued during a pause: swaps to this when you resume.
        this.g.fillStyle(theme.select, 0.22)
        this.g.fillRoundedRect(cx - PILL_W / 2, cy - PILL_H / 2, PILL_W, PILL_H, 8)
        this.g.lineStyle(2.5, theme.select, 1)
        this.g.strokeRoundedRect(cx - PILL_W / 2 - 1, cy - PILL_H / 2 - 1, PILL_W + 2, PILL_H + 2, 9)
      }
      const label = this.labels.get(kind)!
      label.setText(kindLabel(kind)).setPosition(cx, cy).setColor(active ? theme.ink : theme.text).setVisible(true)
    })
    const autoLabel = this.labels.get('auto')!
    if (auto) {
      // The auto-target toggle, set apart from the types by a thin divider.
      const dx = x + w - PAD - AUTO_W - AUTO_GAP / 2
      const cy = y + h / 2
      this.g.lineStyle(1, theme.boardEdge, 1)
      this.g.lineBetween(dx, y + 6, dx, y + h - 6)
      const cx = x + w - PAD - AUTO_W / 2
      this.pills.push({ kind: 'auto', x: cx, y: cy, w: AUTO_W })
      const hot = this.hot === 'auto'
      const on = auto === 'on'
      this.g.fillStyle(hot ? theme.grid : theme.board, 1)
      this.g.fillRoundedRect(cx - AUTO_W / 2, cy - PILL_H / 2, AUTO_W, PILL_H, 8)
      this.g.lineStyle(1.5, on || hot ? theme.player : theme.boardEdge, 1)
      this.g.strokeRoundedRect(cx - AUTO_W / 2, cy - PILL_H / 2, AUTO_W, PILL_H, 8)
      // A little switch: knob right and gold when on, left and grey when off.
      const sx = cx - AUTO_W / 2 + 18
      this.g.fillStyle(on ? theme.player : theme.grid, auto === 'all-off' ? 0.5 : 1)
      this.g.fillRoundedRect(sx - 10, cy - 5, 20, 10, 5)
      this.g.fillStyle(on ? theme.hud : theme.neutral, 1)
      this.g.fillCircle(on ? sx + 5 : sx - 5, cy, 3.5)
      autoLabel
        .setText(auto === 'on' ? 'Auto on' : auto === 'off' ? 'Auto off' : 'Auto (all off)')
        .setFontSize(auto === 'all-off' ? 10 : 12)
        .setPosition(cx + 10, cy)
        .setColor(on ? theme.text : theme.textMuted)
        .setVisible(true)
    } else autoLabel.setVisible(false)
    // A small tick from the menu to the cannon.
    const tipY = y > at.y ? y : y + h
    this.g.fillStyle(theme.hud, 0.94)
    this.g.fillTriangle(at.x - 6, tipY, at.x + 6, tipY, at.x, tipY + (y > at.y ? -7 : 7))
  }
}
