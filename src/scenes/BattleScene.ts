import Phaser from 'phaser'
import { GAME_HEIGHT, GAME_WIDTH } from '../config/layout'
import type { MapView } from '../editor/maps'
import { cssHex, sideColor, theme } from '../config/theme'
import { TUNING } from '../config/tuning'
import { DEBUG } from '../debug'
import { Cannon } from '../entities/Cannon'
import { Fan } from '../entities/Fan'
import { Wall } from '../entities/Wall'
import { CAMPAIGN, SKIRMISH, campaignIndex, findLevel } from '../levels'
import { recordWin } from '../progress'
import { boardFor, insideBoard } from '../levels/board'
import { bindSceneResolution } from '../render/resolution'
import { WorldCamera } from '../render/WorldCamera'
import { drawBoardSurface } from '../render/boardSurface'
import { clampPoint } from '../sim/aim'
import { BattleSim, type Outcome } from '../sim/BattleSim'
import { MirrorBot, makeBot, type Bot } from '../sim/bots'
import { clipToWalls } from '../sim/geometry'
import { starsFor } from '../sim/stars'
import type { LevelDef, Point, Rect, Side } from '../types'
import { drawStar, makeButton } from '../ui/button'
import { SwapMenu } from '../ui/swapMenu'
import { layoutScale } from '../render/resolution'
import { KINDS, fmtNum, kindLabel, nextKind } from '../config/kinds'

interface Spark {
  x: number
  y: number
  life: number
  color: number
  /** Radius scale (machine gun hits are small). */
  size?: number
}

/** Heals in progress on one cannon, summed into one popup. */
interface HealTally {
  amount: number
  /** ms until the popup shows. */
  left: number
}

/** Machine guns heal 0.3 at a time; their heals are summed over this long. */
const HEAL_TALLY_MS = 450

interface Ping {
  x: number
  y: number
  life: number
  color: number
}

export interface BattleData {
  levelId?: string
  /** A custom map (from the editor or My maps) instead of a built-in level. */
  custom?: LevelDef
  /** Where Back/Menu returns to for custom maps. */
  from?: 'editor' | 'maps'
  /** Start the camera here (the editor's view when playtesting). */
  view?: MapView
}

/** The world viewport: everything under the HUD band. */
/** Slim HUD band on top (same info as before, less height). */
const HUD_H = 54
const HUD_ROW = 18
const WORLD_VIEW = { x: 0, y: HUD_H + 2, w: GAME_WIDTH, h: GAME_HEIGHT - HUD_H - 2 }
/** Hold a press this long on one of your cannons to open its type menu (touch). */
const LONG_PRESS_MS = 450

/** Renders a BattleSim round and turns clicks into aim orders. */
export class BattleScene extends Phaser.Scene {
  private level: LevelDef = SKIRMISH
  private levelIndex = -1
  private custom: LevelDef | null = null
  private startView: MapView | undefined
  private from: BattleData['from'] = undefined
  private board: Rect = boardFor(undefined)
  private wc!: WorldCamera
  private uiCam!: Phaser.Cameras.Scene2D.Camera
  private pressOnUi = false
  private sim!: BattleSim
  private bot: Bot | null = null
  private walls: Wall[] = []
  private fans: Fan[] = []
  private sparks: Spark[] = []
  private heals = new Map<Cannon, HealTally>()
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
  private swapMenu!: SwapMenu
  /** Layout-space pointer position, for the swap menu. */
  private pointerLayout: Point | null = null
  /** A press on one of your cannons that may become a long-press. */
  private press: { cannon: Cannon; at: number } | null = null
  /** The current press already did something (long-press, menu pick): skip its click. */
  private pressUsed = false

  constructor() {
    super('battle')
  }

  init(data: BattleData): void {
    this.custom = data?.custom ?? null
    this.from = data?.from
    this.startView = data?.view
    this.level = this.custom ?? findLevel(data?.levelId) ?? SKIRMISH
    this.levelIndex = this.custom ? -1 : campaignIndex(this.level.id)
    this.board = boardFor(this.level)
  }

  /**
   * Big maps start at the normal "near" zoom, centred on your cannons. If
   * they are spread wider than one screen, zoom out a little to show more of
   * them (never below 70%).
   */
  private frameOwnCannons(): void {
    if (!this.wc.canZoomOut) return
    const mine = this.level.cannons.filter((c) => c.side === 'player')
    if (!mine.length) return
    const pad = 90
    const x0 = Math.min(...mine.map((c) => c.x)) - pad
    const x1 = Math.max(...mine.map((c) => c.x)) + pad
    const y0 = Math.min(...mine.map((c) => c.y)) - pad
    const y1 = Math.max(...mine.map((c) => c.y)) + pad
    this.wc.zoom = Math.max(0.7, Math.min(1, WORLD_VIEW.w / (x1 - x0), WORLD_VIEW.h / (y1 - y0)))
    this.wc.center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }
    this.wc.apply()
  }

  /** Hide from the world camera (HUD, banners, end screen). */
  private ui<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.cameras.main.ignore(obj)
    return obj
  }

  /** Run `build` and send everything it adds to the scene to the UI camera only. */
  private uiBlock<T>(build: () => T): T {
    const before = new Set(this.children.list)
    const out = build()
    for (const obj of this.children.list) if (!before.has(obj)) this.cameras.main.ignore(obj)
    return out
  }

  /** Hide from the fixed UI camera (board content). */
  private world<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.uiCam.ignore(obj)
    return obj
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
    this.heals = new Map()
    this.pings = []
    this.pointer = null
    this.selected = null
    this.hover = null
    this.shownEnd = false
    this.restarting = false
    this.aimsText = null
    this.banner = null
    this.pressOnUi = false
    this.pointerLayout = null
    this.press = null
    this.pressUsed = false

    // Two cameras: a fixed one for the HUD (1200x720 layout) and a world
    // camera under it that can zoom and pan on bigger maps.
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height)
    bindSceneResolution(this, { camera: this.uiCam })
    this.drawBoard()
    this.fx = this.add.graphics().setDepth(3)
    this.level.walls.forEach((rect) => this.walls.push(new Wall(this, rect)))
    this.level.fans.forEach((def) => this.fans.push(new Fan(this, def)))

    this.sim = new BattleSim(
      this.level,
      this,
      {
      bounce: (x, y) => this.sparks.push({ x, y, life: 1, color: theme.spark }),
      hit: (x, y, side, kind) => this.sparks.push({ x, y, life: 1, color: sideColor(side), size: kind === 'machinegun' ? 0.45 : 1 }),
      blocked: (x, y, shield, _side, kind) => {
        this.sparks.push({ x, y, life: 1, color: sideColor(shield.side), size: kind === 'machinegun' ? 0.5 : 1.1 })
        this.sparks.push({ x, y, life: 0.7, color: 0xffffff, size: kind === 'machinegun' ? 0.3 : 0.6 })
      },
      shieldBroken: (shield) => this.popup(shield.x, shield.y - 8, 'Shield down', cssHex(sideColor(shield.side))),
      shieldBack: (shield) => this.popup(shield.x, shield.y - 8, 'Shield up', cssHex(sideColor(shield.side))),
      captured: (cannon) => this.popup(cannon.x, cannon.y, 'Captured', cssHex(sideColor(cannon.side))),
      healed: (cannon, amount) => this.tallyHeal(cannon, amount),
      noAims: (cannon) => this.popup(cannon.x, cannon.y, 'No aims left', theme.textMuted),
      swapped: (cannon) => this.popup(cannon.x, cannon.y, kindLabel(cannon.kind), cssHex(sideColor(cannon.side))),
      aimed: (point) => {
        this.pings.push({ x: point.x, y: point.y, life: 1, color: theme.select })
        this.hideBanner()
      },
      },
      DEBUG.bot ? undefined : 'progressive',
    )
    // Everything created so far is board content.
    this.children.list.forEach((obj) => this.world(obj))
    this.wc = new WorldCamera(this, this.board, WORLD_VIEW, undefined, 1)
    if (this.startView && this.wc.canZoomOut) {
      // Playtest from the editor: same zoom and centre (play never zooms past near).
      this.wc.zoom = Math.min(1, this.startView.zoom)
      this.wc.center = { x: this.startView.x, y: this.startView.y }
      this.wc.apply()
    } else this.frameOwnCannons()
    this.bot = !DEBUG.bot
      ? null
      : DEBUG.botStyle === 'mirror' && !this.sim.isPuzzle
        ? new MirrorBot(this.sim)
        : makeBot(this.sim)

    this.uiBlock(() => this.createHud())
    this.swapMenu = new SwapMenu(this, (obj) => this.ui(obj))
    if (this.wc.canZoomOut) this.createZoomUi()
    if (this.level.hint) this.showBanner(this.level.hint)
    else if (this.wc.canZoomOut) this.showBanner('Big map: scroll or pinch to zoom out, drag empty space or use WASD to pan.')
    this.bindInput()
    this.refreshHud()
    if (DEBUG.enabled) (window as unknown as { __cc?: unknown }).__cc = { scene: this, sim: this.sim }
  }

  update(time: number, delta: number): void {
    const dt = Math.min(delta, 32)
    for (const fan of this.fans) fan.draw(time)

    this.wc.update(dt)
    this.sim.pumpLanes(5)
    for (let i = 0; i < DEBUG.speed && !this.sim.ended; i++) {
      this.bot?.update(dt)
      this.sim.step(dt)
    }
    if (this.selected && this.selected.side !== 'player') this.selected = null
    if (this.sim.ended && !this.shownEnd) this.finish()

    this.fadeSparks(dt)
    this.flushHeals(dt)
    for (const ping of this.pings) ping.life -= dt / 420
    this.pings = this.pings.filter((ping) => ping.life > 0)
    this.drawFx(time)
    this.updateSwapMenu(dt, time)
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
    this.input.off('pointerup', this.onPointerUp, this)
    this.input.off('wheel', this.onWheel, this)
    this.input.on('pointerdown', this.onPointerDown, this)
    this.input.on('pointermove', this.onPointerMove, this)
    this.input.on('pointerup', this.onPointerUp, this)
    this.input.on('wheel', this.onWheel, this)
    const keyboard = this.input.keyboard
    if (!keyboard) return
    keyboard.off('keydown-R', this.onRestartKey, this)
    keyboard.off('keydown-ESC', this.onCancelKey, this)
    keyboard.off('keydown-N', this.onNextKey, this)
    keyboard.off('keydown-T', this.onTypeKey, this)
    keyboard.on('keydown-T', this.onTypeKey, this)
    keyboard.on('keydown-R', this.onRestartKey, this)
    keyboard.on('keydown-ESC', this.onCancelKey, this)
    keyboard.on('keydown-N', this.onNextKey, this)
  }

  private onRestartKey(): void {
    this.restart()
  }

  private onCancelKey(): void {
    if (this.swapMenu.open) this.swapMenu.hide()
    else this.selected = null
  }

  /** T: swap the selected cannon to the next tower type. */
  private onTypeKey(): void {
    const sel = this.selected
    if (!sel || this.ended) return
    this.sim.playerSwap(sel, nextKind(sel.kind))
  }

  private toLayout(pointer: Phaser.Input.Pointer): Point {
    const k = layoutScale(this)
    return { x: pointer.x / k, y: pointer.y / k }
  }

  /** Which of your cannons may show the type menu right now. */
  private menuCandidate(): Cannon | null {
    if (this.ended || this.restarting || this.wc.dragging) return null
    const c = this.hover
    if (!c || c.side !== 'player') return null
    // While aiming, only the selected cannon's own menu shows, so it never covers an aim click.
    if (this.selected && this.selected !== c) return null
    return c
  }

  private updateSwapMenu(dt: number, time: number): void {
    const menu = this.swapMenu
    // Long-press on one of your cannons pins its menu (the touch way in).
    if (this.press && !this.pressUsed && this.input.activePointer.isDown && !this.wc.dragging && time - this.press.at >= LONG_PRESS_MS) {
      if (this.press.cannon.side === 'player') {
        menu.show(this.press.cannon, true)
        this.pressUsed = true
      }
      this.press = null
    }
    const lp = this.pointerLayout
    const onMenu = !!lp && menu.contains(lp.x, lp.y)
    menu.update(dt, this.menuCandidate(), onMenu)
    menu.setHot(lp ? menu.pillAt(lp.x, lp.y) : null)
    if (this.ended) menu.hide()
    const c = menu.cannon
    if (!c) return menu.draw(null, 0, 0)
    const p = this.wc.toScreen(c.x, c.y)
    const k = layoutScale(this)
    menu.draw({ x: p.x / k, y: p.y / k }, TUNING.cannonRadius * this.wc.zoom, HUD_H + 6)
  }

  private onNextKey(): void {
    if (this.ended === 'win' && this.nextLevel()) this.goNext()
  }

  private onPointerDown(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    this.press = null
    this.pressUsed = false
    // The type menu sits above the board: a press on it never reaches the board.
    const lp = this.toLayout(pointer)
    this.pointerLayout = lp
    if (this.swapMenu.open && this.swapMenu.contains(lp.x, lp.y)) {
      this.pressOnUi = true
      const kind = this.swapMenu.pillAt(lp.x, lp.y)
      const cannon = this.swapMenu.cannon
      if (kind && cannon) {
        this.sim.playerSwap(cannon, kind)
        if (this.swapMenu.pinned) this.swapMenu.hide()
      }
      return
    }
    // HUD buttons and anything above the board handle themselves.
    this.pressOnUi = (over && over.length > 0) || !this.wc.inView(pointer.x, pointer.y)
    if (this.pressOnUi) return
    if (this.swapMenu.pinned) {
      // First tap away from a pinned menu just closes it.
      this.swapMenu.hide()
      this.pressUsed = true
    }
    if (!this.ended) {
      const w = this.wc.toWorld(pointer.x, pointer.y)
      const c = this.cannonAt(w.x, w.y)
      if (c && c.side === 'player') this.press = { cannon: c, at: this.time.now }
    }
    // On big maps a press may turn into a pan; it only aims if it doesn't move.
    this.wc.down(pointer, this.wc.canZoomOut)
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const gesture = this.wc.up(pointer)
    if (this.pressOnUi) {
      this.pressOnUi = false
      return
    }
    this.press = null
    if (this.pressUsed) {
      this.pressUsed = false
      return
    }
    if (gesture !== 'click' || this.ended || this.restarting) return
    const { x, y } = this.wc.toWorld(pointer.x, pointer.y)
    this.onClick(x, y, pointer.wasTouch)
  }

  private onWheel(pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number): void {
    this.wc.wheel(pointer, dy)
  }

  private onClick(x: number, y: number, touch = false): void {
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
      // Touch has no hover: tapping the selected cannon opens its type menu instead.
      if (touch && !(this.swapMenu.cannon === sel && this.swapMenu.pinned)) {
        this.swapMenu.show(sel, true)
        return
      }
      this.selected = null
      return
    }
    if (hit && hit.side === 'player' && !hit.damaged) {
      this.selected = hit
      return
    }
    if (hit) {
      // A successful aim deselects, so a stray second click can't re-aim by accident.
      if (this.playerAim(sel, hit)) this.selected = null
      return
    }
    if (!insideBoard(this.board, x, y)) {
      this.selected = null
      return
    }
    if (this.playerAim(sel, clampPoint(x, y, this.board, TUNING.shotRadius))) this.selected = null
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    this.pointerLayout = this.toLayout(pointer)
    if (this.swapMenu.open && this.swapMenu.contains(this.pointerLayout.x, this.pointerLayout.y)) {
      this.input.setDefaultCursor(this.swapMenu.pillAt(this.pointerLayout.x, this.pointerLayout.y) ? 'pointer' : 'default')
      this.pointer = null
      return
    }
    if (this.wc.move(pointer)) {
      this.hover = null
      this.pointer = null
      this.input.setDefaultCursor('grabbing')
      return
    }
    if (this.ended || !this.wc.inView(pointer.x, pointer.y)) {
      this.hover = null
      this.pointer = null
      if (!this.ended) this.input.setDefaultCursor('default')
      return
    }
    const { x, y } = this.wc.toWorld(pointer.x, pointer.y)
    this.hover = this.cannonAt(x, y)
    this.pointer = insideBoard(this.board, x, y) && !pointer.wasTouch ? { x, y } : null
    const clickable = this.hover && (this.hover.side === 'player' || this.selected)
    this.input.setDefaultCursor(clickable ? 'pointer' : this.selected && this.pointer ? 'crosshair' : 'default')
  }

  private createZoomUi(): void {
    const x = GAME_WIDTH - 58
    const y = GAME_HEIGHT - 150
    const plus = makeButton(this, x, y, '+', () => this.wc.zoomBy(1.25), { width: 44, height: 40, primary: false, fontSize: 22 })
    const minus = makeButton(this, x, y + 48, '−', () => this.wc.zoomBy(0.8), { width: 44, height: 40, primary: false, fontSize: 22 })
    const fit = makeButton(this, x, y + 96, 'Fit', () => this.wc.fit(), { width: 44, height: 40, primary: false, fontSize: 13 })
    this.ui(this.add.container(0, 0, [plus, minus, fit]).setDepth(11))
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
    // Restarting keeps the camera where you left it.
    const view = { zoom: this.wc.zoom, x: this.wc.center.x, y: this.wc.center.y }
    this.scene.restart(this.custom ? { custom: this.custom, from: this.from, view } : { levelId: this.level.id, view })
  }

  private goNext(): void {
    const next = this.nextLevel()
    if (!next || this.restarting) return
    this.restarting = true
    this.scene.start('battle', { levelId: next.id })
  }

  private backLabel(short: boolean): string {
    if (this.custom) return this.from === 'editor' ? (short ? 'Editor' : 'Back to editor') : 'My maps'
    return this.levelIndex >= 0 ? 'Map' : 'Menu'
  }

  private goBack(): void {
    if (this.restarting) return
    this.restarting = true
    this.input.setDefaultCursor('default')
    if (this.custom) {
      if (this.from === 'editor') this.scene.start('editor', { resume: true })
      else this.scene.start('maps')
      return
    }
    this.scene.start(this.levelIndex >= 0 ? 'map' : 'title', { focus: this.level.id })
  }

  // ---------------------------------------------------------------- HUD and screens

  private drawBoard(): void {
    drawBoardSurface(this, this.board)
    // HUD band (fixed camera).
    const hud = this.ui(this.add.graphics().setDepth(9))
    hud.fillStyle(theme.hud, 1)
    hud.fillRect(0, 0, GAME_WIDTH, HUD_H)
    hud.fillStyle(theme.boardEdge, 1)
    hud.fillRect(0, HUD_H, GAME_WIDTH, 2)
  }

  private createHud(): void {
    const title =
      this.levelIndex >= 0
        ? `${this.levelIndex + 1}. ${this.level.name}${this.isPuzzle ? '  ·  Puzzle' : ''}`
        : this.custom
          ? `${this.level.name}  ·  ${this.isPuzzle ? 'Puzzle' : 'Battle'}${this.from === 'editor' ? '  ·  Playtest' : ''}`
          : `Cannon Capture  ·  ${this.level.name}`
    this.add
      .text(24, 8, title, {
        fontFamily: theme.font,
        fontSize: '18px',
        fontStyle: 'bold',
        color: theme.text,
      })
      .setDepth(10)

    this.hint = this.add
      .text(24, 32, '', { fontFamily: theme.font, fontSize: '13px', color: theme.textMuted })
      .setDepth(10)

    const legend = this.add.graphics().setDepth(10)
    const groups: { side: Side; x: number; label: string }[] = [
      { side: 'player', x: 600, label: 'You' },
      { side: 'neutral', x: 712, label: 'Neutral' },
    ]
    if (!this.isPuzzle) groups.push({ side: 'enemy', x: 852, label: 'Enemy' })
    const counts: Partial<Record<Side, Phaser.GameObjects.Text>> = {}
    this.counts = counts
    for (const group of groups) {
      legend.fillStyle(sideColor(group.side), 1)
      legend.fillCircle(group.x, HUD_ROW, 6)
      counts[group.side] = this.add
        .text(group.x + 14, HUD_ROW, '0', {
          fontFamily: theme.font,
          fontSize: '15px',
          fontStyle: 'bold',
          color: cssHex(sideColor(group.side)),
        })
        .setOrigin(0, 0.5)
        .setDepth(10)
      this.add
        .text(group.x + 40, HUD_ROW, group.label, { fontFamily: theme.font, fontSize: '14px', color: theme.textMuted })
        .setOrigin(0, 0.5)
        .setDepth(10)
    }
    if (this.isPuzzle && this.level.aims !== undefined) {
      this.aimsText = this.add
        .text(870, HUD_ROW, '', { fontFamily: theme.font, fontSize: '15px', fontStyle: 'bold', color: theme.text })
        .setOrigin(0, 0.5)
        .setDepth(10)
    }

    const link = (x: number, label: string, onClick: () => void): void => {
      const text = this.add
        .text(x, HUD_ROW, label, { fontFamily: theme.font, fontSize: '14px', color: theme.textMuted })
        .setOrigin(1, 0.5)
        .setDepth(10)
        .setInteractive({ useHandCursor: true })
      text.on('pointerover', () => text.setColor(theme.text))
      text.on('pointerout', () => text.setColor(theme.textMuted))
      text.on('pointerdown', onClick)
    }
    link(GAME_WIDTH - 28, 'Restart', () => this.restart())
    link(GAME_WIDTH - 112, this.backLabel(true), () => this.goBack())
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
    const lp = this.pointerLayout
    const pill = lp && this.swapMenu.open ? this.swapMenu.pillAt(lp.x, lp.y) : null
    if (pill && this.swapMenu.cannon) {
      const c = this.swapMenu.cannon
      if (pill === c.kind) return `${c.name} is a ${kindLabel(c.kind)}: ${KINDS[c.kind].blurb}.`
      return `Swap ${c.name} to ${kindLabel(pill)}: ${KINDS[pill].blurb}. ${KINDS[pill].fires ? 'It reloads before its first shot.' : 'Its barrier comes up after the reload.'}`
    }
    if (!this.selected) {
      if (this.hover && this.hover.side === 'player') return `Click to select ${this.hover.name}, or pick a type above it (long-press on touch).`
      return 'Click one of your gold cannons to select it, then click where it should aim.'
    }
    const name = this.selected.name
    if (!this.selected.fires) {
      if (this.hover === this.selected) return `Click ${name} again to deselect.`
      if (this.hover && this.hover.side === 'player' && !this.hover.damaged) return `Click to select ${this.hover.name} instead.`
      return `${name} is a shield: click where its barrier should face (enemy shots stop on it; yours pass through).`
    }
    if (this.hover && this.hover !== this.selected) {
      if (this.hover.side === 'player' && this.hover.damaged) return `${name} → heal ${this.hover.name} (it goes back to its old aim once ${this.hover.name} is whole).`
      if (this.hover.side === 'player') return `Click to select ${this.hover.name} instead.`
      return `${name} → ${this.hover.name}`
    }
    if (this.hover === this.selected) return `Click ${name} again to deselect.`
    return `${name}: click anywhere to aim (it deselects after), or click it again to cancel.`
  }

  private showBanner(message: string): void {
    this.uiBlock(() => this.buildBanner(message))
  }

  private buildBanner(message: string): void {
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
      .container(GAME_WIDTH / 2, GAME_HEIGHT - 24 - h / 2 - 14, [g, text])
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
    this.uiBlock(() => this.buildEnd(result))
  }

  private buildEnd(result: Outcome): void {
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
      buttons.push(makeButton(this, cx + 112, by, this.backLabel(false), () => this.goBack(), { width: 200, primary: false }))
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

  /**
   * "+N heal" popups. A whole-number heal shows at once; fractional ones
   * (machine guns) are summed for a moment so a burst reads as one "+1.5 heal".
   */
  private tallyHeal(cannon: Cannon, amount: number): void {
    const tally = this.heals.get(cannon)
    if (tally) tally.amount += amount
    else if (Number.isInteger(amount)) this.showHeal(cannon, amount)
    else this.heals.set(cannon, { amount, left: HEAL_TALLY_MS })
  }

  private flushHeals(dt: number): void {
    for (const [cannon, tally] of this.heals) {
      tally.left -= dt
      if (tally.left > 0) continue
      this.heals.delete(cannon)
      this.showHeal(cannon, tally.amount)
    }
  }

  private showHeal(cannon: Cannon, amount: number): void {
    this.popup(cannon.x, cannon.y - 8, `+${fmtNum(amount)} heal`, cssHex(sideColor(cannon.side)))
  }

  private popup(x: number, y: number, message: string, color: string): void {
    const text = this.world(
      this.add
        .text(x, y - 40, message, { fontFamily: theme.font, fontSize: '16px', fontStyle: 'bold', color })
        .setOrigin(0.5)
        .setDepth(15),
    )
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
      // A shield's barrier shows where it faces; no aim line (it doesn't shoot).
      if (!cannon.fires) continue
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
    if (sel && !this.ended && !sel.fires) {
      // A shield: a ghost of the barrier, turned toward the pointer.
      const at = this.hover && this.hover !== sel ? this.hover : this.pointer
      if (at) {
        const s = TUNING.shield
        const facing = Math.atan2(at.y - sel.y, at.x - sel.x)
        const half = (s.arcDeg * Math.PI) / 360
        g.lineStyle(6, theme.select, 0.45 + 0.2 * Math.sin(time / 140))
        g.beginPath()
        g.arc(sel.x, sel.y, s.reach, facing - half, facing + half, false)
        g.strokePath()
        crosshair(g, at.x, at.y, 9, theme.select, 0.6)
      }
    } else if (sel && !this.ended) {
      const hover = this.hover && this.hover !== sel ? this.hover : null
      if (hover && (hover.side !== 'player' || hover.damaged)) {
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
      if (shot.kind === 'machinegun') {
        // Machine gun round: a small, short tracer (cheap to draw, there are lots).
        const { vx, vy } = shot.ball
        const v = Math.hypot(vx, vy) || 1
        const tx = shot.ball.x - (vx / v) * 11
        const ty = shot.ball.y - (vy / v) * 11
        g.lineStyle(5, color, 0.95)
        g.lineBetween(tx, ty, shot.ball.x, shot.ball.y)
        g.lineStyle(2, 0xffffff, 0.8)
        g.lineBetween(tx + (vx / v) * 5, ty + (vy / v) * 5, shot.ball.x, shot.ball.y)
        continue
      }
      if (shot.kind === 'sniper') {
        // Sniper round: a long, thin streak and a smaller, brighter head.
        const { vx, vy } = shot.ball
        const v = Math.hypot(vx, vy) || 1
        const len = 46
        g.lineStyle(TUNING.shotRadius * 0.9, color, 0.32)
        g.beginPath()
        g.moveTo(shot.ball.x - (vx / v) * len, shot.ball.y - (vy / v) * len)
        g.lineTo(shot.ball.x, shot.ball.y)
        g.strokePath()
        g.lineStyle(2, 0xffffff, 0.5)
        g.beginPath()
        g.moveTo(shot.ball.x - (vx / v) * len * 0.5, shot.ball.y - (vy / v) * len * 0.5)
        g.lineTo(shot.ball.x, shot.ball.y)
        g.strokePath()
        g.fillStyle(color, 1)
        g.fillCircle(shot.ball.x, shot.ball.y, TUNING.shotRadius * 0.8)
        g.fillStyle(0xffffff, 0.95)
        g.fillCircle(shot.ball.x, shot.ball.y, 2.2)
        continue
      }
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
      const k = spark.size ?? 1
      g.fillStyle(spark.color, spark.life * 0.7)
      g.fillCircle(spark.x, spark.y, (4 + (1 - spark.life) * 10) * k)
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
