import Phaser from 'phaser'
import { AiController } from '../ai/AiController'
import { BOARD, GAME_HEIGHT, GAME_WIDTH, HUD_HEIGHT } from '../config/layout'
import { cssHex, sideColor, theme } from '../config/theme'
import { TUNING } from '../config/tuning'
import { Cannon } from '../entities/Cannon'
import { Fan } from '../entities/Fan'
import { Shot } from '../entities/Shot'
import { Wall } from '../entities/Wall'
import { SKIRMISH } from '../levels/skirmish'
import type { FanField } from '../sim/ballistics'
import { clipToWalls } from '../sim/geometry'
import type { Side } from '../types'

interface Spark {
  x: number
  y: number
  life: number
  color: number
}

type Outcome = 'win' | 'lose'

export class BattleScene extends Phaser.Scene {
  private cannons: Cannon[] = []
  private shots: Shot[] = []
  private walls: Wall[] = []
  private fans: Fan[] = []
  private sparks: Spark[] = []
  private readonly ai = new AiController()
  private fx!: Phaser.GameObjects.Graphics
  private selected: Cannon | null = null
  private hover: Cannon | null = null
  private ended: Outcome | null = null
  private restarting = false
  private hint!: Phaser.GameObjects.Text
  private counts!: Record<Side, Phaser.GameObjects.Text>

  constructor() {
    super('battle')
  }

  create(): void {
    this.cannons = []
    this.shots = []
    this.walls = []
    this.fans = []
    this.sparks = []
    this.selected = null
    this.hover = null
    this.ended = null
    this.restarting = false
    this.ai.reset()

    this.drawBoard()
    this.fx = this.add.graphics().setDepth(3)

    SKIRMISH.walls.forEach((rect) => this.walls.push(new Wall(this, rect)))
    SKIRMISH.fans.forEach((def) => this.fans.push(new Fan(this, def)))

    SKIRMISH.cannons.forEach((def, index) => {
      this.cannons.push(
        new Cannon(
          this,
          def.id,
          def.name,
          def.x,
          def.y,
          def.side,
          (index % 3) * TUNING.fireStaggerMs,
        ),
      )
    })
    for (const def of SKIRMISH.cannons) {
      if (!def.aimAt) continue
      this.byId(def.id)?.setTarget(this.byId(def.aimAt) ?? null)
    }

    this.createHud()
    this.bindInput()
    this.refreshHud()
  }

  update(time: number, delta: number): void {
    const dt = Math.min(delta, 32)
    for (const fan of this.fans) fan.draw(time)

    if (!this.ended) {
      this.ai.update(dt, this.cannons)
      this.stepShots(dt)
      if (this.selected && this.selected.side !== 'player') this.selected = null
      this.checkOutcome()
    }

    this.fadeSparks(dt)
    this.drawFx()
    for (const cannon of this.cannons) {
      cannon.hovered = cannon === this.hover
      cannon.selected = cannon === this.selected
      cannon.draw(time)
    }
    this.refreshHud()
  }

  private stepShots(dt: number): void {
    const walls = this.walls.map((wall) => wall.rect)
    const fans: FanField[] = this.fans.map((fan) => fan.field)
    const bodies = this.cannons.map((cannon) => ({
      id: cannon.id,
      x: cannon.x,
      y: cannon.y,
      radius: TUNING.cannonRadius,
    }))

    for (const cannon of this.cannons) {
      const spawned = cannon.update(dt, false)
      if (!spawned) continue
      this.shots.push(new Shot(spawned, cannon.side))
    }

    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i]
      const result = shot.step(dt, walls, fans, bodies)
      if (result.bounced) this.sparks.push({ x: shot.ball.x, y: shot.ball.y, life: 1, color: theme.spark })
      if (result.hitId && !this.ended) {
        const cannon = this.byId(result.hitId)
        this.sparks.push({ x: shot.ball.x, y: shot.ball.y, life: 1, color: sideColor(shot.side) })
        if (cannon && cannon.side !== shot.side) {
          const flipped = cannon.receiveHit(shot.side)
          if (flipped) this.onCaptured(cannon)
        }
      }
      if (!shot.ball.alive) this.shots.splice(i, 1)
    }

    if (this.shots.length > 80) this.shots.splice(0, this.shots.length - 80)
  }

  private onCaptured(cannon: Cannon): void {
    this.popup(cannon.x, cannon.y, 'Captured', cssHex(sideColor(cannon.side)))
    for (const other of this.cannons) {
      if (other.target && other.target.side === other.side) {
        other.setTarget(this.nearestFoe(other))
      }
    }
    if (!cannon.target) cannon.setTarget(this.nearestFoe(cannon))
    if (cannon.side === 'enemy') this.ai.retarget(this.cannons)
  }

  private nearestFoe(cannon: Cannon): Cannon | null {
    let best: Cannon | null = null
    let bestDist = Infinity
    for (const other of this.cannons) {
      if (other === cannon || other.side === cannon.side) continue
      const dist = Math.hypot(other.x - cannon.x, other.y - cannon.y)
      if (dist < bestDist) {
        best = other
        bestDist = dist
      }
    }
    return best
  }

  private checkOutcome(): void {
    if (this.ended) return
    let player = 0
    for (const cannon of this.cannons) if (cannon.side === 'player') player += 1
    if (player === this.cannons.length) this.finish('win')
    else if (player === 0) this.finish('lose')
  }

  private finish(result: Outcome): void {
    if (this.ended) return
    this.ended = result
    this.selected = null
    this.hover = null
    this.showEnd(result)
  }

  private showEnd(result: Outcome): void {
    const root = this.add.container(0, 0).setDepth(20)
    const dim = this.add.graphics()
    dim.fillStyle(theme.dim, 0.64)
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)
    root.add(dim)

    const cx = GAME_WIDTH / 2
    const cy = GAME_HEIGHT / 2 + 10
    const panel = this.add.graphics()
    panel.fillStyle(theme.panel, 0.98)
    panel.fillRoundedRect(cx - 240, cy - 124, 480, 258, 18)
    panel.lineStyle(3, result === 'win' ? theme.player : theme.enemy, 1)
    panel.strokeRoundedRect(cx - 240, cy - 124, 480, 258, 18)
    root.add(panel)

    root.add(
      this.add
        .text(cx, cy - 64, result === 'win' ? 'All cannons captured' : 'No cannons left', {
          fontFamily: theme.font,
          fontSize: '30px',
          fontStyle: 'bold',
          color: theme.text,
        })
        .setOrigin(0.5),
    )
    root.add(
      this.add
        .text(
          cx,
          cy - 22,
          result === 'win' ? 'The board is yours.' : 'The enemy took every cannon you held.',
          {
            fontFamily: theme.font,
            fontSize: '16px',
            color: theme.textMuted,
          },
        )
        .setOrigin(0.5),
    )

    const button = this.add
      .rectangle(cx, cy + 42, 200, 48, theme.player)
      .setInteractive({ useHandCursor: true })
    const label = this.add
      .text(cx, cy + 42, 'Play again', {
        fontFamily: theme.font,
        fontSize: '18px',
        fontStyle: 'bold',
        color: theme.ink,
      })
      .setOrigin(0.5)
    button.on('pointerover', () => button.setFillStyle(theme.playerHot))
    button.on('pointerout', () => button.setFillStyle(theme.player))
    button.on('pointerdown', () => this.restart())
    root.add(button)
    root.add(label)
    root.add(
      this.add
        .text(cx, cy + 88, 'R to restart', {
          fontFamily: theme.font,
          fontSize: '13px',
          color: theme.textMuted,
        })
        .setOrigin(0.5),
    )
  }

  private popup(x: number, y: number, message: string, color: string): void {
    const text = this.add
      .text(x, y - 40, message, {
        fontFamily: theme.font,
        fontSize: '16px',
        fontStyle: 'bold',
        color,
      })
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
        g.fillCircle(x, y, 1.3)
      }
    }
  }

  private createHud(): void {
    this.add
      .text(28, 14, `Cannon Capture  ·  ${SKIRMISH.name}`, {
        fontFamily: theme.font,
        fontSize: '22px',
        fontStyle: 'bold',
        color: theme.text,
      })
      .setDepth(10)

    this.hint = this.add
      .text(28, 44, '', {
        fontFamily: theme.font,
        fontSize: '14px',
        color: theme.textMuted,
      })
      .setDepth(10)

    const legend = this.add.graphics().setDepth(10)
    const groups: { side: Side; x: number; label: string }[] = [
      { side: 'player', x: 720, label: 'You' },
      { side: 'neutral', x: 840, label: 'Neutral' },
      { side: 'enemy', x: 990, label: 'Enemy' },
    ]
    const counts = {} as Record<Side, Phaser.GameObjects.Text>
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
        .text(group.x + 32, 26, group.label, {
          fontFamily: theme.font,
          fontSize: '14px',
          color: theme.textMuted,
        })
        .setOrigin(0, 0.5)
        .setDepth(10)
    }

    const restart = this.add
      .text(GAME_WIDTH - 28, 26, 'Restart', {
        fontFamily: theme.font,
        fontSize: '14px',
        color: theme.textMuted,
      })
      .setOrigin(1, 0.5)
      .setDepth(10)
      .setInteractive({ useHandCursor: true })
    restart.on('pointerover', () => restart.setColor(theme.text))
    restart.on('pointerout', () => restart.setColor(theme.textMuted))
    restart.on('pointerdown', () => this.restart())
  }

  private refreshHud(): void {
    const tally: Record<Side, number> = { player: 0, enemy: 0, neutral: 0 }
    for (const cannon of this.cannons) tally[cannon.side] += 1
    for (const side of Object.keys(tally) as Side[]) {
      const next = String(tally[side])
      if (this.counts[side].text !== next) this.counts[side].setText(next)
    }
    const hint = this.hintLine()
    if (this.hint.text !== hint) this.hint.setText(hint)
  }

  private hintLine(): string {
    if (this.ended) return this.ended === 'win' ? 'You hold every cannon.' : 'You hold no cannons.'
    if (!this.selected) return 'Click a gold cannon, then click the cannon it should shoot.'
    if (this.hover && this.hover !== this.selected && this.hover.side !== 'player') {
      return `${this.selected.name} → ${this.hover.name}`
    }
    if (this.selected.target) {
      return `${this.selected.name} firing at ${this.selected.target.name}. Click a cannon to retarget.`
    }
    return `${this.selected.name} selected. Click an enemy or neutral cannon to aim.`
  }

  private drawFx(): void {
    const g = this.fx
    g.clear()
    for (const cannon of this.cannons) {
      const preview =
        cannon === this.selected && this.hover && this.hover.side !== 'player' && this.hover !== cannon
          ? this.hover
          : null
      const target = preview ?? (cannon.side === 'neutral' ? null : cannon.target)
      if (!target) continue
      const alpha = preview ? 0.9 : cannon.side === 'player' ? (cannon.selected ? 0.8 : 0.38) : 0.36
      const color = preview || cannon.side === 'player' ? theme.player : sideColor(cannon.side)
      const walls = this.walls.map((wall) => wall.rect)
      const end = clipToWalls(cannon.x, cannon.y, target.x, target.y, walls)
      const blocked = end.x !== target.x || end.y !== target.y
      dash(
        g,
        cannon.x,
        cannon.y,
        end.x,
        end.y,
        TUNING.cannonRadius + 14,
        blocked ? 4 : TUNING.cannonRadius + 14,
        color,
        alpha,
      )
    }

    for (const shot of this.shots) {
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

  private bindInput(): void {
    this.input.off('pointerdown', this.onPointerDown, this)
    this.input.off('pointermove', this.onPointerMove, this)
    this.input.on('pointerdown', this.onPointerDown, this)
    this.input.on('pointermove', this.onPointerMove, this)
    const keyboard = this.input.keyboard
    if (!keyboard) return
    keyboard.off('keydown-R', this.onRestartKey, this)
    keyboard.off('keydown-ESC', this.onCancelKey, this)
    keyboard.on('keydown-R', this.onRestartKey, this)
    keyboard.on('keydown-ESC', this.onCancelKey, this)
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.ended || this.restarting) return
    const hit = this.cannonAt(pointer.x, pointer.y)
    if (!hit) {
      this.selected = null
      return
    }
    if (hit.side === 'player') {
      this.selected = hit
      return
    }
    if (this.selected && this.selected.side === 'player') this.selected.setTarget(hit)
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.ended) {
      this.hover = null
      return
    }
    this.hover = this.cannonAt(pointer.x, pointer.y)
    this.input.setDefaultCursor(this.hover ? 'pointer' : 'default')
  }

  private onRestartKey(): void {
    if (this.ended) this.restart()
  }

  private onCancelKey(): void {
    this.selected = null
  }

  private restart(): void {
    if (this.restarting) return
    this.restarting = true
    this.scene.restart()
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

  private byId(id: string): Cannon | undefined {
    return this.cannons.find((cannon) => cannon.id === id)
  }
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
