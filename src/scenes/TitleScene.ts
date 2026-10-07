import Phaser from 'phaser'
import { GAME_HEIGHT, GAME_WIDTH } from '../config/layout'
import { shade, theme } from '../config/theme'
import { DEBUG } from '../debug'
import { findLevel } from '../levels'
import { bindSceneResolution } from '../render/resolution'
import { makeButton } from '../ui/button'

let launchedFromUrl = false

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('title')
  }

  create(): void {
    // ?level=<id> jumps straight into a level once per page load.
    if (!launchedFromUrl && DEBUG.level && findLevel(DEBUG.level)) {
      launchedFromUrl = true
      this.scene.start('battle', { levelId: DEBUG.level })
      return
    }
    launchedFromUrl = true

    bindSceneResolution(this)
    const cx = GAME_WIDTH / 2
    const g = this.add.graphics()
    g.fillStyle(theme.bg, 1)
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)
    g.fillStyle(theme.board, 1)
    g.fillRoundedRect(24, 24, GAME_WIDTH - 48, GAME_HEIGHT - 48, 22)
    g.lineStyle(2, theme.boardEdge, 1)
    g.strokeRoundedRect(24, 24, GAME_WIDTH - 48, GAME_HEIGHT - 48, 22)
    g.fillStyle(theme.grid, 1)
    for (let x = 60; x < GAME_WIDTH - 40; x += 32) for (let y = 56; y < GAME_HEIGHT - 40; y += 32) g.fillCircle(x, y, 1.6)

    // Two duelling cannons as a little logo scene.
    const duel = this.add.graphics()
    const drawCannon = (x: number, y: number, color: number, angle: number): void => {
      duel.fillStyle(0x000000, 0.28)
      duel.fillEllipse(x, y + 18, 56, 13)
      duel.fillStyle(shade(color, 0.62), 1)
      const bx = Math.cos(angle)
      const by = Math.sin(angle)
      duel.lineStyle(12, shade(color, 0.62), 1)
      duel.lineBetween(x + bx * 8, y + by * 8, x + bx * 44, y + by * 44)
      duel.fillStyle(color, 1)
      duel.fillCircle(x, y, 30)
      duel.fillStyle(0xffffff, 0.2)
      duel.fillCircle(x - 7, y - 8, 12)
    }
    drawCannon(300, 560, theme.player, -0.12)
    drawCannon(900, 560, theme.enemy, Math.PI + 0.12)
    for (let x = 352; x < 848; x += 22) {
      const t = (x - 300) / 600
      duel.fillStyle(x < 600 ? theme.player : theme.enemy, 0.5)
      duel.fillRect(x, 553 - Math.sin(t * Math.PI) * 26, 12, 3)
    }

    this.add
      .text(cx, 190, 'Cannon Capture', {
        fontFamily: theme.font,
        fontSize: '64px',
        fontStyle: 'bold',
        color: theme.text,
      })
      .setOrigin(0.5)
    this.add
      .text(cx, 252, 'Aim. Fire. Flip the board.', { fontFamily: theme.font, fontSize: '20px', color: theme.textMuted })
      .setOrigin(0.5)

    makeButton(this, cx, 360, 'Campaign', () => this.scene.start('map'), { width: 260, height: 56, fontSize: 20 })
    const row = 432
    makeButton(this, cx - 216, row, 'Quick skirmish', () => this.scene.start('battle', { levelId: 'skirmish' }), {
      width: 200,
      height: 50,
      primary: false,
    })
    makeButton(this, cx, row, 'Map editor', () => this.scene.start('editor'), { width: 200, height: 50, primary: false })
    makeButton(this, cx + 216, row, 'My maps', () => this.scene.start('maps'), { width: 200, height: 50, primary: false })

    this.add
      .text(cx, GAME_HEIGHT - 58, 'A SleepyMie game  ·  colours from ChocoNeko', {
        fontFamily: theme.font,
        fontSize: '13px',
        color: theme.textMuted,
      })
      .setOrigin(0.5)

    this.input.keyboard?.once('keydown-ENTER', () => this.scene.start('map'))
  }
}
