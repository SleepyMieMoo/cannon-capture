import { Portal } from '../entities/Portal'
import { portalMouths } from '../sim/portals'
import { portalColour } from '../config/obstacles'
import { vsAiSkins } from '../config/skins'
import { loadSkin, onSkinChange } from '../menu/skinPref'
import { loadColour, onColourChange } from '../menu/colourPref'
import { vsAiColours } from '../config/teamColours'
import Phaser from 'phaser'
import { GAME_HEIGHT, GAME_WIDTH } from '../config/layout'
import { applyTeamColours, sideColor, theme } from '../config/theme'
import { TUNING } from '../config/tuning'
import { Fan } from '../entities/Fan'
import { Wall } from '../entities/Wall'
import { Pillar } from '../entities/Pillar'
import { Glass } from '../entities/Glass'
import { withDifficulty } from '../editor/maps'
import { CAMPAIGN, EXAMPLE_MAPS, SKIRMISH } from '../levels'
import { setRingScale } from '../entities/Cannon'
import { drawBoardSurface } from '../render/boardSurface'
import { SideGlow, glowColours, glowEdges } from '../render/sideGlow'
import { bindSceneResolution } from '../render/resolution'
import { BattleSim, type SimEvents } from '../sim/BattleSim'
import { Vfx } from '../render/vfx/Vfx'
import { currentFxConfig, onFxChange } from '../render/vfx/fxPrefs'
import { beatPulse } from '../ui/beatPulse'
import type { LevelDef } from '../types'

/** Boards the title's background battle cycles through (both sides played by the Normal AI). */
export const DEMO_LEVELS: LevelDef[] = [SKIRMISH, ...CAMPAIGN.filter((l) => l.kind !== 'puzzle'), ...EXAMPLE_MAPS]
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
  private walls: Wall[] = []
  private portals: Portal[] = []
  private glass: Glass[] = []
  private fx!: Phaser.GameObjects.Graphics
  private index = 0
  private glow?: SideGlow
  /** The demo's effects: never above Low behind the menu, no camera shake. */
  private vfx: Vfx | null = null

  constructor() {
    super('titlebg')
  }

  create(data: { index?: number }): void {
    bindSceneResolution(this)
    this.index = (data?.index ?? Math.floor(Math.random() * DEMO_LEVELS.length)) % DEMO_LEVELS.length
    const level = withDifficulty(DEMO_LEVELS[this.index], 'normal')
    this.add.graphics().fillStyle(theme.bg, 1).fillRect(-200, -200, GAME_WIDTH + 400, GAME_HEIGHT + 400)
    const board = { x: 24, y: 88, w: 1152, h: 608 }
    drawBoardSurface(this, board)
    this.walls = level.walls.map((rect) => new Wall(this, rect))
    for (const p of level.pillars ?? []) new Pillar(this, p)
    this.glass = (level.glass ?? []).map((g) => new Glass(this, g))
    this.portals = portalMouths(level.portals).map((m, i) => new Portal(this, m, m.pair, i % 2 ? 'b' : 'a'))
    this.fans = level.fans.map((def) => new Fan(this, def))
    this.fx = this.add.graphics().setDepth(3)
    this.vfx = null
    const events: SimEvents = {
      fired: (c) => this.vfx?.fired(c),
      bounce: (x, y, surface) => this.vfx?.bounce(x, y, surface),
      absorbed: (x, y) => this.vfx?.absorbed(x, y),
      hit: (x, y, side, kind) => this.vfx?.hit(x, y, side, kind),
      blocked: (x, y, shield, _side, kind) => this.vfx?.blocked(x, y, shield, kind),
      shieldBroken: (c) => this.vfx?.shieldBroken(c),
      wallHit: (_i, x, y) => this.vfx?.wallHit(x, y),
      portal: (x1, y1, x2, y2, pair) => this.vfx?.portal(x1, y1, x2, y2, portalColour(pair)),
      wallBroken: (i) => level.walls[i] && this.vfx?.wallBroken(level.walls[i]),
      captured: (c) => this.vfx?.captured(c),
      healed: (c) => this.vfx?.healed(c),
    }
    this.sim = new BattleSim(level, this, events, 'progressive')
    this.sim.addAi('player', 'normal')
    // A short, silent planning grace (no 3-2-1 behind the menu): both AIs line up before anyone fires.
    this.sim.startCountdown(TUNING.demoCountdownMs)
    // The demo shows your skin on gold (and the AI's pick on pink), like a round you'd play.
    this.sim.setSkins(vsAiSkins(loadSkin()))
    const offSkin = onSkinChange((skin) => this.sim.setSkins(vsAiSkins(skin)))
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, offSkin)
    // Your team colour too (and the AI's contrasting one); a new pick in Settings recolours it at once.
    applyTeamColours(vsAiColours(loadColour()))
    // Each side's half glows in its colour, like a round.
    const glow = new SideGlow(this, board, glowEdges(this.sim.cannons, board))
    this.glow = glow
    glow.paint(glowColours(vsAiColours(loadColour())))
    const vfx = new Vfx(this, this.sim.cannons, this.fans, currentFxConfig('demo'), { board })
    this.vfx = vfx
    const offFx = onFxChange(() => vfx.setConfig(currentFxConfig('demo')))
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, offFx)
    const offColour = onColourChange((c) => {
      applyTeamColours(vsAiColours(c))
      glow.paint(glowColours(vsAiColours(c)))
    })
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, offColour)
    // Dimmed: the menu sits on top.
    this.add.graphics().setDepth(50).fillStyle(theme.bg, 0.2).fillRect(-200, -200, GAME_WIDTH + 400, GAME_HEIGHT + 400)
    this.cameras.main.fadeIn(700, 20, 14, 12)
    this.input.enabled = false
    // Nothing to do when the tab is hidden: it gets no frames, so the round waits by itself.
    // (It used to sleep here, and could stay asleep after alt-tab: see demoWatch.ts.)
  }

  update(time: number, delta: number): void {
    const dt = Math.min(delta, 50)
    this.glow?.breathe(beatPulse.pulsing, beatPulse.barLevel(performance.now()))
    this.sim.pumpLanes(3)
    if (!this.sim.ended) this.sim.step(dt)
    for (const fan of this.fans) fan.draw(time)
    const moving = this.vfx?.cfg.rings ?? false
    for (const portal of this.portals) portal.tick(time, moving)
    this.walls.forEach((wall, i) => {
      wall.tick(time, moving)
      if (wall.isBreakable) wall.setHealth(this.sim.wallHealth(i))
    })
    for (const pane of this.glass) pane.draw(time, moving)
    setRingScale(this.cameras.main.zoom / (this.scale.displayScale.x || 1))
    this.vfx?.update(dt, time, this.sim.cannons, this.sim.shots, this.fans)
    for (const c of this.sim.cannons) c.draw(time, this.vfx?.cannonFx ?? null)
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
