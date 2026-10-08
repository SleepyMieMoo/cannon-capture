import { vsAiSkins } from '../config/skins'
import { loadSkin, onSkinChange } from '../menu/skinPref'
import Phaser from 'phaser'
import { GAME_HEIGHT, GAME_WIDTH } from '../config/layout'
import { sideColor, theme } from '../config/theme'
import { TUNING } from '../config/tuning'
import { Fan } from '../entities/Fan'
import { Wall } from '../entities/Wall'
import { withDifficulty } from '../editor/maps'
import { CAMPAIGN, SKIRMISH } from '../levels'
import { setRingScale } from '../entities/Cannon'
import { drawBoardSurface } from '../render/boardSurface'
import { bindSceneResolution } from '../render/resolution'
import { BattleSim } from '../sim/BattleSim'
import type { LevelDef } from '../types'

/** Boards the title's background battle cycles through (both sides played by the Normal AI). */
export const DEMO_LEVELS: LevelDef[] = [SKIRMISH, ...CAMPAIGN.filter((l) => l.kind !== 'puzzle')]
/** A background battle restarts on the next board after this long, if nobody has won. */
const DEMO_MS = 70_000

/**
 * The title screen's lively background: a real round, AI against AI, drawn
 * dimmed under the menu. Non-interactive and silent (the round reports no
 * events). Phaser stops the whole loop while the tab is hidden, so it costs
 * nothing then.
 */
export class TitleBgScene extends Phaser.Scene {
  private sim!: BattleSim
  private fans: Fan[] = []
  private fx!: Phaser.GameObjects.Graphics
  private index = 0

  constructor() {
    super('titlebg')
  }

  create(data: { index?: number }): void {
    bindSceneResolution(this)
    this.index = (data?.index ?? Math.floor(Math.random() * DEMO_LEVELS.length)) % DEMO_LEVELS.length
    const level = withDifficulty(DEMO_LEVELS[this.index], 'normal')
    this.add.graphics().fillStyle(theme.bg, 1).fillRect(-200, -200, GAME_WIDTH + 400, GAME_HEIGHT + 400)
    drawBoardSurface(this, { x: 24, y: 88, w: 1152, h: 608 })
    level.walls.forEach((rect) => new Wall(this, rect))
    this.fans = level.fans.map((def) => new Fan(this, def))
    this.fx = this.add.graphics().setDepth(3)
    this.sim = new BattleSim(level, this, {}, 'progressive')
    this.sim.addAi('player', 'normal')
    // A short, silent planning grace (no 3-2-1 behind the menu): both AIs line up before anyone fires.
    this.sim.startCountdown(TUNING.demoCountdownMs)
    // The demo shows your skin on gold (and the AI's pick on pink), like a round you'd play.
    this.sim.setSkins(vsAiSkins(loadSkin()))
    const offSkin = onSkinChange((skin) => this.sim.setSkins(vsAiSkins(skin)))
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, offSkin)
    // Dimmed: the menu sits on top.
    this.add.graphics().setDepth(50).fillStyle(theme.bg, 0.2).fillRect(-200, -200, GAME_WIDTH + 400, GAME_HEIGHT + 400)
    this.cameras.main.fadeIn(700, 20, 14, 12)
    this.input.enabled = false
    // Browsers stop drawing hidden tabs anyway; sleeping makes sure the round stops too.
    const hide = (): void => {
      if (this.scene.isActive()) this.scene.sleep()
    }
    const show = (): void => {
      if (this.scene.isSleeping()) this.scene.wake()
    }
    this.game.events.on(Phaser.Core.Events.HIDDEN, hide)
    this.game.events.on(Phaser.Core.Events.VISIBLE, show)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.HIDDEN, hide)
      this.game.events.off(Phaser.Core.Events.VISIBLE, show)
    })
  }

  update(time: number, delta: number): void {
    const dt = Math.min(delta, 50)
    this.sim.pumpLanes(3)
    if (!this.sim.ended) this.sim.step(dt)
    for (const fan of this.fans) fan.draw(time)
    setRingScale(this.cameras.main.zoom / (this.scale.displayScale.x || 1))
    for (const c of this.sim.cannons) c.draw(time)
    const g = this.fx
    g.clear()
    for (const shot of this.sim.shots) {
      const color = sideColor(shot.side)
      if (shot.kind === 'machinegun' || shot.kind === 'sniper') {
        const { vx, vy } = shot.ball
        const v = Math.hypot(vx, vy) || 1
        const len = shot.kind === 'sniper' ? 40 : 11
        g.lineStyle(shot.kind === 'sniper' ? 4 : 5, color, shot.kind === 'sniper' ? 0.45 : 0.95)
        g.lineBetween(shot.ball.x - (vx / v) * len, shot.ball.y - (vy / v) * len, shot.ball.x, shot.ball.y)
      } else {
        g.fillStyle(color, 1)
        g.fillCircle(shot.ball.x, shot.ball.y, TUNING.shotRadius)
      }
    }
    if (this.sim.ended || this.sim.clock > DEMO_MS) this.scene.restart({ index: this.index + 1 })
  }
}
