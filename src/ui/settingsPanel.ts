import Phaser from 'phaser'
import { theme } from '../config/theme'

const W = 340
const PAD = 14
const SWITCH_W = 44
const SWITCH_H = 22

/** What a press on the panel hit. */
export type SettingsHit = 'auto' | 'close' | 'panel'

/** What the panel shows: the global auto-target toggle, and whether it can be changed here. */
export interface SettingsState {
  autoTarget: boolean
  /** Puzzles: nothing auto-targets, so the toggle is shown greyed out. */
  puzzle: boolean
}

/**
 * The in-game Settings panel (top right, under the HUD). Drawn on the fixed
 * UI camera and hit-tested by hand in layout units, like the swap menu, so it
 * never fights the board's click-to-aim input. One setting for now: the
 * global auto-target toggle for your cannons.
 */
export class SettingsPanel {
  open = false
  private box = { x: 0, y: 0, w: W, h: 0 }
  private sw = { x: 0, y: 0, w: SWITCH_W + 160, h: SWITCH_H + 8 }
  private closeAt = { x: 0, y: 0 }
  private hot: SettingsHit | null = null
  private readonly g: Phaser.GameObjects.Graphics
  private readonly title: Phaser.GameObjects.Text
  private readonly label: Phaser.GameObjects.Text
  private readonly value: Phaser.GameObjects.Text
  private readonly note: Phaser.GameObjects.Text
  private readonly close: Phaser.GameObjects.Text

  constructor(
    scene: Phaser.Scene,
    ui: <T extends Phaser.GameObjects.GameObject>(obj: T) => T,
    private readonly right: number,
    private readonly top: number,
  ) {
    const text = (size: number, color: string, bold = false) =>
      ui(
        scene.add
          .text(0, 0, '', { fontFamily: theme.font, fontSize: `${size}px`, fontStyle: bold ? 'bold' : 'normal', color })
          .setDepth(51)
          .setVisible(false),
      )
    this.g = ui(scene.add.graphics().setDepth(50))
    this.title = text(15, theme.text, true).setText('Settings')
    this.label = text(14, theme.text, true).setText('Auto-target').setOrigin(0, 0.5)
    this.value = text(13, theme.textMuted, true).setOrigin(1, 0.5)
    this.note = text(12, theme.textMuted).setWordWrapWidth(W - PAD * 2).setLineSpacing(3)
    this.close = text(18, theme.textMuted, true).setText('×').setOrigin(0.5)
  }

  toggle(): void {
    this.open = !this.open
  }

  hide(): void {
    this.open = false
  }

  contains(lx: number, ly: number): boolean {
    if (!this.open) return false
    const b = this.box
    return lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h
  }

  /** What is under a layout point (null when it is off the panel). */
  hitAt(lx: number, ly: number): SettingsHit | null {
    if (!this.contains(lx, ly)) return null
    if (Math.hypot(lx - this.closeAt.x, ly - this.closeAt.y) <= 14) return 'close'
    const s = this.sw
    if (lx >= s.x && lx <= s.x + s.w && ly >= s.y && ly <= s.y + s.h) return 'auto'
    return 'panel'
  }

  setHot(hit: SettingsHit | null): void {
    this.hot = hit
  }

  draw(state: SettingsState): void {
    this.g.clear()
    const parts = [this.title, this.label, this.value, this.note, this.close]
    if (!this.open) {
      for (const p of parts) p.setVisible(false)
      return
    }
    const x = this.right - W
    const y = this.top
    this.note.setText(
      state.puzzle
        ? 'Puzzles never auto-target: every aim there is yours to spend.'
        : state.autoTarget
          ? 'Your cannons pick a new target by themselves when theirs is captured, and cannons you capture aim at the nearest foe. To keep one cannon on manual, use the Auto pill in its hover menu (long-press on touch) or press M over it. Starts on every game.'
          : "Off for all your cannons: they keep the aim you gave them and never pick a target themselves (one whose target is captured holds its fire until you aim it). Each cannon's own toggle is kept for when this is back on. Starts on every game.",
    )
    const rowY = y + 52
    const noteY = rowY + 24
    const h = noteY - y + this.note.height + PAD
    this.box = { x, y, w: W, h }
    this.g.fillStyle(theme.hud, 0.97)
    this.g.fillRoundedRect(x, y, W, h, 12)
    this.g.lineStyle(1.5, theme.boardEdge, 1)
    this.g.strokeRoundedRect(x, y, W, h, 12)
    this.title.setPosition(x + PAD, y + 12).setVisible(true)
    this.closeAt = { x: x + W - 20, y: y + 21 }
    this.close.setPosition(this.closeAt.x, this.closeAt.y).setColor(this.hot === 'close' ? theme.text : theme.textMuted).setVisible(true)

    // The switch row (the whole row is clickable).
    this.sw = { x: x + PAD - 4, y: rowY - SWITCH_H / 2 - 4, w: W - PAD * 2 + 8, h: SWITCH_H + 8 }
    if (this.hot === 'auto' && !state.puzzle) {
      this.g.fillStyle(theme.board, 1)
      this.g.fillRoundedRect(this.sw.x, this.sw.y, this.sw.w, this.sw.h, 8)
    }
    const on = state.autoTarget && !state.puzzle
    const sx = x + PAD
    this.g.fillStyle(on ? theme.player : theme.grid, state.puzzle ? 0.45 : 1)
    this.g.fillRoundedRect(sx, rowY - SWITCH_H / 2, SWITCH_W, SWITCH_H, SWITCH_H / 2)
    this.g.fillStyle(on ? theme.hud : theme.neutral, state.puzzle ? 0.6 : 1)
    this.g.fillCircle(on ? sx + SWITCH_W - SWITCH_H / 2 : sx + SWITCH_H / 2, rowY, SWITCH_H / 2 - 3)
    this.label.setPosition(sx + SWITCH_W + 12, rowY).setColor(state.puzzle ? theme.textMuted : theme.text).setVisible(true)
    this.value
      .setText(state.puzzle ? 'Off in puzzles' : state.autoTarget ? 'On for your cannons' : 'Off for all')
      .setPosition(x + W - PAD, rowY)
      .setColor(on ? theme.text : theme.textMuted)
      .setVisible(true)
    this.note.setPosition(x + PAD, noteY).setVisible(true)
  }
}
