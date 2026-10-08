import { DEFAULT_SKIN, flipSkins, vsAiSkins, type SideSkins } from '../config/skins'
import { loadSkin } from '../menu/skinPref'
import Phaser from 'phaser'
import { GAME_HEIGHT, GAME_WIDTH } from '../config/layout'
import type { MapView } from '../editor/maps'
import { cssHex, ownerRing, sideColor, swapSideColours, theme } from '../config/theme'
import { TUNING } from '../config/tuning'
import { DEBUG } from '../debug'
import { BRAND } from '../config/brand'
import { BattleMenu } from '../ui/battleMenu'
import { ICONS } from '../menu/art'
import { nextPuzzle } from '../menu/menuModel'
import { PauseHold } from '../menu/pauseHold'
import { EDITOR_KEY, MAIN_MENU, backLabel as routeBackLabel, backRoute, editorReturn, type BattleCtx, type BattleFrom, type Route } from '../menu/routes'
import { isTypingTarget } from '../ui/typing'
import { Sfx, preloadSfx } from '../audio/Sfx'
import { Cannon, haloR, setRingScale } from '../entities/Cannon'
import { Fan } from '../entities/Fan'
import { Wall } from '../entities/Wall'
import { CAMPAIGN, SKIRMISH, campaignIndex, findLevel } from '../levels'
import { recordWin } from '../progress'
import { boardFor, insideBoard } from '../levels/board'
import { bindSceneResolution } from '../render/resolution'
import { WorldCamera } from '../render/WorldCamera'
import { drawBoardSurface } from '../render/boardSurface'
import { crosshair, dash, drawShots } from '../render/battleMarks'
import { clampPoint } from '../sim/aim'
import { BattleSim, type Outcome } from '../sim/BattleSim'
import { MirrorBot, makeBot, type Bot } from '../sim/bots'
import { clipToWalls } from '../sim/geometry'
import { starsFor } from '../sim/stars'
import type { LevelDef, Point, Rect, Side } from '../types'
import { drawStar, makeButton } from '../ui/button'
import { SwapMenu, type AutoState } from '../ui/swapMenu'
import { SettingsPanel } from '../ui/settingsPanel'
import { perf } from '../perf/PerfOverlay'
import { layoutScale } from '../render/resolution'
import { KINDS, firesAs, fmtNum, kindLabel, nextKind } from '../config/kinds'
import { PVP } from '../config/pvp'
import { FixedStep, SIM_STEP_MS } from '../sim/fixedStep'
import { applyOrder, type Order, type OrderResult } from '../sim/orders'
import type { SimEvents } from '../sim/BattleSim'
import { PvpClient, PvpHost, flipLevel, type StartMsg } from '../net/pvp'
import { randomId, type Transport } from '../net/transport'
import type { OnlineRoom, OnlineStart } from '../net/onlineClient'
import { clock, endTexts, nameOnSide, netLine, opponentLine, pauseCheck, pauseLabel, rematchLine, sideIndex } from '../net/onlineView'
import { PVP_RULES } from '../config/pvpRules'

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
  /** Where it was started from (decides Back and Next). */
  from?: BattleFrom
  /** Start the camera here (the editor's view when playtesting). */
  view?: MapView
  /** Player vs player test mode (?pvpdev): this game hosts the round, or plays pink in someone else's. */
  pvp?: PvpData
}

export type PvpData =
  | { role: 'host'; room: string; transport: Transport; /** Restart: the player already here. */ peer?: string }
  | { role: 'client'; room: string; transport: Transport; start: StartMsg }
  /** Online (server/): the server runs the round; this screen draws it and sends orders, like 'client'. */
  | { role: 'online'; room: string; transport: OnlineRoom; start: OnlineStart }

/** Back to the online room's lobby (the room stays joined). */
const LOBBY: Route = { scene: 'title', data: { screen: 'lobby' } }

/** In player vs player the menu and leaving the window don't pause the round (the other player is still playing). */
const NO_HOLD = { paused: false, ended: null, pause: () => false, resume: () => {} }

/** The world viewport: everything under the HUD band. */
/** Slim HUD band on top (same info as before, less height). */
const HUD_H = 54
const HUD_ROW = 18
/** How long "Go!" shows after the countdown (ms). */
const GO_MS = 850
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
  /** Sound effects (shots, captures, barrier breaks). */
  sfx!: Sfx
  /** Dragging the Settings volume slider. */
  private volumeDrag = false
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
  /** The 3-2-1-Go overlay: the number showing (0: none) and how long "Go!" still shows (ms). */
  private countdownFx!: Phaser.GameObjects.Graphics
  private countdownNum!: Phaser.GameObjects.Text
  private countdownHint!: Phaser.GameObjects.Text
  private countShown = 0
  private goLeft = 0
  /** Time left on the "no pausing during the countdown" note (player vs player). */
  private countNoteLeft = 0
  private restarting = false
  /** The in-battle menu (HUD "Menu" or Esc); the round is paused while it is open. */
  private battleMenu!: BattleMenu
  /** Look-ahead time already counted by the performance overlay (null while it is hidden). */
  private lookBase: number | null = null
  private readonly menuHold = new PauseHold(() => (this.pvp ? NO_HOLD : this.sim))
  /** The round advances in fixed steps; the screen draws between them. */
  private readonly steps = new FixedStep(SIM_STEP_MS)
  private pvp: PvpData | null = null
  /** Player vs player: this game runs the round (gold) ... */
  private host: PvpHost | null = null
  /** ... or only shows the host's round (pink, seen as gold) and sends orders. */
  private client: PvpClient | null = null
  /** The event handlers (the client replays the host's events through them). */
  private simEvents: SimEvents = {}
  /** Player vs player: the other player is here (the host waits until they are). */
  private peerHere = false
  /** Online: the room (null otherwise). */
  private online: OnlineRoom | null = null
  /** Online: this player's side index (0 gold, 1 pink), null when watching. */
  private me: 0 | 1 | null = null
  private sawPlaying = false
  private endRoot: Phaser.GameObjects.Container | null = null
  private clockText: Phaser.GameObjects.Text | null = null
  private netText: Phaser.GameObjects.Text | null = null
  /** When each side's player dropped (for the AI countdown). */
  private dropAt: [number | null, number | null] = [null, null]
  private hint!: Phaser.GameObjects.Text
  private pauseLink!: Phaser.GameObjects.Text
  /** Paused: a frame round the board and a label at its top (UI camera; never blocks the board). */
  private pausedFx!: Phaser.GameObjects.Graphics
  private pausedLabel!: Phaser.GameObjects.Text
  /** Paused: "→ Sniper" over cannons with a queued type swap (board layer). */
  private queuedLabels = new Map<Cannon, Phaser.GameObjects.Text>()
  private counts!: Partial<Record<Side, Phaser.GameObjects.Text>>
  private aimsText: Phaser.GameObjects.Text | null = null
  /** Playtest: the top bar's "Editor (E)" button (null when not launched from the editor). */
  editorButton: Phaser.GameObjects.Container | null = null
  private banner: Phaser.GameObjects.Container | null = null
  private swapMenu!: SwapMenu
  private settings!: SettingsPanel
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
    this.pvp = data?.pvp ?? null
    // The second player sees the host's map with the sides swapped, so their cannons are "yours" here.
    if (this.pvp?.role === 'client') this.custom = flipLevel(this.pvp.start.level)
    // Online, everyone sees themselves as gold: pink's player gets the board with the sides swapped.
    else if (this.pvp?.role === 'online') this.custom = this.pvp.start.side === 'enemy' ? flipLevel(this.pvp.start.level) : this.pvp.start.level
    this.level = this.custom ?? findLevel(data?.levelId) ?? SKIRMISH
    // Player vs player is never a campaign round (no stars, no Next, no progress saved).
    this.levelIndex = this.custom || this.pvp ? -1 : campaignIndex(this.level.id)
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

  preload(): void {
    preloadSfx(this)
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
    this.countShown = 0
    this.goLeft = 0
    this.countNoteLeft = 0
    this.restarting = false
    this.aimsText = null
    this.editorButton = null
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

    this.volumeDrag = false
    this.sfx = new Sfx(this, () => ({ rect: this.wc.visibleRect(), zoom: this.wc.zoom }))
    this.host = null
    this.client = null
    this.peerHere = false
    this.online = null
    this.me = null
    this.sawPlaying = false
    this.endRoot = null
    this.clockText = null
    this.netText = null
    this.dropAt = [null, null]
    this.steps.reset()
    const pvp = this.pvp
    if (pvp?.role === 'client') swapSideColours(!PVP.seeSelfAsGold)
    else swapSideColours(false)
    let events: SimEvents = {
        fired: (cannon) => this.sfx.shot(cannon),
      bounce: (x, y) => this.sparks.push({ x, y, life: 1, color: theme.spark }),
      hit: (x, y, side, kind) => this.sparks.push({ x, y, life: 1, color: sideColor(side), size: kind === 'machinegun' ? 0.45 : 1 }),
      blocked: (x, y, shield, _side, kind) => {
        this.sparks.push({ x, y, life: 1, color: sideColor(shield.side), size: kind === 'machinegun' ? 0.5 : 1.1 })
        this.sparks.push({ x, y, life: 0.7, color: 0xffffff, size: kind === 'machinegun' ? 0.3 : 0.6 })
      },
      shieldBroken: (shield) => {
        this.popup(shield.x, shield.y - 8, 'Shield down', cssHex(sideColor(shield.side)))
        this.sfx.shieldBroken(shield)
      },
      shieldBack: (shield) => this.popup(shield.x, shield.y - 8, 'Shield up', cssHex(sideColor(shield.side))),
      captured: (cannon) => {
        this.popup(cannon.x, cannon.y, 'Captured', cssHex(sideColor(cannon.side)))
        this.sfx.captured(cannon)
      },
      healed: (cannon, amount) => this.tallyHeal(cannon, amount),
      noAims: (cannon) => this.popup(cannon.x, cannon.y, 'No aims left', theme.textMuted),
      swapped: (cannon) => this.popup(cannon.x, cannon.y, kindLabel(cannon.kind), cssHex(sideColor(cannon.side))),
      aimed: (point) => {
        // The other player's aims don't ping on the host's screen.
        if (this.host?.applyingRemote) return
        this.pings.push({ x: point.x, y: point.y, life: 1, color: theme.select })
        this.hideBanner()
      },
    }
    this.simEvents = events
    if (pvp?.role === 'host') {
      this.host = new PvpHost(pvp.transport, this.level, randomId(), 'enemy', SIM_STEP_MS, pvp.peer)
      events = this.host.log.tap(events)
    }
    // The second player's round is only a picture of the host's: it never runs, so it gets no handlers.
    this.sim = new BattleSim(this.level, this, pvp && pvp.role !== 'host' ? {} : events, DEBUG.bot && !pvp ? undefined : 'progressive')
    if (this.host) this.host.localSkin = loadSkin()
    this.sim.setSkins(this.roundSkins(pvp))
    // 3-2-1-Go before every round this screen runs (a network view shows the host's or server's countdown instead).
    if (!pvp || pvp.role === 'host') this.sim.startCountdown(DEBUG.countdown ?? TUNING.countdownMs)
    if (pvp) this.startPvp(pvp)
    // Everything created so far is board content.
    this.children.list.forEach((obj) => this.world(obj))
    this.wc = new WorldCamera(this, this.board, WORLD_VIEW, undefined, 1)
    if (this.startView && this.wc.canZoomOut) {
      // Playtest from the editor: same zoom and centre (play never zooms past near).
      this.wc.zoom = Math.min(1, this.startView.zoom)
      this.wc.center = { x: this.startView.x, y: this.startView.y }
      this.wc.apply()
    } else this.frameOwnCannons()
    this.bot = !DEBUG.bot || pvp
      ? null
      : DEBUG.botStyle === 'mirror' && !this.sim.isPuzzle
        ? new MirrorBot(this.sim)
        : makeBot(this.sim)

    this.uiBlock(() => this.createHud())
    this.swapMenu = new SwapMenu(this, (obj) => this.ui(obj), (c) => this.autoState(c), (c) => this.sim.queuedKind(c))
    this.pausedFx = this.ui(this.add.graphics().setDepth(30))
    this.pausedLabel = this.ui(
      this.add
        .text(GAME_WIDTH / 2, HUD_H + 24, 'Paused  ·  give orders now, they all happen when you resume (Space)', {
          fontFamily: theme.font,
          fontSize: '14px',
          fontStyle: 'bold',
          color: theme.ink,
        })
        .setOrigin(0.5)
        .setDepth(31)
        .setVisible(false),
    )
    this.countdownFx = this.ui(this.add.graphics().setDepth(18))
    this.countdownNum = this.ui(
      this.add
        .text(GAME_WIDTH / 2, 0, '', { fontFamily: theme.font, fontSize: '112px', fontStyle: 'bold', color: cssHex(theme.player), stroke: cssHex(theme.hud), strokeThickness: 8 })
        .setOrigin(0.5)
        .setDepth(19)
        .setVisible(false),
    )
    this.countdownHint = this.ui(
      this.add
        .text(GAME_WIDTH / 2, 0, '', { fontFamily: theme.font, fontSize: '16px', fontStyle: 'bold', color: theme.text, backgroundColor: cssHex(theme.panel), padding: { x: 12, y: 6 } })
        .setOrigin(0.5)
        .setDepth(19)
        .setVisible(false),
    )
    // Leaving the tab (or the window) pauses the round, so nothing happens behind your back.
    this.game.events.on(Phaser.Core.Events.BLUR, this.onLoseFocus, this)
    this.game.events.on(Phaser.Core.Events.HIDDEN, this.onLoseFocus, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // Stop listening (Back / Main menu say goodbye first; a restart keeps the connection).
      this.host?.close(false)
      this.client?.close(false)
      swapSideColours(false)
      this.game.events.off(Phaser.Core.Events.BLUR, this.onLoseFocus, this)
      this.game.events.off(Phaser.Core.Events.HIDDEN, this.onLoseFocus, this)
      this.input.keyboard?.removeCapture('SPACE')
    })
    // A DOM button focused before the round (the editor's Playtest, say) must not catch Space.
    if (typeof document !== 'undefined') (document.activeElement as HTMLElement | null)?.blur?.()
    this.settings = new SettingsPanel(this, (obj) => this.ui(obj), GAME_WIDTH - 16, HUD_H + 8)
    this.menuHold.release()
    // A restart from the open menu left keys off (the scene object is reused).
    if (this.input.keyboard) this.input.keyboard.enabled = true
    this.battleMenu = new BattleMenu(this, () => this.closeMenu(), () => {
      this.closeMenu()
      this.restart()
    })
    if (this.wc.canZoomOut) this.createZoomUi()
    if (pvp) this.pvpBanner()
    else if (this.level.hint) this.showBanner(this.level.hint)
    else if (this.wc.canZoomOut) this.showBanner('Big map: scroll or pinch to zoom out, drag empty space or use WASD to pan.')
    this.bindInput()
    this.refreshHud()
    this.lookBase = null
    perf.battle = {
      level: this.level,
      cannons: () => this.sim.cannons.length,
      shots: () => this.sim.shots.length,
      sounds: () => this.sfx.voices,
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (perf.battle?.level === this.level) perf.battle = null
    })
    if (DEBUG.enabled) (window as unknown as { __cc?: unknown }).__cc = { scene: this, sim: this.sim, sfx: this.sfx, net: this.host ?? this.client }
  }

  update(time: number, delta: number): void {
    const dt = Math.min(delta, 32)
    for (const fan of this.fans) fan.draw(time)

    this.wc.update(dt)
    // Performance overlay: time the simulation only while it is shown.
    const timing = perf.active
    this.sim.timeAi = timing
    const t0 = timing ? performance.now() : 0
    // Nothing fires during the countdown: spend more of the frame on lanes, so the AI knows them by Go.
    this.sim.pumpLanes(this.sim.countdown > 0 ? 10 : 5)
    if (this.client) {
      // Second player: show the host's round a moment behind its newest snapshot.
      this.client.update(this.sim, this.simEvents, delta)
    } else {
      const running = !this.sim.ended && !this.sim.paused && (!this.host || this.host.joined)
      const n = running ? this.steps.take(delta) * DEBUG.speed : (this.steps.reset(), 0)
      for (let i = 0; i < n && !this.sim.ended && !this.sim.paused; i++) {
        this.bot?.update(SIM_STEP_MS)
        this.sim.step(SIM_STEP_MS)
        this.host?.stepped()
      }
      this.host?.frame()
    }
    if (timing) this.recordPerf(performance.now() - t0)
    else this.lookBase = null
    if (this.selected && this.selected.side !== 'player') this.selected = null
    if (this.sim.ended && !this.shownEnd) this.finish()

    this.fadeSparks(dt)
    this.flushHeals(dt)
    for (const ping of this.pings) ping.life -= dt / 420
    this.pings = this.pings.filter((ping) => ping.life > 0)
    this.drawFx(time)
    this.drawPaused(time)
    this.updateSwapMenu(dt, time)
    if (this.ended) this.settings.hide()
    const lp = this.pointerLayout
    this.settings.setHot(lp ? this.settings.hitAt(lp.x, lp.y) : null)
    this.settings.draw({
      autoTarget: this.sim.autoTarget,
      puzzle: this.sim.isPuzzle,
      volume: this.sfx.settings.volume,
      muted: this.sfx.settings.muted,
      audio: this.sfx.available,
      perf: perf.shown,
    })
    setRingScale(this.wc.cssPerWorld())
    for (const cannon of this.cannons) {
      cannon.hovered = cannon === this.hover
      cannon.selected = cannon === this.selected
      cannon.manualBadge = cannon.side === 'player' && !this.sim.isPuzzle && !this.sim.autoTargets(cannon)
      cannon.draw(time)
    }
    this.drawCountdown(delta)
    this.refreshHud()
  }

  /**
   * The 3-2-1-Go overlay, centred on the board: a dark disc with a gold ring
   * that runs down each second, the number popping in, then "Go!". A tick
   * plays on each number and a brighter pop on Go. It follows the round's
   * countdown (the host's or server's on a network view), so a pause holds it.
   * On a small screen it is drawn bigger, so the number stays about 48 CSS px.
   */
  private drawCountdown(delta: number): void {
    const g = this.countdownFx
    g.clear()
    const cd = this.ended ? 0 : this.sim.countdown
    let label = ''
    let t = 0
    if (cd > 0) {
      const n = Math.max(1, Math.ceil(cd / 1000 - 1e-6))
      if (n !== this.countShown) {
        this.sfx.cue('tick')
        this.countShown = n
      }
      label = String(n)
      t = Math.min(1, Math.max(0, (n * 1000 - cd) / 1000))
    } else {
      if (this.countShown > 0 && !this.ended) {
        this.goLeft = GO_MS
        this.sfx.cue('go')
      }
      this.countShown = 0
      if (this.goLeft > 0) {
        this.goLeft -= delta
        label = 'Go!'
        t = 1 - Math.max(0, this.goLeft) / GO_MS
      }
    }
    const show = label !== '' && !this.battleMenu?.open
    this.countdownNum.setVisible(show)
    this.countdownHint.setVisible(show && cd > 0)
    if (!show) return
    const go = cd <= 0
    const cssPerLayout = this.uiCam.zoom / (this.scale.displayScale.x || 1)
    const k = Math.min(2, Math.max(1, 48 / (112 * cssPerLayout)))
    const cx = GAME_WIDTH / 2
    const cy = WORLD_VIEW.y + WORLD_VIEW.h / 2
    const ease = (x: number) => 1 - (1 - x) * (1 - x)
    const pop = go ? 1 + 0.25 * ease(t) : 1 + 0.28 * (1 - ease(Math.min(1, t / 0.22)))
    const alpha = go ? (t < 0.45 ? 1 : 1 - ((t - 0.45) / 0.55) ** 2) : t > 0.85 ? 1 - ((t - 0.85) / 0.15) * 0.5 : 1
    const r = 84 * k * (go ? pop : 1)
    g.fillStyle(theme.hud, 0.86 * alpha)
    g.fillCircle(cx, cy, r)
    g.lineStyle(5 * k, theme.boardEdge, alpha)
    g.strokeCircle(cx, cy, r)
    if (!go) {
      // The ring runs down with the second.
      g.lineStyle(5 * k, theme.player, alpha)
      g.beginPath()
      g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (1 - t) * Math.PI * 2, false)
      g.strokePath()
    } else {
      g.lineStyle(5 * k, theme.player, alpha)
      g.strokeCircle(cx, cy, r)
    }
    this.countdownNum
      .setText(label)
      .setFontSize(go ? 76 : 112)
      .setPosition(cx, cy + 2 * k)
      .setScale(k * pop)
      .setAlpha(alpha)
    if (cd > 0) {
      const kh = Math.min(2.4, Math.max(1, 12 / (16 * cssPerLayout)))
      const spectate = this.online !== null && this.me === null
      if (this.countNoteLeft > 0) this.countNoteLeft -= delta
      let text = 'Aim and pick types now: firing starts at Go'
      if (this.countNoteLeft > 0) text = 'No pausing during the countdown: give your orders now'
      else if (spectate) text = 'The match starts at Go'
      else if (this.sim.isPuzzle) text = 'Plan your aims: firing starts at Go'
      this.countdownHint
        .setText(text)
        .setPosition(cx, cy + r + 14 * kh + 10)
        .setScale(kh)
        .setAlpha(alpha)
    }
  }

  private recordPerf(simMs: number): void {
    let look = 0
    for (const ai of this.sim.ais) look += ai.lookahead.pumpMs
    const lookMs = this.lookBase === null ? 0 : Math.max(0, look - this.lookBase)
    this.lookBase = look
    perf.recordBattle(simMs, this.sim.aiMs, lookMs)
    this.sim.aiMs = 0
  }

  private finish(): void {
    this.shownEnd = true
    this.selected = null
    this.hover = null
    this.hideBanner()
    this.showEnd(this.sim.ended!)
  }

  private playerAim(cannon: Cannon, aim: Cannon | Point): boolean {
    return this.order({ t: 'aim', cannon: cannon.id, at: aim instanceof Cannon ? { cannon: aim.id } : { x: aim.x, y: aim.y } }).ok
  }

  /**
   * Every order from this screen (clicks, keys, menus) goes through here: to
   * the round itself, or to the host when this is the second player. The other
   * player's orders reach the host's round through the same applyOrder.
   */
  private order(o: Order): OrderResult {
    if (!this.client) return applyOrder(this.sim, 'player', o)
    if (this.client.lost || this.sim.ended) return { ok: false }
    if (this.online) {
      const why = this.me === null ? 'You are watching this match.' : this.online.status !== 'open' ? 'Reconnecting…' : null
      if (why) {
        this.popupAtTop(why)
        return { ok: false }
      }
      if (o.t === 'pause' || o.t === 'resume') {
        const check = pauseCheck(o.t, this.client.latest?.x, this.me, this.sim.paused, this.online.info)
        if (!check.ok) {
          if (check.why) this.popupAtTop(check.why)
          return { ok: false }
        }
      }
    }
    // Check it against the picture first (the host checks again), and show it straight away.
    const res = this.predict(o)
    if (res.ok) this.client.send(o)
    return res
  }

  /** Second player: would the host take this order, judging by the latest picture? Shows its effect early where that's cheap. */
  private predict(o: Order): OrderResult {
    const sim = this.sim
    const mine = (id: string) => {
      const c = sim.byId(id)
      return c && c.side === 'player' ? c : null
    }
    switch (o.t) {
      case 'aim': {
        const c = mine(o.cannon)
        if (!c || c.damaged || ('cannon' in o.at && (!sim.byId(o.at.cannon) || o.at.cannon === o.cannon))) return { ok: false }
        const at = 'cannon' in o.at ? sim.byId(o.at.cannon)! : o.at
        this.simEvents.aimed?.({ x: at.x, y: at.y })
        return { ok: true }
      }
      case 'swap': {
        const c = mine(o.cannon)
        return { ok: !!c && (o.kind !== c.kind || sim.queuedKind(c) !== null) }
      }
      case 'auto': {
        const c = mine(o.cannon)
        if (!c || sim.isPuzzle) return { ok: false }
        c.autoTarget = !c.autoTarget
        return { ok: true, on: c.autoTarget }
      }
      case 'autoAll':
        sim.autoTarget = o.on
        return { ok: true, on: o.on }
      case 'pause':
        return { ok: !sim.paused }
      case 'resume':
        return { ok: sim.paused }
    }
  }

  /**
   * What each side wears (in this view's sides: 'player' is you). Against the
   * AI (and in puzzles, playtests): your pick, and the contrasting one for pink.
   * Two players: the host's/server's decision, flipped when this view is.
   */
  private roundSkins(pvp: PvpData | null): SideSkins {
    const mine = loadSkin()
    if (!pvp) return vsAiSkins(mine)
    if (pvp.role === 'host') return this.host!.skins
    const s = pvp.start.skins
    if (pvp.role === 'client') return s ? flipSkins(s) : vsAiSkins(mine)
    // Online: a watcher sees the server's sides as they are. An older server sends no skins: guess.
    if (!s) return vsAiSkins(pvp.start.spectate ? DEFAULT_SKIN : mine)
    return pvp.start.side === 'enemy' ? flipSkins(s) : s
  }

  /** Player vs player: hook this screen up to the other player. */
  private startPvp(pvp: PvpData): void {
    if (this.host) {
      const host = this.host
      this.sim.makePvp()
      host.onPeer = (joined) => {
        this.peerHere = joined
        // The joiner's skin arrives with them.
        this.sim.setSkins(host.skins)
        this.pvpBanner()
      }
      host.onRestart = () => this.restart()
      host.attach(this.sim)
      this.peerHere = host.joined
    } else if (pvp.role === 'client' || pvp.role === 'online') {
      this.sim.makePvp()
      const online = pvp.role === 'online'
      const client = new PvpClient(pvp.transport, pvp.start, online ? pvp.start.side === 'enemy' : true, !online)
      this.client = client
      this.peerHere = true
      client.onStart = (start) => {
        // The host started a new round.
        this.restarting = true
        this.scene.restart({ from: this.from, pvp: { ...pvp, start }, view: this.viewNow() })
      }
      client.onLost = () => {
        this.peerHere = false
        this.pvpBanner()
      }
      client.onBack = () => {
        this.peerHere = true
        this.pvpBanner()
      }
      client.onRefused = () => this.popupAtTop(online ? 'The server refused that order (the round had moved on).' : 'The host refused that order (the round had moved on).')
      if (pvp.role === 'online') this.bindOnline(pvp.transport, pvp.start)
    }
  }

  /** Online: follow the room (players coming and going, rematch votes, the connection). */
  private bindOnline(room: OnlineRoom, start: OnlineStart): void {
    this.online = room
    this.me = start.spectate ? null : sideIndex(start.side)
    room.entered = start.match
    const off = room.onChange(() => this.onRoomChange())
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, off)
    this.onRoomChange()
  }

  private onRoomChange(): void {
    const room = this.online
    if (!room || this.restarting) return
    const info = room.info
    if (info?.phase === 'playing') this.sawPlaying = true
    else if (this.sawPlaying && !this.sim.ended) {
      // The room says the match is over but no final picture came: give it a moment, then call it interrupted.
      this.sawPlaying = false
      this.time.delayedCall(2500, () => {
        if (this.restarting || this.sim.ended || this.client?.latest?.winner != null || room.info?.phase === 'playing') return
        this.showBanner('The match was interrupted (the server restarted). Back to the room…')
        this.time.delayedCall(3000, () => this.go(LOBBY))
      })
    }
    if (room.closed && !this.sim.ended) this.showBanner(room.error?.msg ?? 'Disconnected from the room.')
    if (this.shownEnd) this.showEnd(this.sim.ended!)
  }

  private voteRematch(): void {
    const info = this.online?.info
    if (!info || info.you.seat === null) return
    this.online!.send({ t: 'rematch', on: !info.rematch[info.you.seat] })
  }

  /** The player vs player status line along the bottom. */
  private pvpBanner(): void {
    if (!this.pvp || this.shownEnd) return
    if (this.online) {
      const info = this.online.info
      const mins = clock(PVP_RULES.matchMs)
      this.showBanner(
        this.me === null
          ? `Watching room ${this.online.code}: ${nameOnSide(info, 0)} (gold) vs ${nameOnSide(info, 1)} (pink).`
          : `Online · room ${this.online.code} · you are gold${this.me === 1 ? ' here (pink on the other screen)' : ''}. Take every cannon, or hold the most when the ${mins} clock runs out.`,
      )
      return
    }
    const you = this.pvp.role === 'host' ? 'gold' : PVP.seeSelfAsGold ? 'pink (shown as gold)' : 'pink'
    const msg = this.host
      ? this.peerHere
        ? `PvP test · room ${this.pvp.room} · you are ${you} · player 2 is here: go!`
        : `PvP test · room ${this.pvp.room} · you are ${you} · waiting for player 2 to join…`
      : this.peerHere
        ? `PvP test · room ${this.pvp.room} · you are ${you}`
        : `PvP test · room ${this.pvp.room} · the host has left (or stopped answering)`
    if (this.banner) {
      const b = this.banner
      this.banner = null
      b.destroy()
    }
    this.showBanner(msg)
  }

  private popupAtTop(text: string): void {
    const p = this.wc.toWorld(GAME_WIDTH / 2, WORLD_VIEW.y + 40)
    this.popup(p.x, p.y, text, theme.textMuted)
  }

  private viewNow(): MapView {
    return { zoom: this.wc.zoom, x: this.wc.center.x, y: this.wc.center.y }
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
    keyboard.off('keydown-M', this.onAutoKey, this)
    keyboard.off('keydown-SPACE', this.onSpaceKey, this)
    keyboard.off(`keydown-${EDITOR_KEY}`, this.onEditorKey, this)
    keyboard.on(`keydown-${EDITOR_KEY}`, this.onEditorKey, this)
    keyboard.on('keydown-SPACE', this.onSpaceKey, this)
    // Space never scrolls the page or presses a focused button.
    keyboard.addCapture('SPACE')
    keyboard.on('keydown-T', this.onTypeKey, this)
    keyboard.on('keydown-M', this.onAutoKey, this)
    keyboard.off('keydown-N', this.onMuteKey, this)
    keyboard.on('keydown-N', this.onMuteKey, this)
    keyboard.on('keydown-R', this.onRestartKey, this)
    keyboard.on('keydown-ESC', this.onCancelKey, this)
    keyboard.on('keydown-N', this.onNextKey, this)
  }

  private onRestartKey(): void {
    this.restart()
  }

  /** M: flip auto-target for the cannon under the pointer (or the selected one). */
  private onMuteKey(): void {
    // After a win, N is "next level" instead.
    if (this.ended === 'win' && this.nextLevel()) return
    this.sfx.toggleMute()
  }

  private onAutoKey(): void {
    const c = this.hover && this.hover.side === 'player' ? this.hover : this.selected
    if (c) this.toggleCannonAuto(c)
  }

  /** The auto-target pill's state for one of your cannons (null in puzzles: it isn't shown). */
  private autoState(c: Cannon): AutoState {
    if (this.sim.isPuzzle) return null
    if (!this.sim.autoTarget) return 'all-off'
    return c.autoTarget ? 'on' : 'off'
  }

  private toggleCannonAuto(c: Cannon): void {
    if (this.ended || this.sim.isPuzzle) return
    const res = this.order({ t: 'auto', cannon: c.id })
    if (!res.ok) return
    const on = !!res.on
    const note = !this.sim.autoTarget ? (on ? 'Auto on (when Settings is on)' : 'Auto off') : on ? 'Auto-target on' : 'Manual: auto-target off'
    this.popup(c.x, c.y - 30, note, on ? cssHex(theme.player) : theme.textMuted)
  }

  private toggleGlobalAuto(): void {
    if (this.sim.isPuzzle || this.ended) return
    this.order({ t: 'autoAll', on: !this.sim.autoTarget })
  }

  /** Esc: close what is open (Settings, the type menu, a selection), else open the menu. */
  private onCancelKey(): void {
    if (this.settings.open) this.settings.hide()
    else if (this.swapMenu.open) this.swapMenu.hide()
    else if (this.selected) this.selected = null
    else this.openMenu()
  }

  /** T: swap the selected cannon to the next tower type. */
  private onSpaceKey(): void {
    this.togglePause()
  }

  /** Tactical pause on/off (Space, or the HUD's Pause / Resume). */
  togglePause(): void {
    if (this.ended || this.restarting || this.battleMenu?.open) return
    if (this.pvp && this.sim.countdown > 0) {
      // Shown in place of the countdown's hint line, where the player is already looking.
      this.countNoteLeft = 1600
      return
    }
    this.order({ t: this.sim.paused ? 'resume' : 'pause' })
    this.pauseLink?.setText(this.sim.paused ? 'Resume' : 'Pause').setFontStyle(this.sim.paused ? 'bold' : 'normal')
  }

  private onLoseFocus(): void {
    // Player vs player: the other player is still playing.
    if (this.pvp) return
    if (!this.sim.paused && !this.ended && !this.restarting) this.togglePause()
  }

  private onTypeKey(): void {
    const sel = this.selected
    if (!sel || this.ended) return
    this.order({ t: 'swap', cannon: sel.id, kind: nextKind(this.sim.queuedKind(sel) ?? sel.kind) })
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

  /** E: back to the editor from a playtest (never while typing in a text field, or with Ctrl/Cmd/Alt). */
  private onEditorKey(event?: KeyboardEvent): void {
    const route = editorReturn(this.ctx)
    if (!route || this.restarting) return
    if (event && (event.ctrlKey || event.metaKey || event.altKey)) return
    if (typeof document !== 'undefined' && isTypingTarget(document.activeElement as HTMLElement | null)) return
    this.go(route)
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
    // The Settings panel, then the type menu, sit above the board: a press on them never reaches it.
    if (this.settings?.open) {
      const hit = this.settings.hitAt(lp.x, lp.y)
      if (hit) {
        this.pressOnUi = true
        if (hit === 'auto') this.toggleGlobalAuto()
        else if (hit === 'mute') this.sfx.toggleMute()
        else if (hit === 'perf') perf.toggle()
        else if (hit === 'volume') {
          this.volumeDrag = true
          this.sfx.setVolume(this.settings.volumeAt(lp.x))
        } else if (hit === 'close') this.settings.hide()
        return
      }
      // A press elsewhere (but not on the HUD's Settings link) closes it, and does nothing else.
      if (!(over && over.length > 0)) {
        this.settings.hide()
        this.pressOnUi = true
        return
      }
    }
    if (this.swapMenu.open && this.swapMenu.contains(lp.x, lp.y)) {
      this.pressOnUi = true
      const kind = this.swapMenu.pillAt(lp.x, lp.y)
      const cannon = this.swapMenu.cannon
      if (kind === 'auto') {
        if (cannon) this.toggleCannonAuto(cannon)
      } else if (kind && cannon) {
        this.order({ t: 'swap', cannon: cannon.id, kind })
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
    this.volumeDrag = false
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
    if (this.volumeDrag) {
      if (pointer.isDown && this.settings.open) {
        this.sfx.setVolume(this.settings.volumeAt(this.pointerLayout.x))
        return
      }
      this.volumeDrag = false
    }
    if (this.settings.open && this.settings.contains(this.pointerLayout.x, this.pointerLayout.y)) {
      const hit = this.settings.hitAt(this.pointerLayout.x, this.pointerLayout.y)
      this.input.setDefaultCursor(hit === 'auto' || hit === 'close' || hit === 'mute' || hit === 'volume' || hit === 'perf' ? 'pointer' : 'default')
      this.hover = null
      this.pointer = null
      return
    }
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
    if (this.from === 'puzzles') return nextPuzzle(this.level.id)
    return CAMPAIGN[this.levelIndex + 1] ?? null
  }

  private restart(): void {
    if (this.restarting) return
    if (this.online) {
      // Online there is no restart: after a match, R (or the button) votes for a rematch.
      if (this.ended) this.voteRematch()
      return
    }
    if (this.client) {
      // The host starts the new round; it arrives as a "start" (see startPvp).
      this.client.requestRestart()
      return
    }
    this.restarting = true
    this.input.setDefaultCursor('default')
    // Restarting keeps the camera where you left it.
    const view = this.viewNow()
    // A host's restart keeps the player who is here (the new round goes straight to them).
    const pvp = this.pvp?.role === 'host' ? { ...this.pvp, peer: this.host?.peerId ?? undefined } : (this.pvp ?? undefined)
    this.scene.restart(this.custom ? { custom: this.custom, from: this.from, view, pvp } : { levelId: this.level.id, from: this.from, view, pvp })
  }

  private goNext(): void {
    const next = this.nextLevel()
    if (!next || this.restarting) return
    this.restarting = true
    this.scene.start('battle', { levelId: next.id, from: this.from })
  }

  private get ctx(): BattleCtx {
    return { levelId: this.level.id, levelIndex: this.levelIndex, custom: !!this.custom, from: this.from }
  }

  private backLabel(short: boolean): string {
    return routeBackLabel(this.ctx, short)
  }

  private goBack(): void {
    this.go(backRoute(this.ctx))
  }

  private go(route: Route): void {
    if (this.restarting) return
    this.restarting = true
    this.closeMenu()
    this.input.setDefaultCursor('default')
    if (this.pvp?.role === 'online') {
      // Back to the lobby keeps the room; anywhere else leaves it (an AI takes the seat mid-match).
      this.client?.close(false)
      if (!(route.scene === 'title' && route.data?.screen === 'lobby')) this.pvp.transport.leave()
    } else if (this.pvp) {
      // Leaving player vs player: tell the other player, then hang up.
      this.host?.close(true)
      this.client?.close(true)
      this.pvp.transport.close()
    }
    this.scene.start(route.scene, route.data)
  }

  /** Open the in-battle menu, pausing the round while it is open. */
  openMenu(): void {
    if (this.restarting || this.battleMenu.open) return
    this.settings.hide()
    this.swapMenu.hide()
    this.selected = null
    this.menuHold.hold()
    // Keys go to the menu while it is open (Esc, R, arrows).
    if (this.input.keyboard) this.input.keyboard.enabled = false
    if (this.online) return this.openOnlineMenu()
    const route = backRoute(this.ctx)
    const items = [
      { id: 'resume', label: this.ended ? 'Back to the board' : 'Resume', run: () => this.closeMenu(), primary: true, icon: ICONS.play },
      { id: 'restart', label: 'Restart', run: () => (this.closeMenu(), this.restart()) },
    ]
    if (route.scene !== 'title' || route.data?.screen) items.push({ id: 'back', label: this.backLabel(false), run: () => this.go(route) })
    items.push({ id: 'main', label: 'Main menu', run: () => this.go(MAIN_MENU) })
    const where = this.levelIndex >= 0 ? `${this.levelIndex + 1}. ${this.level.name}` : this.level.name
    const paused = this.sim.paused
    this.battleMenu.show(paused ? 'Paused' : 'Menu', paused ? `${where}  ·  paused while this menu is open` : where, items)
  }

  private openOnlineMenu(): void {
    const items: { id: string; label: string; run: () => void; primary?: boolean; icon?: string }[] = [
      { id: 'resume', label: this.ended ? 'Back to the board' : 'Back to the match', run: () => this.closeMenu(), primary: true, icon: ICONS.play },
    ]
    if (this.ended && this.me !== null) items.push({ id: 'rematch', label: 'Rematch', run: () => (this.closeMenu(), this.voteRematch()) })
    if (this.ended || this.me === null) items.push({ id: 'lobby', label: 'Back to the room', run: () => this.go(LOBBY) })
    items.push({ id: 'leave', label: this.ended || this.me === null ? 'Leave the room' : 'Leave the match (an AI takes your side)', run: () => this.go(MAIN_MENU) })
    this.battleMenu.show('Menu', `Room ${this.online!.code}  ·  ${this.level.name}  ·  the match keeps going while this is open`, items)
  }

  closeMenu(): void {
    if (!this.battleMenu?.open) return
    this.battleMenu.hide()
    this.menuHold.release()
    this.pauseLink?.setText(this.sim.paused ? 'Resume' : 'Pause').setFontStyle(this.sim.paused ? 'bold' : 'normal')
    // Turn keys back on after this frame, so the Esc that closed the menu doesn't reopen it.
    this.events.once(Phaser.Scenes.Events.POST_UPDATE, () => {
      if (this.input.keyboard) this.input.keyboard.enabled = true
    })
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
    const title = this.online
      ? `Online  ·  ${this.level.name}  ·  room ${this.online.code}`
      : this.pvp
      ? `PvP test  ·  ${this.level.name}  ·  ${this.host ? 'host' : 'player 2'}`
      : this.levelIndex >= 0
        ? `${this.levelIndex + 1}. ${this.level.name}${this.isPuzzle ? '  ·  Puzzle' : ''}`
        : this.custom
          ? this.from === 'editor'
            ? `${this.level.name}  ·  ${this.isPuzzle ? 'Puzzle playtest' : 'Playtest'}`
            : `${this.level.name}  ·  ${this.isPuzzle ? 'Puzzle' : 'Battle'}`
          : `${BRAND.title}  ·  ${this.level.name}`
    // Playtest: "← Editor (E)" first in the bar, always on top (paused, result screen); the title moves over for it.
    const toEditor = editorReturn(this.ctx)
    let left = 24
    if (toEditor) {
      const w = 124
      this.editorButton = makeButton(this, 14 + w / 2, HUD_H / 2, `← Editor (${EDITOR_KEY})`, () => this.go(toEditor), { width: w, height: 34, primary: false, fontSize: 14 })
        .setDepth(25)
        .setName('editor-back')
      left = 14 + w + 14
    }
    const titleText = this.add
      .text(left, 8, title, {
        fontFamily: theme.font,
        fontSize: '18px',
        fontStyle: 'bold',
        color: theme.text,
      })
      .setDepth(10)
    // Never run into the cannon counts (long map names get an ellipsis).
    const maxTitle = 504 - 28 - left
    if (titleText.width > maxTitle) {
      let name = this.level.name
      while (name.length > 1 && titleText.width > maxTitle) {
        name = name.slice(0, -1)
        titleText.setText(title.replace(this.level.name, name.trimEnd() + '…'))
      }
    }

    this.hint = this.add
      .text(left, 32, '', { fontFamily: theme.font, fontSize: '13px', color: theme.textMuted })
      .setDepth(10)

    const legend = this.add.graphics().setDepth(10)
    const groups: { side: Side; x: number; label: string }[] = [
      { side: 'player', x: 504, label: this.online && this.me === null ? 'Gold' : 'You' },
      { side: 'neutral', x: 616, label: 'Neutral' },
    ]
    if (!this.isPuzzle) groups.push({ side: 'enemy', x: 756, label: this.online ? (this.me === null ? 'Pink' : 'Them') : 'Enemy' })
    const counts: Partial<Record<Side, Phaser.GameObjects.Text>> = {}
    this.counts = counts
    for (const group of groups) {
      legend.fillStyle(sideColor(group.side), 1)
      legend.fillCircle(group.x, HUD_ROW, 6)
      const ring = ownerRing(group.side)
      if (ring !== null) {
        // The same ownership ring the cannons wear.
        legend.lineStyle(4.5, theme.ringEdge, 0.85)
        legend.strokeCircle(group.x, HUD_ROW, 8)
        legend.lineStyle(2.5, ring, 1)
        legend.strokeCircle(group.x, HUD_ROW, 8)
      }
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
        .text(756, HUD_ROW, '', { fontFamily: theme.font, fontSize: '15px', fontStyle: 'bold', color: theme.text })
        .setOrigin(0, 0.5)
        .setDepth(10)
    }

    const link = (x: number, label: string, onClick: () => void): Phaser.GameObjects.Text => {
      const text = this.add
        .text(x, HUD_ROW, label, { fontFamily: theme.font, fontSize: '14px', color: theme.textMuted })
        .setOrigin(1, 0.5)
        .setDepth(10)
        .setInteractive({ useHandCursor: true })
      text.on('pointerover', () => text.setColor(theme.text))
      text.on('pointerout', () => text.setColor(theme.textMuted))
      text.on('pointerdown', onClick)
      return text
    }
    if (this.online) {
      // Online: the match clock where Restart was, pauses left and ping under it.
      this.clockText = this.add
        .text(GAME_WIDTH - 28, HUD_ROW, clock(PVP_RULES.matchMs), { fontFamily: theme.font, fontSize: '16px', fontStyle: 'bold', color: theme.text })
        .setOrigin(1, 0.5)
        .setDepth(10)
      this.netText = this.add
        .text(GAME_WIDTH - 28, HUD_ROW + 21, '', { fontFamily: theme.font, fontSize: '12px', color: theme.textMuted })
        .setOrigin(1, 0.5)
        .setDepth(10)
    } else link(GAME_WIDTH - 28, 'Restart', () => this.restart())
    link(GAME_WIDTH - 112, 'Menu', () => this.openMenu())
    link(GAME_WIDTH - 196, 'Settings', () => this.settings.toggle())
    this.pauseLink = link(GAME_WIDTH - 276, 'Pause', () => this.togglePause())
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
    if (this.online) this.refreshOnlineHud()
    const hint = this.hintLine()
    if (this.hint.text !== hint) this.hint.setText(hint)
  }

  private refreshOnlineHud(): void {
    const x = this.client?.latest?.x
    const t = performance.now()
    if (x) {
      for (const i of [0, 1] as const) {
        if (x.on[i] || x.ai[i]) this.dropAt[i] = null
        else this.dropAt[i] ??= t
      }
    }
    const time = clock(x ? x.tl : PVP_RULES.matchMs)
    if (this.clockText && this.clockText.text !== time) {
      this.clockText.setText(time)
      this.clockText.setColor(x && x.tl < 30_000 ? cssHex(theme.enemy) : theme.text)
    }
    const net = netLine(x, this.me, this.online!.rttAvg)
    if (this.netText && this.netText.text !== net) this.netText.setText(net)
    if (this.sim.paused) {
      const label = pauseLabel(x, this.me, this.online!.info)
      if (this.pausedLabel.text !== label) this.pausedLabel.setText(label)
    }
  }

  private hintLine(): string {
    if (this.online && !this.ended) {
      const room = this.online
      if (room.closed) return room.error?.msg ?? 'Disconnected from the room.'
      if (room.status !== 'open') return `Connection lost: reconnecting… (after ${PVP_RULES.graceMs / 1000} s an AI plays your side until you are back)`
      if (this.me === null) return `Watching ${nameOnSide(room.info, 0)} (gold) vs ${nameOnSide(room.info, 1)} (pink).`
      const them = (1 - this.me) as 0 | 1
      const line = opponentLine(this.client?.latest?.x, this.me, room.info, this.dropAt[them], performance.now())
      if (line) return line
    }
    if (this.online && this.ended) return endTexts(this.ended, this.me, this.online.info, this.client?.latest?.x?.why, this.tally()).headline
    if (this.pvp && !this.ended) {
      if (this.host && !this.peerHere) return `Waiting for player 2 to join room ${this.pvp.room}…`
      if (this.client && !this.peerHere) return 'The host has left (or stopped answering).'
    }
    if (this.ended) return this.pvp ? (this.ended === 'win' ? 'You win!' : 'You lost.') : this.ended === 'win' ? 'You hold every cannon.' : 'Not this time.'
    if (this.sim.paused) {
      const lp0 = this.pointerLayout
      const pill0 = lp0 && this.swapMenu.open ? this.swapMenu.pillAt(lp0.x, lp0.y) : null
      const c0 = this.swapMenu.cannon
      if (pill0 && pill0 !== 'auto' && c0) {
        if (pill0 === c0.kind) return this.sim.queuedKind(c0) ? `Cancel ${c0.name}'s queued swap (it stays a ${kindLabel(c0.kind)}).` : `${c0.name} is a ${kindLabel(c0.kind)}.`
        return `Queue: ${c0.name} → ${kindLabel(pill0)} when you resume (its reload starts then, not now).`
      }
      if (!pill0 && !this.selected) return 'Paused: select cannons, aim them, swap types. Everything happens at once when you resume (Space).'
      if (!pill0 && this.selected) return `Paused: click where ${this.selected.name} should aim; it happens when you resume (Space).`
    }
    const lp = this.pointerLayout
    const pill = lp && this.swapMenu.open ? this.swapMenu.pillAt(lp.x, lp.y) : null
    if (pill === 'auto') {
      const c = this.swapMenu.cannon!
      if (!this.sim.autoTarget) return `Auto-target is off for all your cannons (Settings). ${c.name}'s own toggle is ${c.autoTarget ? 'on' : 'off'}: click to flip it for when Settings is back on.`
      if (c.autoTarget) return `${c.name} auto-targets: when its target is captured it picks the nearest foe itself. Click (or M) for manual: it keeps your aim and waits for orders.`
      return `${c.name} is on manual: it never picks a target by itself. Click (or M) to turn auto-target back on.`
    }
    if (pill && this.swapMenu.cannon) {
      const c = this.swapMenu.cannon
      if (pill === c.kind) return `${c.name} is a ${kindLabel(c.kind)}: ${KINDS[c.kind].blurb}.`
      return `Swap ${c.name} to ${kindLabel(pill)}: ${KINDS[pill].blurb}. ${KINDS[pill].fires ? 'It reloads before its first shot.' : 'Its barrier comes up after the reload.'}`
    }
    if (!this.selected) {
      if (this.hover && this.hover.side === 'player') return `Click to select ${this.hover.name}, or pick a type above it (long-press on touch).`
      return `Click one of your ${this.client && !PVP.seeSelfAsGold ? 'pink' : 'gold'} cannons to select it, then click where it should aim.`
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
    if (this.online) {
      this.endRoot?.destroy()
      this.endRoot = this.uiBlock(() => this.buildOnlineEnd(result))
      return
    }
    this.uiBlock(() => this.buildEnd(result))
  }

  /** Cannons held: this screen's gold ("mine") and pink. */
  private tally(): { mine: number; theirs: number } {
    let mine = 0
    let theirs = 0
    for (const c of this.cannons) {
      if (c.side === 'player') mine++
      else if (c.side === 'enemy') theirs++
    }
    return { mine, theirs }
  }

  /** Online end screen: drawn again whenever the room changes (rematch votes). */
  private buildOnlineEnd(result: Outcome): Phaser.GameObjects.Container {
    const info = this.online!.info
    const root = this.add.container(0, 0).setDepth(20)
    const dim = this.add.graphics()
    dim.fillStyle(theme.dim, 0.64)
    dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)
    root.add(dim)
    const cx = GAME_WIDTH / 2
    const cy = GAME_HEIGHT / 2 + 10
    const ph = 290
    const top = cy - ph / 2
    const panel = this.add.graphics()
    panel.fillStyle(theme.panel, 0.98)
    panel.fillRoundedRect(cx - 280, top, 560, ph, 18)
    const stroke = result === 'draw' ? theme.neutral : result === 'win' ? theme.player : theme.enemy
    panel.lineStyle(3, stroke, 1)
    panel.strokeRoundedRect(cx - 280, top, 560, ph, 18)
    root.add(panel)
    const { headline, detail } = endTexts(result, this.me, info, this.client?.latest?.x?.why, this.tally())
    const text = (y: number, s: string, size: number, bold = false, color: string = theme.textMuted) =>
      root.add(this.add.text(cx, y, s, { fontFamily: theme.font, fontSize: `${size}px`, fontStyle: bold ? 'bold' : 'normal', color, align: 'center', wordWrap: { width: 520 } }).setOrigin(0.5))
    text(top + 48, headline, 30, true, theme.text)
    text(top + 92, detail, 16)
    const by = top + ph - 70
    if (this.me !== null) {
      text(top + 130, rematchLine(info), 15, true, info && info.you.seat !== null && info.rematch[1 - info.you.seat] ? cssHex(theme.player) : theme.text)
      const mine = !!(info && info.you.seat !== null && info.rematch[info.you.seat])
      const other = info && info.you.seat !== null ? info.seats[1 - info.you.seat] : null
      const rematch = makeButton(this, cx - 125, by, mine ? 'Cancel rematch' : 'Rematch', () => this.voteRematch(), { width: 220, primary: !mine })
      if (!other) rematch.setAlpha(0.4).disableInteractive()
      root.add(rematch)
      root.add(makeButton(this, cx + 125, by, 'Back to the room', () => this.go(LOBBY), { width: 220, primary: false }))
      text(by + 46, 'R for rematch  ·  Esc for the menu  ·  sides swap every match', 13)
    } else {
      root.add(makeButton(this, cx - 125, by, 'Back to the room', () => this.go(LOBBY), { width: 220 }))
      root.add(makeButton(this, cx + 125, by, 'Leave the room', () => this.go(MAIN_MENU), { width: 220, primary: false }))
      text(by + 46, 'You will watch the next match too', 13)
    }
    if (DEBUG.enabled) (window as unknown as { __ccResult?: unknown }).__ccResult = { online: true, result, headline, detail, seconds: Math.round(this.sim.clock / 1000) }
    return root
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
    if (this.pvp) headline = result === 'win' ? 'You win' : 'You lost'
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
    if (this.pvp) detail = result === 'win' ? 'The other player has no cannons left.' : 'You have no cannons left.'
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
      buttons.push(makeButton(this, cx - 112, by, this.from === 'puzzles' ? 'Next puzzle' : 'Next level', () => this.goNext(), { width: 200 }))
      buttons.push(makeButton(this, cx + 112, by, this.backLabel(false), () => this.goBack(), { width: 200, primary: false }))
    } else if (campaign) {
      const primaryLabel = result === 'win' ? this.backLabel(false) : 'Try again'
      const primary = result === 'win' ? () => this.goBack() : () => this.restart()
      const secondaryLabel = result === 'win' ? 'Play again' : this.backLabel(false)
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

  /** Paused: queued orders on the board (ghost aim lines, barrier arcs, pending types). */
  private drawQueued(g: Phaser.GameObjects.Graphics, time: number, walls: Rect[]): void {
    const seen = new Set<Cannon>()
    const pulse = 0.85 + 0.15 * Math.sin(time / 160)
    for (const { cannon: c, aim, kind } of this.sim.queuedOrders()) {
      const fires = firesAs(kind ?? c.kind)
      if (aim) {
        if (fires) {
          const end = clipToWalls(c.x, c.y, aim.x, aim.y, walls)
          const onCannon = aim instanceof Cannon
          const blocked = end.x !== aim.x || end.y !== aim.y
          dash(g, c.x, c.y, end.x, end.y, haloR() + 2, onCannon && !blocked ? haloR() : 4, theme.select, pulse)
          if (onCannon) {
            g.lineStyle(2.5, theme.select, pulse)
            g.strokeCircle(aim.x, aim.y, haloR())
          } else crosshair(g, aim.x, aim.y, 11, theme.select, pulse)
        } else {
          const s = TUNING.shield
          const facing = Math.atan2(aim.y - c.y, aim.x - c.x)
          const half = (s.arcDeg * Math.PI) / 360
          g.lineStyle(6, theme.select, 0.35 + 0.3 * pulse)
          g.beginPath()
          g.arc(c.x, c.y, s.reach, facing - half, facing + half, false)
          g.strokePath()
        }
      }
      if (kind) {
        seen.add(c)
        // A dashed ring: this cannon changes type when you resume.
        const r = TUNING.cannonRadius + 16
        g.lineStyle(2, theme.select, pulse)
        for (let i = 0; i < 16; i += 2) g.beginPath(), g.arc(c.x, c.y, r, (i * Math.PI) / 8 + time / 900, ((i + 1) * Math.PI) / 8 + time / 900, false), g.strokePath()
        let label = this.queuedLabels.get(c)
        if (!label) {
          label = this.world(
            this.add
              .text(0, 0, '', { fontFamily: theme.font, fontSize: '13px', fontStyle: 'bold', color: cssHex(theme.select), stroke: cssHex(theme.hud), strokeThickness: 4 })
              .setOrigin(0.5)
              .setDepth(7),
          )
          this.queuedLabels.set(c, label)
        }
        label.setText(`→ ${kindLabel(kind)}`).setPosition(c.x, c.y + TUNING.cannonRadius + 30).setVisible(true)
      }
    }
    for (const [c, label] of this.queuedLabels) if (!seen.has(c)) label.setVisible(false)
  }

  /** The "Paused" frame and label (UI camera, leaves the board clickable). */
  private drawPaused(time: number): void {
    const g = this.pausedFx
    g.clear()
    const on = this.sim.paused && !this.ended && !this.battleMenu?.open
    this.pausedLabel.setVisible(on)
    if (!on) return
    const v = WORLD_VIEW
    g.lineStyle(3, theme.select, 0.55 + 0.25 * Math.sin(time / 300))
    g.strokeRect(v.x + 2, v.y + 2, v.w - 4, v.h - 4)
    const w = this.pausedLabel.width + 28
    g.fillStyle(theme.select, 0.95)
    g.fillRoundedRect(GAME_WIDTH / 2 - w / 2, HUD_H + 10, w, 28, 14)
  }

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
    if (sel && !this.ended && !firesAs(this.sim.queuedKind(sel) ?? sel.kind)) {
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
        dash(g, sel.x, sel.y, end.x, end.y, haloR() + 2, blocked ? 4 : haloR() + 2, theme.select, 0.9)
        g.lineStyle(2, theme.select, 0.6 + 0.3 * Math.sin(time / 120))
        g.strokeCircle(hover.x, hover.y, haloR())
      } else if (!this.hover && this.pointer) {
        const end = clipToWalls(sel.x, sel.y, this.pointer.x, this.pointer.y, walls)
        dash(g, sel.x, sel.y, end.x, end.y, haloR() + 2, 4, theme.select, 0.55)
        crosshair(g, this.pointer.x, this.pointer.y, 10, theme.select, 0.75)
      }
    }

    if (this.sim.paused) this.drawQueued(g, time, walls)
    else for (const label of this.queuedLabels.values()) label.setVisible(false)

    for (const ping of this.pings) {
      g.lineStyle(2, ping.color, ping.life)
      g.strokeCircle(ping.x, ping.y, 8 + (1 - ping.life) * 22)
    }

    drawShots(g, this.sim.shots)

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
