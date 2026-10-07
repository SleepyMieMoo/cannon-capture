import Phaser from 'phaser'
import { BOARD, GAME_HEIGHT, GAME_WIDTH, HUD_HEIGHT } from '../config/layout'
import { cssHex, sideColor, theme } from '../config/theme'
import { TUNING } from '../config/tuning'
import { DEBUG } from '../debug'
import { Cannon } from '../entities/Cannon'
import { Fan } from '../entities/Fan'
import { Wall } from '../entities/Wall'
import { CAMPAIGN, SKIRMISH, campaignIndex, findLevel } from '../levels'
import { recordWin } from '../progress'
import { bindSceneResolution } from '../render/resolution'
import { clampPoint } from '../sim/aim'
import { BattleSim, type Outcome } from '../sim/BattleSim'
import { MirrorBot, makeBot, type Bot } from '../sim/bots'
import { clipToWalls } from '../sim/geometry'
import { starsFor } from '../sim/stars'
import type { LevelDef, Point, Side } from '../types'
import { drawStar, makeButton } from '../ui/button'

interface Spark {
  x: number
  y: number
  life: number
  color: number
}

interface Ping {
  x: number
  y: number
  life: number
  color: number
}

export interface BattleData {
  levelId?: string
}

/** Renders a BattleSim round and turns clicks into aim orders. */
export class BattleScene extends Phaser.Scene {
  private level: LevelDef = SKIRMISH
  private levelIndex = -1
  private sim!: BattleSim
  private bot: Bot | null = null
  private walls: Wall[] = []
  private fans: Fan[] = []
  private sparks: Spark[] = []
  private pings: Ping[] = []
  /** Last pointer position on the board, for the aim preview (null off-board or on touch). */
  private pointer: Point | null = null
  private fx!: Phaser.GameObjects.Graphics
  private selected: Cannon | null = null
  private hover: Cannon | null = null
  private shownEnd = false
  private restarting = false
  private hint!: Phaser.GameObjects.Text
  private counts!: Partial<Record<Side, Phaser.GameObjects.Text>>
  private aimsText: Phaser.GameObjects.Text | null = null
  private banner: Phaser.GameObjects.Container | null = null

  constructor() {
    super('battle')
  }

  init(data: BattleData): void {
    this.level = findLevel(data?.levelId) ?? SKIRMISH
    this.levelIndex = campaignIndex(this.level.id)
  }

  private get cannons(): Cannon[] {
    return this.sim.cannons
  }

  private get ended(): Outcome | null {
    return this.sim.ended
  }

  private get isPuzzle(): boolean {
    return this.level.kind === 'puzzle'
  }

  private get aimsLeft(): number {
    return this.sim.aimsLeft
  }

  create(): void {
    this.walls = []
    this.fans = []
    this.sparks = []
    this.pings = []
    this.pointer = null
    this.selected = null
    this.hover = null
    this.shownEnd = false
    this.restarting = false
    this.aimsText = null
    this.banner = null

    bindSceneResolution(this)
    this.drawBoard()
    this.fx = this.add.graphics().setDepth(3)
    this.level.walls.forEach((rect) => this.walls.push(new Wall(this, rect)))
    this.level.fans.forEach((def) => this.fans.push(new Fan(this, def)))

    this.sim = new BattleSim(this.level, this, {
      bounce: (x, y) => this.sparks.push({ x, y, life: 1, color: theme.spark }),
      hit: (x, y, side) => this.sparks.push({ x, y, life: 1, color: sideColor(side) }),
      captured: (cannon) => this.popup(cannon.x, cannon.y, 'Captured', cssHex(sideColor(cannon.side))),
      noAims: (cannon) => this.popup(cannon.x, cannon.y, 'No aims left', theme.textMuted),
      aimed: (point) => {
        this.pings.push({ x: point.x, y: point.y, life: 1, color: theme.select })
        this.hideBanner()
      },
    })
    this.bot = !DEBUG.bot
      ? null
      : DEBUG.botStyle === 'mirror' && !this.sim.isPuzzle
        ? new MirrorBot(this.sim)
        : makeBot(this.sim)

    this.createHud()
    if (this.level.hint) this.showBanner(this.level.hint)
    this.bindInput()
    this.refreshHud()
    if (DEBUG.enabled) (window as unknown as { __cc?: unknown }).__cc = { scene: this, sim: this.sim }
  }

  update(time: number, delta: number): void {
    const dt = Math.min(delta, 32)
    for (const fan of this.fans) fan.draw(time)

    for (let i = 0; i < DEBUG.speed && !this.sim.ended; i++) {
      this.bot?.update(dt)
      this.sim.step(dt)
    }
    if (this.selected && this.selected.side !== 'player') this.selected = null
    if (this.sim.ended && !this.shownEnd) this.finish()

    this.fadeSparks(dt)
    for (const ping of this.pings) ping.life -= dt / 420
    this.pings = this.pings.filter((ping) => ping.life > 0)
    this.drawFx(time)
    for (const cannon of this.cannons) {
      cannon.hovered = cannon === this.hover
      cannon.selected = cannon === this.selected
      cannon.draw(time)
    }
    this.refreshHud()
  }

  private finish(): void {
    this.shownEnd = true
    this.selected = null
    this.hover = null
    this.hideBanner()
    this.showEnd(this.sim.ended!)
  }

  private playerAim(cannon: Cannon, aim: Cannon | Point): boolean {
    return this.sim.playerAim(cannon, aim)
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    this.input.off('pointerdown', this.onPointerDown, this)
    this.input.off('pointermove', this.onPointerMove, this)
    this.input.on('pointerdown', this.onPointerDown, this)
    this.input.on('pointermove', this.onPointerMove, this)
    const keyboard = this.input.keyboard
    if (!keyboard) return
    keyboard.off('keydown-R', this.onRestartKey, this)
    keyboard.off('keydown-ESC', this.onCancelKey, this)
    keyboard.off('keydown-N', this.onNextKey, this)
    keyboard.on('keydown-R', this.onRestartKey, this)
    keyboard.on('keydown-ESC', this.onCancelKey, this)
    keyboard.on('keydown-N', this.onNextKey, this)
  }

  private onRestartKey(): void {
    this.restart()
  }

  private onCancelKey(): void {
    this.selected = null
  }

  private onNextKey(): void {
    if (this.ended === 'win' && this.nextLevel()) this.goNext()
  }

  private onPointerDown(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (this.ended || this.restarting) return
    if (over && over.length) return // a HUD button handled it
    const x = pointer.worldX
    const y = pointer.worldY
    const hit = this.cannonAt(x, y)
    const sel = this.selected

    if (!sel) {
      if (hit && hit.side === 'player') {
        this.selected = hit
        this.hideBanner()
      }
      return
    }
    if (hit === sel) {
      this.selected = null
      return
    }
    if (hit && hit.side === 'player') {
      this.selected = hit
      return
    }
    if (hit) {
      // A successful aim deselects, so a stray second click can't re-aim by accident.
      if (this.playerAim(sel, hit)) this.selected = null
      return
    }
    if (!onBoard(x, y)) {
      this.selected = null
      return
    }
    if (this.playerAim(sel, clampPoint(x, y, BOARD, TUNING.shotRadius))) this.selected = null
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.ended) {
      this.hover = null
      this.pointer = null
      return
    }
    const x = pointer.worldX
    const y = pointer.worldY
    this.hover = this.cannonAt(x, y)
    this.pointer = onBoard(x, y) && !pointer.wasTouch ? { x, y } : null
    const clickable = this.hover && (this.hover.side === 'player' || this.selected)
    this.input.setDefaultCursor(clickable ? 'pointer' : this.selected && this.pointer ? 'crosshair' : 'default')
  }

  // ---------------------------------------------------------------- navigation

  private nextLevel(): LevelDef | null {
    if (this.levelIndex < 0) return null
    return CAMPAIGN[this.levelIndex + 1] ?? null
  }

  private restart(): void {
    if (this.restarting) return
    this.restarting = true
    this.input.setDefaultCursor('default')
    this.scene.restart({ levelId: this.level.id })
  }

  private goNext(): void {
    const next = this.nextLevel()
    if (!next || this.restarting) return
    this.restarting = true
    this.scene.start('battle', { levelId: next.id })
  }

  private goBack(): void {
    if (this.restarting) return
    this.restarting = true
    this.input.setDefaultCursor('default')
    this.scene.start(this.levelIndex >= 0 ? 'map' : 'title', { focus: this.level.id })
  }

  // ---------------------------------------------------------------- HUD and screens

  private drawBoard(): void {
    const g = this.add.graphics().setDepth(0)
    g.fillStyle(theme.bg, 1)
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)
    g.fillStyle(theme.hud, 1)
    g.fillRect(0, 0, GAME_WIDTH, HUD_HEIGHT)
    g.fillStyle(theme.boardEdge, 1)
    g.fillRect(0, HUD_HEIGHT, GAME_WIDTH, 2)
    g.fillStyle(theme.board, 1)
    g.fillRoundedRect(BOARD.x, BOARD.y, BOARD.w, BOARD.h, 18)
    g.lineStyle(2, theme.boardEdge, 1)
    g.strokeRoundedRect(BOARD.x, BOARD.y, BOARD.w, BOARD.h, 18)
    g.fillStyle(theme.grid, 1)
    for (let x = BOARD.x + 36; x < BOARD.x + BOARD.w - 16; x += 32) {
      for (let y = BOARD.y + 28; y < BOARD.y + BOARD.h - 16; y += 32) {
        g.fillCircle(x, y, 1.6)
      }
    }
  }

  private createHud(): void {
    const title =
      this.levelIndex >= 0
        ? `${this.levelIndex + 1}. ${this.level.name}${this.isPuzzle ? '  ·  Puzzle' : ''}`
        : `Cannon Capture  ·  ${this.level.name}`
    this.add
      .text(28, 14, title, {
        fontFamily: theme.font,
        fontSize: '22px',
        fontStyle: 'bold',
        color: theme.text,
      })
      .setDepth(10)

    this.hint = this.add
      .text(28, 44, '', { fontFamily: theme.font, fontSize: '14px', color: theme.textMuted })
      .setDepth(10)

    const legend = this.add.graphics().setDepth(10)
    const groups: { side: Side; x: number; label: string }[] = [
      { side: 'player', x: 620, label: 'You' },
      { side: 'neutral', x: 730, label: 'Neutral' },
    ]
    if (!this.isPuzzle) groups.push({ side: 'enemy', x: 870, label: 'Enemy' })
    const counts: Partial<Record<Side, Phaser.GameObjects.Text>> = {}
    this.counts = counts
    for (const group of groups) {
      legend.fillStyle(sideColor(group.side), 1)
      legend.fillCircle(group.x, 26, 6)
      counts[group.side] = this.add
        .text(group.x + 14, 26, '0', {
          fontFamily: theme.font,
          fontSize: '15px',
          fontStyle: 'bold',
          color: cssHex(sideColor(group.side)),
        })
        .setOrigin(0, 0.5)
        .setDepth(10)
      this.add
        .text(group.x + 32, 26, group.label, { fontFamily: theme.font, fontSize: '14px', color: theme.textMuted })
        .setOrigin(0, 0.5)
        .setDepth(10)
    }
    if (this.isPuzzle && this.level.aims !== undefined) {
      this.aimsText = this.add
        .text(870, 26, '', { fontFamily: theme.font, fontSize: '15px', fontStyle: 'bold', color: theme.text })
        .setOrigin(0, 0.5)
        .setDepth(10)
    }

    const link = (x: number, label: string, onClick: () => void): void => {
      const text = this.add
        .text(x, 26, label, { fontFamily: theme.font, fontSize: '14px', color: theme.textMuted })
        .setOrigin(1, 0.5)
        .setDepth(10)
        .setInteractive({ useHandCursor: true })
      text.on('pointerover', () => text.setColor(theme.text))
      text.on('pointerout', () => text.setColor(theme.textMuted))
      text.on('pointerdown', onClick)
    }
    link(GAME_WIDTH - 28, 'Restart', () => this.restart())
    link(GAME_WIDTH - 112, this.levelIndex >= 0 ? 'Map' : 'Menu', () => this.goBack())
  }

  private refreshHud(): void {
    const tally: Record<Side, number> = { player: 0, enemy: 0, neutral: 0 }
    for (const cannon of this.cannons) tally[cannon.side] += 1
    for (const side of Object.keys(this.counts) as Side[]) {
      const next = String(tally[side])
      const text = this.counts[side]
      if (text && text.text !== next) text.setText(next)
    }
    if (this.aimsText) {
      const next = `${this.aimsLeft} aim${this.aimsLeft === 1 ? '' : 's'} left`
      if (this.aimsText.text !== next) {
        this.aimsText.setText(next)
        this.aimsText.setColor(this.aimsLeft === 0 ? cssHex(theme.enemy) : theme.text)
      }
    }
    const hint = this.hintLine()
    if (this.hint.text !== hint) this.hint.setText(hint)
  }

  private hintLine(): string {
    if (this.ended) return this.ended === 'win' ? 'You hold every cannon.' : 'Not this time.'
    if (!this.selected) return 'Click one of your gold cannons to select it, then click where it should aim.'
    const name = this.selected.name
    if (this.hover && this.hover !== this.selected) {
      if (this.hover.side === 'player') return `Click to select ${this.hover.name} instead.`
      return `${name} → ${this.hover.name}`
    }
    if (this.hover === this.selected) return `Click ${name} again to deselect.`
    return `${name}: click anywhere to aim (it deselects after), or click it again to cancel.`
  }

  private showBanner(message: string): void {
    const text = this.add
      .text(0, 0, message, {
        fontFamily: theme.font,
        fontSize: '16px',
        color: theme.text,
        align: 'center',
        wordWrap: { width: 760 },
      })
      .setOrigin(0.5)
    const w = Math.min(820, text.width + 48)
    const h = text.height + 26
    const g = this.add.graphics()
    g.fillStyle(theme.panel, 0.94)
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 14)
    g.lineStyle(2, theme.player, 0.7)
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 14)
    this.banner = this.add
      .container(GAME_WIDTH / 2, BOARD.y + BOARD.h - h / 2 - 14, [g, text])
      .setDepth(12)
      .setAlpha(0)
    this.tweens.add({ targets: this.banner, alpha: 1, duration: 260 })
    this.time.delayedCall(9000, () => this.hideBanner())
  }

  private hideBanner(): void {
    const banner = this.banner
    if (!banner) return
    this.banner = null
    this.tweens.add({ targets: banner, alpha: 0, duration: 300, onComplete: () => banner.destroy() })
  }

  private showEnd(result: Outcome): void {
    const root = this.add.container(0, 0).setDepth(20)
    const dim = this.add.graphics()
    dim.fillStyle(theme.dim, 0.64)
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)
    root.add(dim)

    const campaign = this.levelIndex >= 0
    const next = this.nextLevel()
    const seconds = Math.round(this.sim.clock / 1000)
    let stars = 0
    if (result === 'win' && campaign) {
      stars = starsFor(this.level, { seconds, aimsUsed: this.sim.aimsUsed })
      recordWin(this.level.id, stars)
    }

    const cx = GAME_WIDTH / 2
    const cy = GAME_HEIGHT / 2 + 10
    const ph = campaign && result === 'win' ? 300 : 260
    const top = cy - ph / 2
    const panel = this.add.graphics()
    panel.fillStyle(theme.panel, 0.98)
    panel.fillRoundedRect(cx - 260, top, 520, ph, 18)
    panel.lineStyle(3, result === 'win' ? theme.player : theme.enemy, 1)
    panel.strokeRoundedRect(cx - 260, top, 520, ph, 18)
    root.add(panel)

    let headline = result === 'win' ? 'All cannons captured' : 'No cannons left'
    if (campaign && result === 'win') headline = next ? 'Level complete' : 'Campaign complete!'
    if (result === 'lose' && this.isPuzzle) headline = 'Puzzle failed'
    let y = top + 50
    root.add(
      this.add
        .text(cx, y, headline, { fontFamily: theme.font, fontSize: '30px', fontStyle: 'bold', color: theme.text })
        .setOrigin(0.5),
    )
    y += 44
    if (campaign && result === 'win') {
      const sg = this.add.graphics()
      for (let i = 0; i < 3; i++) drawStar(sg, cx - 52 + i * 52, y + 4, 20, i < stars)
      root.add(sg)
      y += 42
    }
    let detail = this.sim.endReason || (result === 'win' ? 'The board is yours.' : '')
    if (result === 'win' && campaign) {
      const usesAims = this.isPuzzle && this.level.aims !== undefined
      const par = this.level.par
      detail = usesAims
        ? `${this.sim.aimsUsed} aim${this.sim.aimsUsed === 1 ? '' : 's'} used${par ? `  ·  3 stars at ${par}` : ''}`
        : `Won in ${seconds}s${par ? `  ·  3 stars under ${par}s` : ''}`
    }
    root.add(
      this.add
        .text(cx, y, detail, { fontFamily: theme.font, fontSize: '16px', color: theme.textMuted })
        .setOrigin(0.5),
    )

    const by = top + ph - 62
    const buttons: Phaser.GameObjects.Container[] = []
    if (result === 'win' && next) {
      buttons.push(makeButton(this, cx - 112, by, 'Next level', () => this.goNext(), { width: 200 }))
      buttons.push(makeButton(this, cx + 112, by, 'Back to map', () => this.goBack(), { width: 200, primary: false }))
    } else if (campaign) {
      const primaryLabel = result === 'win' ? 'Back to map' : 'Try again'
      const primary = result === 'win' ? () => this.goBack() : () => this.restart()
      const secondaryLabel = result === 'win' ? 'Play again' : 'Back to map'
      const secondary = result === 'win' ? () => this.restart() : () => this.goBack()
      buttons.push(makeButton(this, cx - 112, by, primaryLabel, primary, { width: 200 }))
      buttons.push(makeButton(this, cx + 112, by, secondaryLabel, secondary, { width: 200, primary: false }))
    } else {
      buttons.push(makeButton(this, cx - 112, by, 'Play again', () => this.restart(), { width: 200 }))
      buttons.push(makeButton(this, cx + 112, by, 'Menu', () => this.goBack(), { width: 200, primary: false }))
    }
    buttons.forEach((b) => root.add(b))
    root.add(
      this.add
        .text(cx, by + 44, result === 'win' && next ? 'N for next  ·  R to replay' : 'R to restart', {
          fontFamily: theme.font,
          fontSize: '13px',
          color: theme.textMuted,
        })
        .setOrigin(0.5),
    )
    if (DEBUG.enabled) {
      ;(window as unknown as { __ccResult?: unknown }).__ccResult = {
        level: this.level.id,
        result,
        seconds,
        aimsUsed: this.sim.aimsUsed,
        stars,
      }
    }
  }

  private popup(x: number, y: number, message: string, color: string): void {
    const text = this.add
      .text(x, y - 40, message, { fontFamily: theme.font, fontSize: '16px', fontStyle: 'bold', color })
      .setOrigin(0.5)
      .setDepth(15)
    this.tweens.add({
      targets: text,
      y: y - 74,
      alpha: 0,
      duration: 800,
      ease: 'Quad.easeOut',
      onComplete: () => text.destroy(),
    })
  }

  // ---------------------------------------------------------------- drawing

  private drawFx(time: number): void {
    const g = this.fx
    g.clear()
    const walls = this.walls.map((wall) => wall.rect)

    for (const cannon of this.cannons) {
      if (cannon.side === 'neutral') continue
      const aim = cannon.aim()
      if (!aim) continue
      const mine = cannon.side === 'player'
      const color = mine ? theme.player : sideColor(cannon.side)
      const alpha = mine ? (cannon.selected ? 0.85 : 0.4) : 0.34
      const end = clipToWalls(cannon.x, cannon.y, aim.x, aim.y, walls)
      const blocked = end.x !== aim.x || end.y !== aim.y
      const endInset = cannon.target && !blocked ? TUNING.cannonRadius + 14 : 4
      dash(g, cannon.x, cannon.y, end.x, end.y, TUNING.cannonRadius + 14, endInset, color, alpha)
      if (!cannon.target) {
        crosshair(g, aim.x, aim.y, mine && cannon.selected ? 11 : 8, color, mine ? alpha + 0.1 : alpha)
      }
    }

    // Live preview from the selected cannon to wherever the pointer is.
    const sel = this.selected
    if (sel && !this.ended) {
      const hover = this.hover && this.hover !== sel ? this.hover : null
      if (hover && hover.side !== 'player') {
        const end = clipToWalls(sel.x, sel.y, hover.x, hover.y, walls)
        const blocked = end.x !== hover.x || end.y !== hover.y
        dash(g, sel.x, sel.y, end.x, end.y, TUNING.cannonRadius + 14, blocked ? 4 : TUNING.cannonRadius + 14, theme.select, 0.9)
        g.lineStyle(2, theme.select, 0.6 + 0.3 * Math.sin(time / 120))
        g.strokeCircle(hover.x, hover.y, TUNING.cannonRadius + 9)
      } else if (!this.hover && this.pointer) {
        const end = clipToWalls(sel.x, sel.y, this.pointer.x, this.pointer.y, walls)
        dash(g, sel.x, sel.y, end.x, end.y, TUNING.cannonRadius + 14, 4, theme.select, 0.55)
        crosshair(g, this.pointer.x, this.pointer.y, 10, theme.select, 0.75)
      }
    }

    for (const ping of this.pings) {
      g.lineStyle(2, ping.color, ping.life)
      g.strokeCircle(ping.x, ping.y, 8 + (1 - ping.life) * 22)
    }

    for (const shot of this.sim.shots) {
      const color = sideColor(shot.side)
      g.lineStyle(TUNING.shotRadius * 1.6, color, 0.28)
      g.beginPath()
      g.moveTo(shot.prevX, shot.prevY)
      g.lineTo(shot.ball.x, shot.ball.y)
      g.strokePath()
      g.fillStyle(color, 1)
      g.fillCircle(shot.ball.x, shot.ball.y, TUNING.shotRadius)
      g.fillStyle(0xffffff, 0.85)
      g.fillCircle(shot.ball.x, shot.ball.y, 2.4)
    }

    for (const spark of this.sparks) {
      g.fillStyle(spark.color, spark.life * 0.7)
      g.fillCircle(spark.x, spark.y, 4 + (1 - spark.life) * 10)
    }
  }

  private fadeSparks(dt: number): void {
    for (const spark of this.sparks) spark.life -= dt / 180
    this.sparks = this.sparks.filter((spark) => spark.life > 0)
  }

  private cannonAt(x: number, y: number): Cannon | null {
    const reach = TUNING.cannonRadius + TUNING.aimSlop
    let best: Cannon | null = null
    let bestDist = reach
    for (const cannon of this.cannons) {
      const dist = Math.hypot(cannon.x - x, cannon.y - y)
      if (dist <= bestDist) {
        best = cannon
        bestDist = dist
      }
    }
    return best
  }
}

function onBoard(x: number, y: number): boolean {
  return x >= BOARD.x && x <= BOARD.x + BOARD.w && y >= BOARD.y && y <= BOARD.y + BOARD.h
}

function crosshair(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number, alpha: number): void {
  g.lineStyle(2, color, Math.min(1, alpha))
  g.strokeCircle(x, y, r)
  g.beginPath()
  g.moveTo(x - r - 5, y)
  g.lineTo(x - r + 4, y)
  g.moveTo(x + r - 4, y)
  g.lineTo(x + r + 5, y)
  g.moveTo(x, y - r - 5)
  g.lineTo(x, y - r + 4)
  g.moveTo(x, y + r - 4)
  g.lineTo(x, y + r + 5)
  g.strokePath()
}

function dash(
  g: Phaser.GameObjects.Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  startInset: number,
  endInset: number,
  color: number,
  alpha: number,
): void {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (len < startInset + endInset) return
  const ux = dx / len
  const uy = dy / len
  g.lineStyle(2, color, alpha)
  let traveled = startInset
  const end = len - endInset
  while (traveled < end) {
    const next = Math.min(traveled + 10, end)
    g.beginPath()
    g.moveTo(x1 + ux * traveled, y1 + uy * traveled)
    g.lineTo(x1 + ux * next, y1 + uy * next)
    g.strokePath()
    traveled = next + 8
  }
}
