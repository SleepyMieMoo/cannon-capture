import Phaser from 'phaser'
import { GAME_HEIGHT, GAME_WIDTH } from '../config/layout'
import { theme } from '../config/theme'
import { CAMPAIGN } from '../levels'
import { loadProgress } from '../progress'
import { bindSceneResolution } from '../render/resolution'
import { currentLevelIndex, isUnlocked, type Progress } from '../sim/stars'
import { drawStar, makeButton } from '../ui/button'

/** Node positions along the winding campaign path (world coordinates). */
const NODES: { x: number; y: number }[] = [
  { x: 130, y: 450 },
  { x: 270, y: 300 },
  { x: 420, y: 430 },
  { x: 560, y: 260 },
  { x: 700, y: 410 },
  { x: 840, y: 240 },
  { x: 980, y: 400 },
  { x: 1090, y: 230 },
]
const NODE_R = 30

export interface MapData {
  focus?: string
}

export class MapScene extends Phaser.Scene {
  private progress: Progress = { stars: {} }
  private focus = 0
  private nodeLayer!: Phaser.GameObjects.Graphics
  private cardTitle!: Phaser.GameObjects.Text
  private cardKind!: Phaser.GameObjects.Text
  private cardHint!: Phaser.GameObjects.Text
  private cardStars!: Phaser.GameObjects.Graphics
  private playButton!: Phaser.GameObjects.Container

  constructor() {
    super('map')
  }

  create(data: MapData): void {
    bindSceneResolution(this)
    this.progress = loadProgress()
    const focusIndex = CAMPAIGN.findIndex((level) => level.id === data?.focus)
    const current = currentLevelIndex(CAMPAIGN, this.progress)
    // After a win, highlight the newly unlocked level; otherwise the one you came from.
    this.focus = focusIndex >= 0 && isUnlocked(CAMPAIGN, focusIndex, this.progress) ? focusIndex : current
    if (focusIndex >= 0 && (this.progress.stars[CAMPAIGN[focusIndex].id] ?? 0) > 0 && focusIndex + 1 === current) {
      this.focus = current
    }

    this.drawBackground()
    this.drawPath()
    this.nodeLayer = this.add.graphics().setDepth(2)
    CAMPAIGN.forEach((level, i) => {
      const node = NODES[i]
      this.add
        .text(node.x, node.y + NODE_R + 30, level.name, {
          fontFamily: theme.font,
          fontSize: '14px',
          fontStyle: 'bold',
          color: isUnlocked(CAMPAIGN, i, this.progress) ? theme.text : theme.textMuted,
        })
        .setOrigin(0.5, 0)
        .setDepth(3)
      this.add
        .text(node.x, node.y, String(i + 1), {
          fontFamily: theme.font,
          fontSize: '20px',
          fontStyle: 'bold',
          color: this.nodeDone(i) ? theme.ink : isUnlocked(CAMPAIGN, i, this.progress) ? theme.text : theme.textMuted,
        })
        .setOrigin(0.5)
        .setDepth(4)
      const zone = this.add.zone(node.x, node.y, NODE_R * 2 + 24, NODE_R * 2 + 60).setInteractive({ useHandCursor: true })
      zone.on('pointerdown', () => this.onNode(i))
    })
    this.createCard()
    this.refresh()

    this.input.keyboard?.on('keydown-ENTER', () => this.play())
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('title'))
  }

  update(time: number): void {
    this.drawNodes(time)
  }

  private nodeDone(i: number): boolean {
    return (this.progress.stars[CAMPAIGN[i].id] ?? 0) > 0
  }

  private onNode(i: number): void {
    if (!isUnlocked(CAMPAIGN, i, this.progress)) {
      this.cameras.main.shake(120, 0.002)
      return
    }
    if (i === this.focus) return this.play()
    this.focus = i
    this.refresh()
  }

  private play(): void {
    this.scene.start('battle', { levelId: CAMPAIGN[this.focus].id })
  }

  private drawBackground(): void {
    const g = this.add.graphics()
    g.fillStyle(theme.bg, 1)
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)
    g.fillStyle(theme.hud, 1)
    g.fillRect(0, 0, GAME_WIDTH, 72)
    g.fillStyle(theme.boardEdge, 1)
    g.fillRect(0, 72, GAME_WIDTH, 2)
    g.fillStyle(theme.board, 1)
    g.fillRoundedRect(24, 88, GAME_WIDTH - 48, 608, 18)
    g.lineStyle(2, theme.boardEdge, 1)
    g.strokeRoundedRect(24, 88, GAME_WIDTH - 48, 608, 18)
    g.fillStyle(theme.grid, 1)
    for (let x = 60; x < GAME_WIDTH - 40; x += 32) for (let y = 116; y < 680; y += 32) g.fillCircle(x, y, 1.6)

    this.add.text(28, 14, 'Campaign', { fontFamily: theme.font, fontSize: '22px', fontStyle: 'bold', color: theme.text })
    this.add.text(28, 44, 'Beat a level to unlock the next. Progress saves in this browser.', {
      fontFamily: theme.font,
      fontSize: '14px',
      color: theme.textMuted,
    })
    const total = CAMPAIGN.reduce((sum, level) => sum + (this.progress.stars[level.id] ?? 0), 0)
    const sg = this.add.graphics()
    drawStar(sg, 880, 36, 11, true)
    this.add
      .text(898, 36, `${total} / ${CAMPAIGN.length * 3}`, {
        fontFamily: theme.font,
        fontSize: '16px',
        fontStyle: 'bold',
        color: theme.text,
      })
      .setOrigin(0, 0.5)
    const back = this.add
      .text(GAME_WIDTH - 28, 36, 'Menu', { fontFamily: theme.font, fontSize: '14px', color: theme.textMuted })
      .setOrigin(1, 0.5)
      .setInteractive({ useHandCursor: true })
    back.on('pointerover', () => back.setColor(theme.text))
    back.on('pointerout', () => back.setColor(theme.textMuted))
    back.on('pointerdown', () => this.scene.start('title'))
  }

  private drawPath(): void {
    const curve = new Phaser.Curves.Spline(NODES.map((n) => new Phaser.Math.Vector2(n.x, n.y)))
    const points = curve.getSpacedPoints(400)
    const g = this.add.graphics().setDepth(1)
    g.lineStyle(14, theme.grid, 1)
    g.strokePoints(points, false)
    // Gold dashes over the stretch you have already walked.
    const doneTo = Math.max(0, CAMPAIGN.findIndex((_, i) => !this.nodeDone(i)))
    const reached = this.nodeDone(CAMPAIGN.length - 1) ? CAMPAIGN.length - 1 : doneTo
    const fraction = reached / (NODES.length - 1)
    const upto = Math.floor(points.length * fraction)
    for (let i = 0; i + 2 < Math.min(upto, points.length); i += 6) {
      g.lineStyle(4, theme.player, 0.8)
      g.lineBetween(points[i].x, points[i].y, points[i + 2].x, points[i + 2].y)
    }
    for (let i = upto; i + 2 < points.length; i += 6) {
      g.lineStyle(3, theme.boardEdge, 0.9)
      g.lineBetween(points[i].x, points[i].y, points[i + 2].x, points[i + 2].y)
    }
  }

  private drawNodes(time: number): void {
    const g = this.nodeLayer
    g.clear()
    CAMPAIGN.forEach((level, i) => {
      const { x, y } = NODES[i]
      const unlocked = isUnlocked(CAMPAIGN, i, this.progress)
      const done = this.nodeDone(i)
      const focused = i === this.focus
      const puzzle = level.kind === 'puzzle'
      if (focused) {
        g.lineStyle(3, theme.select, 0.55 + 0.35 * Math.sin(time / 180))
        if (puzzle) strokeDiamond(g, x, y, NODE_R + 12)
        else g.strokeCircle(x, y, NODE_R + 10)
      }
      g.fillStyle(0x000000, 0.28)
      g.fillEllipse(x, y + NODE_R - 4, NODE_R * 1.8, 12)
      const fill = done ? theme.player : unlocked ? theme.panel : theme.grid
      const edge = done ? theme.playerHot : unlocked ? theme.player : theme.boardEdge
      g.fillStyle(fill, 1)
      g.lineStyle(3, edge, 1)
      if (puzzle) {
        fillDiamond(g, x, y, NODE_R + 4)
        strokeDiamond(g, x, y, NODE_R + 4)
      } else {
        g.fillCircle(x, y, NODE_R)
        g.strokeCircle(x, y, NODE_R)
      }
      if (!unlocked) drawLock(g, x + NODE_R - 4, y - NODE_R + 4)
      const stars = this.progress.stars[level.id] ?? 0
      if (unlocked) for (let s = 0; s < 3; s++) drawStar(g, x - 18 + s * 18, y + NODE_R + 16, 7, s < stars)
    })
  }

  private createCard(): void {
    const w = 760
    const h = 112
    const cx = GAME_WIDTH / 2
    const cy = 696 - 18 - h / 2
    const bg = this.add.graphics()
    bg.fillStyle(theme.panel, 0.96)
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 16)
    bg.lineStyle(2, theme.boardEdge, 1)
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 16)
    this.cardTitle = this.add.text(-w / 2 + 24, -h / 2 + 16, '', {
      fontFamily: theme.font,
      fontSize: '20px',
      fontStyle: 'bold',
      color: theme.text,
    })
    this.cardKind = this.add.text(-w / 2 + 24, -h / 2 + 46, '', {
      fontFamily: theme.font,
      fontSize: '13px',
      fontStyle: 'bold',
      color: theme.textMuted,
    })
    this.cardHint = this.add.text(-w / 2 + 24, -h / 2 + 68, '', {
      fontFamily: theme.font,
      fontSize: '14px',
      color: theme.textMuted,
      wordWrap: { width: w - 260 },
    })
    this.cardStars = this.add.graphics()
    this.playButton = makeButton(this, w / 2 - 110, 0, 'Play', () => this.play(), { width: 180, height: 52, fontSize: 20 })
    this.add
      .container(cx, cy, [bg, this.cardTitle, this.cardKind, this.cardHint, this.cardStars, this.playButton])
      .setDepth(6)
  }

  private refresh(): void {
    const level = CAMPAIGN[this.focus]
    this.cardTitle.setText(`${this.focus + 1}. ${level.name}`)
    const kind = level.kind === 'puzzle' ? `PUZZLE${level.aims !== undefined ? `  ·  ${level.aims} aims` : ''}` : 'BATTLE'
    this.cardKind.setText(kind)
    this.cardKind.setColor(level.kind === 'puzzle' ? '#5fd3a0' : theme.textMuted)
    this.cardHint.setText(level.hint ?? '')
    const stars = this.progress.stars[level.id] ?? 0
    this.cardStars.clear()
    const titleRight = -380 + 24 + this.cardTitle.width + 22
    for (let s = 0; s < 3; s++) drawStar(this.cardStars, titleRight + s * 24, -56 + 28, 9, s < stars)
  }
}

function fillDiamond(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
  g.fillPoints([
    new Phaser.Math.Vector2(x, y - r),
    new Phaser.Math.Vector2(x + r, y),
    new Phaser.Math.Vector2(x, y + r),
    new Phaser.Math.Vector2(x - r, y),
  ], true)
}

function strokeDiamond(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
  g.strokePoints([
    new Phaser.Math.Vector2(x, y - r),
    new Phaser.Math.Vector2(x + r, y),
    new Phaser.Math.Vector2(x, y + r),
    new Phaser.Math.Vector2(x - r, y),
  ], true, true)
}

function drawLock(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(theme.boardEdge, 1)
  g.fillCircle(x, y, 12)
  const muted = parseInt(theme.textMuted.slice(1), 16)
  g.lineStyle(2, muted, 1)
  g.strokeCircle(x, y - 3, 4)
  g.fillStyle(muted, 1)
  g.fillRoundedRect(x - 6, y - 2, 12, 9, 2)
}
