import { DEFAULT_SKIN, flipSkins, vsAiSkins, type SideSkins } from '../config/skins'
import { DIM, moveToward, spotlightSet } from '../render/targetDim'
import { earnBadge } from '../menu/badges'
import { loadSkin } from '../menu/skinPref'
import Phaser from 'phaser'
import { GAME_HEIGHT, GAME_WIDTH } from '../config/layout'
import { DIFFICULTY, type MapView } from '../editor/maps'
import { applyTeamColours, cssHex, sideColor, theme } from '../config/theme'
import { DEFAULT_COLOUR, flipColours, readColours, TEAM_COLOUR, vsAiColours, type SideColours } from '../config/teamColours'
import { loadColour } from '../menu/colourPref'
import { TUNING } from '../config/tuning'
import { DEBUG } from '../debug'
import { BattleMenu } from '../ui/battleMenu'
import { BattleHud, HUD_STRIP, VIEW_TOP, matchTime, type HudButton } from '../ui/battleHud'
import type { ClientMsg } from '../net/online'
import { ICONS } from '../menu/art'
import { music } from '../audio/music'
import { jukeboxPanel } from '../ui/jukebox'
import { nextPuzzle } from '../menu/menuModel'
import { PauseHold } from '../menu/pauseHold'
import { EDITOR_KEY, MAIN_MENU, backLabel as routeBackLabel, backRoute, editorReturn, type BattleCtx, type BattleFrom, type Route } from '../menu/routes'
import { isTypingTarget } from '../ui/typing'
import { Sfx, preloadSfx } from '../audio/Sfx'
import { Cannon, haloR, setRingScale } from '../entities/Cannon'
import { Fan } from '../entities/Fan'
import { Glass } from '../entities/Glass'
import { BRICK, PORTAL, VOID_COLOURS, portalColour, portalReach } from '../config/obstacles'
import { Portal } from '../entities/Portal'
import { mouthOnSegment, portalExit, portalMouths, type PortalMouth } from '../sim/portals'
import { Pillar } from '../entities/Pillar'
import { Wall } from '../entities/Wall'
import { CAMPAIGN, SKIRMISH, campaignIndex, findLevel } from '../levels'
import { recordWin } from '../progress'
import { boardFor, insideBoard } from '../levels/board'
import { bindSceneResolution } from '../render/resolution'
import { WorldCamera } from '../render/WorldCamera'
import { drawBoardSurface } from '../render/boardSurface'
import { crosshair, dash, drawShots } from '../render/battleMarks'
import { ObstacleAuras } from '../render/vfx/obstacleAuras'
import { Vfx } from '../render/vfx/Vfx'
import { SlowWatch } from '../render/vfx/fxQuality'
import { currentFx, currentFxConfig, fxLabel, noteSlowDevice, onFxChange } from '../render/vfx/fxPrefs'
import { clampPoint } from '../sim/aim'
import { BattleSim, type Outcome } from '../sim/BattleSim'
import { MirrorBot, makeBot, type Bot } from '../sim/bots'
import { clipToGlass, clipToPillars, clipToWalls } from '../sim/geometry'
import { starsFor } from '../sim/stars'
import type { AiLevel, LevelDef, Point, Rect, WallDef } from '../types'
import { makeButton } from '../ui/button'
import { BOTS, botLine, botMoment } from '../ui/bots'
import { ResultPanel } from '../ui/resultPanel'
import { motionOK } from '../ui/motion'
import { badgeName, offlineResult, onlineResult, type ResultAction, type ResultView } from '../ui/resultView'
import { SwapMenu, type AutoState } from '../ui/swapMenu'
import { SettingsPanel } from '../ui/settingsPanel'
import { perf } from '../perf/PerfOverlay'
import type { PerfNet } from '../perf/perfStats'
import { layoutScale } from '../render/resolution'
import { KINDS, firesAs, fmtNum, kindLabel, nextKind } from '../config/kinds'
import { FixedStep, SIM_STEP_MS } from '../sim/fixedStep'
import { applyOrder, type Order, type OrderResult } from '../sim/orders'
import type { SimEvents } from '../sim/BattleSim'
import { PvpClient, PvpHost, flipLevel, type StartMsg } from '../net/pvp'
import { randomId, type Transport } from '../net/transport'
import type { OnlineRoom, OnlineStart } from '../net/onlineClient'
import { looksClash } from '../config/looks'
import { NameTags } from '../render/nameTags'
import { GLOW, SideGlow, glowColours, glowEdges } from '../render/sideGlow'
import { cannonsFromResult, clock, endTexts, nameOnSide, outcomeFromResult, tagNames, netParts, opponentLine, pauseCheck, pauseLabel, rematchLine, sideIndex } from '../net/onlineView'
import { CatchUp } from '../sim/catchUp'
import { ResultGate } from './resultGate'
import { loadTabPrefs, saveTabPrefs, type TabPrefs } from '../menu/tabPrefs'
import { debugNow } from '../perf/debugNow'
import type { Side } from '../types'
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

/** Slim HUD band on top (same info as before, less height). */
const HUD_H = 54
/** Catch-up time per frame after a hidden tab (ms of work, not game time). */
const CATCH_UP_FRAME_MS = 12
/** How long "Go!" shows after the countdown (ms). */
const GO_MS = 850
/**
 * The world viewport: everything under the HUD band and the cannon strip.
 * Its top moves down when the bar and strip reach further (small phones),
 * so they never cover the board; see fitViewUnderBar.
 */
const WORLD_VIEW = { x: 0, y: VIEW_TOP, w: GAME_WIDTH, h: GAME_HEIGHT - VIEW_TOP }
/** Hold a press this long on one of your cannons to open its type menu (touch). */
const LONG_PRESS_MS = 450
/** How-to hints show for this long after Go (until your first aim, if that's sooner). */
const GUIDE_MS = 10_000

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
  private bot: Bot | null = null
  private walls: Wall[] = []
  private fans: Fan[] = []
  private pillars: Pillar[] = []
  private glass: Glass[] = []
  private portals: Portal[] = []
  private obAuras: ObstacleAuras | null = null
  /** Portal mouths for aim previews (see sim/portals). */
  private mouths: PortalMouth[] = []
  private sparks: Spark[] = []
  /** Gameplay effects (auras, flashes, trails, bursts): render/vfx/Vfx.ts. */
  private vfx: Vfx | null = null
  private endFxDone = false
  private lastFrameAt = 0
  /** Automatic Effects quality: drops to Low if battles keep running slowly at High. */
  private readonly slowWatch = new SlowWatch()
  private heals = new Map<Cannon, HealTally>()
  private pings: Ping[] = []
  /** Last pointer position on the board, for the aim preview (null off-board or on touch). */
  private pointer: Point | null = null
  private fx!: Phaser.GameObjects.Graphics
  /** Target mode: the dim over the board, and the aim lines drawn above it. */
  private dimFx!: Phaser.GameObjects.Graphics
  private fxTop!: Phaser.GameObjects.Graphics
  /** How dim the board is now (0..1), easing toward 1 while a cannon is selected. */
  private dimLevel = 0
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
  /** The colours each side wears in this view. */
  private colours: SideColours = vsAiColours(DEFAULT_COLOUR)
  /** What each side wears this round (this view's sides). */
  private skinsNow: SideSkins = vsAiSkins(DEFAULT_SKIN)
  /** Owners' names on the cannons, when two players' looks clash (null: not a two-player round). */
  private tags: NameTags | null = null
  /** Each team's side of the board, washed in its colour. */
  private glow: SideGlow | null = null
  /** The top bar (HTML over the canvas: buttons, the tug-of-war cannon bar, the online clock). */
  hud: BattleHud | null = null
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
  /** Online: the room has said "playing" for this match at least once (its later result is this match's). */
  private playingSeen = false
  /** Online: the outcome from the room's saved result, when no final snapshot came (see onRoomChange). */
  private roomOutcome: Outcome | null = null
  /** Online: the side this screen plays (or gold, watching), in the server's terms. */
  private serverSide: Side = 'player'
  /** The result panel (vs AI and online), null until the round ends. */
  private endRoot: ResultPanel | null = null
  /** This round's result panel has played its entrance (rebuilds just appear). */
  private endAnimated = false
  /** What the bot said about this round (kept for rebuilds). */
  private endLine: string | null = null
  /** This round's win earned a new badge (vs the AI): its name, for the result panel. */
  private endBadge: string | null = null
  /** Stars for a campaign win, worked out once when the round ends. */
  private endStars = 0
  /** Makes sure the result panel is up whenever the round is over (see resultGate.ts). */
  private resultGate!: ResultGate
  /** Settings → When tabbed out (read when the round starts). */
  private tabPrefs: TabPrefs = { pauseVsAi: true }
  /** "Pause vs AI when tabbed out" off: missed time to play back, silently. */
  private readonly catchUp = new CatchUp()
  /** performance.now() when the tab went away (null: here), and up to when the missed time is counted. */
  private awayAt: number | null = null
  private creditedAt = 0
  /** Catching up: no sounds, sparks or popups (the board just shows where things got to). */
  private quiet = false
  /** Show "Caught up" once the time away has been played back. */
  private caughtUpNote = false
  private watchdog = 0
  /** The online clock's shown second (-1: not yet) and when the ping line is next rebuilt (it changes slowly). */
  private clockShown = -1
  private netAt = 0
  /** When each side's player dropped (for the AI countdown). */
  private dropAt: [number | null, number | null] = [null, null]
  /** The hint pill under the top bar (start of a round, the type menu, connection news). */
  private hint!: Phaser.GameObjects.Text
  private hintBg!: Phaser.GameObjects.Graphics
  private hintBox!: Phaser.GameObjects.Container
  private hintK = 0
  /** When the hint text is next worked out again, and what it depended on (it only changes with these). */
  private hintAt = 0
  private hintKey: [Cannon | null, Cannon | null, string | null, boolean] = [null, null, null, false]
  /** The aims-left count on the bar (-1: not yet shown). */
  private aimsShown = -1
  /** This kind of round has a Surrender button (worked out once in createHud: it doesn't change). */
  private surrenderHere = false
  /** You aimed this round: the how-to hints stop. */
  private aimedOnce = false
  /** You surrendered this round (vs the AI: the result screen says so). */
  private surrendered = false
  /** Online: the host turned pauses off for this match (no Pause button, Space does nothing). */
  private pausesOff = false
  /** Paused: a frame round the board and a label at its top (UI camera; never blocks the board). */
  private pausedFx!: Phaser.GameObjects.Graphics
  private pausedLabel!: Phaser.GameObjects.Text
  /** Paused: "→ Sniper" over cannons with a queued type swap (board layer). */
  private queuedLabels = new Map<Cannon, Phaser.GameObjects.Text>()
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
    this.pillars = []
    this.glass = []
    this.portals = []
    this.fans = []
    this.sparks = []
    this.vfx = null
    this.endFxDone = false
    this.lastFrameAt = 0
    this.slowWatch.reset()
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
    this.hud = null
    this.hintK = 0
    this.hintAt = 0
    this.hintKey = [null, null, null, false]
    this.aimedOnce = false
    this.surrendered = false
    this.aimsShown = -1
    this.surrenderHere = false
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
    this.dimFx = this.add.graphics().setDepth(DIM.depth)
    this.fxTop = this.add.graphics().setDepth(DIM.depth + 0.2)
    this.dimLevel = 0
    this.level.walls.forEach((rect) => this.walls.push(new Wall(this, rect)))
    this.level.pillars?.forEach((def) => this.pillars.push(new Pillar(this, def)))
    this.level.glass?.forEach((def) => this.glass.push(new Glass(this, def)))
    this.mouths = portalMouths(this.level.portals)
    this.mouths.forEach((m, i) => this.portals.push(new Portal(this, m, m.pair, i % 2 ? 'b' : 'a')))
    this.level.fans.forEach((def) => this.fans.push(new Fan(this, def)))

    this.sfx = new Sfx(this, () => ({ rect: this.wc.visibleRect(), zoom: this.wc.zoom }))
    this.host = null
    this.client = null
    this.peerHere = false
    this.online = null
    this.me = null
    this.sawPlaying = false
    this.playingSeen = false
    this.roomOutcome = null
    this.serverSide = 'player'
    this.endRoot = null
    this.endAnimated = false
    this.endLine = null
    this.endBadge = null
    this.endStars = 0
    this.tabPrefs = loadTabPrefs()
    this.catchUp.clear()
    this.awayAt = null
    this.caughtUpNote = false
    this.quiet = false
    this.resultGate = new ResultGate(
      () => this.buildResult(),
      () => !!this.endRoot && this.endRoot.isUp(),
    )
    this.clockShown = -1
    this.netAt = 0
    this.tags = null
    this.glow = null
    this.pausesOff = false
    this.dropAt = [null, null]
    this.steps.reset()
    const pvp = this.pvp
    let events: SimEvents = {
      fired: (cannon) => {
        this.sfx.shot(cannon)
        this.vfx?.fired(cannon)
      },
      // Effects off: the plain sparks; otherwise the effects' own.
      bounce: (x, y, surface) => (this.plainSparks ? this.sparks.push({ x, y, life: 1, color: theme.spark }) : this.vfx?.bounce(x, y, surface)),
      absorbed: (x, y) => (this.plainSparks ? this.sparks.push({ x, y, life: 1, color: VOID_COLOURS.spark }) : this.vfx?.absorbed(x, y)),
      hit: (x, y, side, kind) =>
        this.plainSparks ? this.sparks.push({ x, y, life: 1, color: sideColor(side), size: kind === 'machinegun' ? 0.45 : 1 }) : this.vfx?.hit(x, y, side, kind),
      blocked: (x, y, shield, _side, kind) => {
        if (!this.plainSparks) return this.vfx?.blocked(x, y, shield, kind)
        this.sparks.push({ x, y, life: 1, color: sideColor(shield.side), size: kind === 'machinegun' ? 0.5 : 1.1 })
        this.sparks.push({ x, y, life: 0.7, color: 0xffffff, size: kind === 'machinegun' ? 0.3 : 0.6 })
      },
      shieldBroken: (shield) => {
        this.popup(shield.x, shield.y - 8, 'Shield down', cssHex(sideColor(shield.side)))
        this.sfx.shieldBroken(shield)
        this.vfx?.shieldBroken(shield)
      },
      shieldBack: (shield) => this.popup(shield.x, shield.y - 8, 'Shield up', cssHex(sideColor(shield.side))),
      wallHit: (_index, x, y) => (this.plainSparks ? this.sparks.push({ x, y, life: 0.8, color: BRICK.light, size: 0.7 }) : this.vfx?.wallHit(x, y)),
      portal: (x1, y1, x2, y2, pair) => {
        if (!this.plainSparks) return this.vfx?.portal(x1, y1, x2, y2, portalColour(pair))
        this.sparks.push({ x: x1, y: y1, life: 0.8, color: portalColour(pair), size: 0.8 }, { x: x2, y: y2, life: 1, color: portalColour(pair), size: 1 })
      },
      wallBroken: (index) => {
        const rect = this.level.walls[index]
        if (!rect) return
        const x = rect.x + rect.w / 2
        const y = rect.y + rect.h / 2
        this.walls[index]?.setHealth(0)
        this.sfx.wallBroken(x, y, index)
        if (!this.plainSparks) return this.vfx?.wallBroken(rect)
        for (let k = -1; k <= 1; k++) this.sparks.push({ x: x + (rect.w >= rect.h ? (k * rect.w) / 3 : 0), y: y + (rect.w >= rect.h ? 0 : (k * rect.h) / 3), life: 1, color: BRICK.light, size: 1.2 })
      },
      captured: (cannon) => {
        this.popup(cannon.x, cannon.y, 'Captured', cssHex(sideColor(cannon.side)))
        this.sfx.captured(cannon)
        this.vfx?.captured(cannon)
      },
      healed: (cannon, amount) => {
        this.tallyHeal(cannon, amount)
        this.vfx?.healed(cannon)
      },
      noAims: (cannon) => this.popup(cannon.x, cannon.y, 'No aims left', theme.textMuted),
      swapped: (cannon) => this.popup(cannon.x, cannon.y, kindLabel(cannon.kind), cssHex(sideColor(cannon.side))),
      aimed: (point) => {
        // The other player's aims don't ping on the host's screen.
        if (this.host?.applyingRemote) return
        this.pings.push({ x: point.x, y: point.y, life: 1, color: theme.select })
        this.hideBanner()
      },
    }
    // While catching up after a hidden tab, none of these play: the board just shows the result.
    for (const k of Object.keys(events) as (keyof SimEvents)[]) {
      const fn = events[k] as ((...a: unknown[]) => void) | undefined
      if (fn) (events as Record<string, unknown>)[k] = (...a: unknown[]) => { if (!this.quiet) fn(...a) }
    }
    this.simEvents = events
    if (pvp?.role === 'host') {
      this.host = new PvpHost(pvp.transport, this.level, randomId(), 'enemy', SIM_STEP_MS, pvp.peer)
      events = this.host.log.tap(events)
    }
    // The second player's round is only a picture of the host's: it never runs, so it gets no handlers.
    this.sim = new BattleSim(this.level, this, pvp && pvp.role !== 'host' ? {} : events, DEBUG.bot && !pvp ? undefined : 'progressive')
    if (this.host) {
      this.host.localSkin = loadSkin()
      this.host.localColour = loadColour()
    }
    this.skinsNow = this.roundSkins(pvp)
    this.sim.setSkins(this.skinsNow)
    this.setColours(this.roundColours(pvp))
    // 3-2-1-Go before every round this screen runs (a network view shows the host's or server's countdown instead).
    if (!pvp || pvp.role === 'host') this.sim.startCountdown(DEBUG.countdown ?? TUNING.countdownMs)
    if (pvp) this.startPvp(pvp)
    // Side glow, from where each side's cannons start (this view's sides, so a flipped view glows its own side in its colour).
    this.glow = new SideGlow(this, this.board, glowEdges(this.cannons, this.board), DEBUG.glow ?? GLOW.alpha)
    this.glow.paint(glowColours(this.colours))
    // Gameplay effects (Settings → Display → Effects quality). Purely drawn here, from the round's events.
    const vfx = new Vfx(this, this.cannons, this.fans, currentFxConfig('battle'), {
      register: (o) => this.world(o),
      board: this.board,
      edges: glowEdges(this.cannons, this.board),
      view: () => (this.wc ? this.wc.visibleRect() : null),
    })
    this.vfx = vfx
    // Soft auras under the obstacles (half a tower's).
    const obAuras = new ObstacleAuras(this, {
      walls: this.walls,
      pillars: this.level.pillars ?? [],
      glass: this.level.glass ?? [],
      fans: this.level.fans,
      mouths: this.mouths,
    }, currentFxConfig('battle'), (o) => this.world(o))
    this.obAuras = obAuras
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => obAuras.destroy())
    const offFx = onFxChange(() => {
      vfx.setConfig(currentFxConfig('battle'))
      obAuras.setConfig(currentFxConfig('battle'))
    })
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, offFx)
    // Name tags: two-player rounds only (they show while the looks clash), or forced with ?debug&tags=1.
    if (pvp || DEBUG.tags) {
      this.tags = new NameTags(this, this.cannons, () => {})
      this.refreshTags()
    }
    // Everything created so far is board content.
    this.children.list.forEach((obj) => this.world(obj))
    WORLD_VIEW.y = VIEW_TOP
    WORLD_VIEW.h = GAME_HEIGHT - VIEW_TOP
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

    this.createHud()
    this.uiBlock(() => this.createHint())
    this.swapMenu = new SwapMenu(
      this,
      (obj) => this.ui(obj),
      (c) => this.autoState(c),
      (c) => this.sim.queuedKind(c),
      (c) => this.canStop(c),
    )
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
    // Leaving the tab (or the window) pauses the round against the AI, so nothing happens
    // behind your back (Settings → "Pause vs AI when tabbed out"). Coming back checks the
    // round's end, drops sounds that were due while away, and catches up if it kept going.
    this.game.events.on(Phaser.Core.Events.BLUR, this.onLoseFocus, this)
    this.game.events.on(Phaser.Core.Events.HIDDEN, this.onLoseFocus, this)
    this.game.events.on(Phaser.Core.Events.HIDDEN, this.onAway, this)
    this.game.events.on(Phaser.Core.Events.VISIBLE, this.onBack, this)
    this.game.events.on(Phaser.Core.Events.FOCUS, this.onRefocus, this)
    window.addEventListener('pagehide', this.onPageHide)
    window.addEventListener('pageshow', this.onPageShow)
    document.addEventListener('visibilitychange', this.onVisibility)
    // The safety net: a light timer that runs even when no frames are drawn (a hidden tab).
    window.clearInterval(this.watchdog)
    this.watchdog = window.setInterval(() => this.watch(), 500)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.clearInterval(this.watchdog)
      this.watchdog = 0
      this.game.events.off(Phaser.Core.Events.HIDDEN, this.onAway, this)
      this.game.events.off(Phaser.Core.Events.VISIBLE, this.onBack, this)
      this.game.events.off(Phaser.Core.Events.FOCUS, this.onRefocus, this)
      window.removeEventListener('pagehide', this.onPageHide)
      window.removeEventListener('pageshow', this.onPageShow)
      document.removeEventListener('visibilitychange', this.onVisibility)
      // Stop listening (Back / Main menu say goodbye first; a restart keeps the connection).
      this.host?.close(false)
      this.client?.close(false)
      // Menus, thumbnails and the title demo show your colours again.
      applyTeamColours(vsAiColours(loadColour()))
      this.game.events.off(Phaser.Core.Events.BLUR, this.onLoseFocus, this)
      this.game.events.off(Phaser.Core.Events.HIDDEN, this.onLoseFocus, this)
      this.input.keyboard?.removeCapture('SPACE')
      this.endRoot?.destroy()
      this.endRoot = null
    })
    // A DOM button focused before the round (the editor's Playtest, say) must not catch Space.
    if (typeof document !== 'undefined') (document.activeElement as HTMLElement | null)?.blur?.()
    this.settings = new SettingsPanel(
      this,
      {
        auto: () => this.toggleGlobalAuto(),
        mute: () => this.sfx.toggleMute(),
        volume: (v) => this.sfx.setVolume(v),
        perf: () => perf.toggle(),
        tabPause: (on) => {
          this.tabPrefs = { ...this.tabPrefs, pauseVsAi: on }
          saveTabPrefs(this.tabPrefs)
        },
        debugInfo: () => debugNow(this.game),
      },
      () => {
        // Under the top bar, lined up with its right end.
        const c = this.game.canvas.getBoundingClientRect()
        const bar = this.hud?.el.getBoundingClientRect()
        return bar && bar.height > 0 ? { top: this.hud!.bottom + 8, right: bar.right - 8 } : { top: c.top + (VIEW_TOP + 8) * (c.width / GAME_WIDTH), right: c.right - 8 }
      },
      () => this.settings.hide(),
      { online: pvp?.role === 'online', versus: !!pvp },
      music,
    )
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
      fx: () => ({ label: fxLabel(), particles: this.vfx?.particles ?? 0 }),
      net: () => this.netSummary(),
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (perf.battle?.level === this.level) perf.battle = null
    })
    if (DEBUG.enabled) (window as unknown as { __cc?: unknown }).__cc = { scene: this, sim: this.sim, sfx: this.sfx, net: this.host ?? this.client }
  }

  update(time: number, delta: number): void {
    const dt = Math.min(delta, 32)
    const moving = this.vfx?.cfg.rings ?? false
    for (let i = 0; i < this.walls.length; i++) {
      const wall = this.walls[i]
      wall.tick(time, moving)
      if (wall.isBreakable) wall.setHealth(this.sim.wallHealth(i))
    }
    for (const pane of this.glass) pane.draw(time, moving)
    for (const portal of this.portals) portal.tick(time, moving)
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
      this.applyRoomOutcome()
    } else if (this.catchUp.active) {
      // Back from a hidden tab with "Pause vs AI when tabbed out" off: play back the missed time.
      this.runCatchUp(CATCH_UP_FRAME_MS)
      this.steps.reset()
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
    this.ensureEnd()

    this.fadeSparks(dt)
    this.flushHeals(dt)
    for (const ping of this.pings) ping.life -= dt / 420
    this.pings = this.pings.filter((ping) => ping.life > 0)
    this.drawFx(time, dt)
    this.updateVfx(delta, time)
    this.drawPaused(time)
    this.updateSwapMenu(dt, time)
    if (this.ended) this.settings.hide()
    this.settings.draw({
      autoTarget: this.sim.autoTarget,
      puzzle: this.sim.isPuzzle,
      volume: this.sfx.settings.volume,
      muted: this.sfx.settings.muted,
      audio: this.sfx.available,
      perf: perf.shown,
    })
    setRingScale(this.wc.cssPerWorld())
    this.tags?.update(this.wc.cssPerWorld())
    for (const cannon of this.cannons) {
      cannon.hovered = cannon === this.hover
      cannon.selected = cannon === this.selected
      cannon.manualBadge = cannon.side === 'player' && !this.sim.isPuzzle && !this.sim.autoTargets(cannon)
      cannon.draw(time, this.vfx?.cannonFx ?? null)
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
        this.vfx?.go()
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
    const alpha = go ? (t < 0.45 ? 1 : 1 - ((t - 0.45) / 0.55) ** 2) : t > 0.85 ? 1 - ((t - 0.85) / 0.15) * 0.5 : 1
    // The number punches in (big, then settles with a little give) and shrinks away at the end of its second.
    // Reduce motion: it just shows. Plain arithmetic: nothing is made per frame.
    let pop = go ? 1 + 0.25 * ease(t) : 1 + 0.28 * (1 - ease(Math.min(1, t / 0.22)))
    let numAlpha = alpha
    if (!motionOK()) pop = 1
    else if (!go) {
      const tin = Math.min(1, t / 0.26)
      const tout = t > 0.8 ? (t - 0.8) / 0.2 : 0
      const c = 1.70158
      const back = 1 + (c + 1) * (tin - 1) ** 3 + c * (tin - 1) ** 2
      pop = (1.35 - 0.35 * back) * (1 - 0.2 * tout * tout)
      numAlpha = Math.min(1, t / 0.08) * (1 - 0.85 * tout * tout)
    }
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
      .setAlpha(numAlpha)
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

  /**
   * The round is over (the game logic says so: sim.ended): do the once-per-
   * round things, then make sure the result panel is up. Called every frame,
   * on coming back to the tab, and by the watchdog; cheap when nothing to do.
   */
  private ensureEnd(): void {
    if (this.restarting) return
    this.applyRoomOutcome()
    const result = this.sim.ended
    if (!result) return
    if (!this.shownEnd) {
      this.shownEnd = true
      this.selected = null
      this.hover = null
      this.hideBanner()
      this.hud?.closeConfirm()
      this.syncButtons()
      // Progress is saved once, whatever happens to the panel.
      if (result === 'win' && this.levelIndex >= 0 && !this.online) {
        this.endStars = starsFor(this.level, { seconds: Math.round(this.sim.clock / 1000), aimsUsed: this.sim.aimsUsed })
        recordWin(this.level.id, this.endStars)
      }
      // A win against the AI earns that bot's badge on this map (saved once, like progress).
      const bot = result === 'win' ? this.botLevel() : null
      if (bot && earnBadge(this.level.id, bot)) this.endBadge = badgeName(BOTS[bot].name, DIFFICULTY[bot].label)
    }
    this.resultGate.check(result, this.restarting)
  }

  /** Build (or rebuild) the result panel for the round's outcome. */
  private buildResult(): void {
    const result = this.sim.ended!
    // A rebuild (online: rematch votes) keeps the keyboard on the same button.
    const focused = this.endRoot?.focused() ?? null
    this.endRoot?.destroy()
    this.endRoot = null
    const view = this.online ? this.onlineView(result) : this.offlineView(result)
    const stroke = view.tone === 'draw' ? theme.neutral : sideColor(view.tone === 'win' ? 'player' : 'enemy')
    this.endRoot = new ResultPanel(view, {
      stroke,
      botColour: sideColor('enemy'),
      animate: !this.endAnimated,
      topInset: () => this.hud?.el.getBoundingClientRect().bottom ?? 0,
      onAction: (action) => this.onResultAction(action),
    })
    this.endAnimated = true
    if (focused) this.endRoot.button(focused)?.focus({ preventScroll: true })
    if (DEBUG.enabled) {
      const w = window as unknown as { __ccPanels?: number }
      w.__ccPanels = (w.__ccPanels ?? 0) + 1
    }
  }

  /** Online: a result the room keeps stands in for a final snapshot that never came. */
  private applyRoomOutcome(): void {
    if (this.online && !this.sim.ended && this.roomOutcome) this.sim.ended = this.roomOutcome
  }

  // ---------------------------------------------------------------- tabbed out

  private readonly onVisibility = (): void => {
    if (document.hidden) this.onAway()
    else this.onBack()
  }

  private readonly onPageHide = (): void => this.onAway()
  private readonly onPageShow = (): void => this.onBack()

  /** The tab went away (hidden, or the page put in the back/forward cache). */
  private onAway(): void {
    if (this.awayAt !== null) return
    this.awayAt = performance.now()
    this.creditedAt = this.awayAt
    // Nothing keeps sounding into a hidden tab, and nothing new starts (Sfx.audible).
    this.sfx.stopAll()
  }

  /** The tab is back: show where the round is, never a burst of what was missed. */
  private onBack(): void {
    if (this.awayAt === null) return this.onRefocus()
    const awayMs = performance.now() - this.awayAt
    this.awayAt = null
    // Say so once the round has been played up to now (most of it already was, while hidden).
    this.caughtUpNote = this.keepsGoing && awayMs >= 1000 && !this.sim.ended && !this.sim.paused
    this.sfx.dropPending()
    // Online and the PvP test: jump to the newest picture, drop the events missed.
    this.client?.resync()
    this.creditAway()
    if (!this.catchUp.active) this.noteCaughtUp()
    this.ensureEnd()
  }

  private noteCaughtUp(): void {
    if (!this.caughtUpNote) return
    this.caughtUpNote = false
    if (this.sim.ended || document.hidden) return
    this.hideBanner()
    this.showBanner('Caught up: the round kept going while you were away.')
    const shown = this.banner
    this.time.delayedCall(3500, () => {
      if (this.banner === shown) this.hideBanner()
    })
  }

  /** The window has focus again (alt-tab back, a click into the Discord frame). */
  private onRefocus(): void {
    // Phaser resumes the audio here; anything left waiting on the paused clock goes, not plays.
    this.sfx.dropPending()
    this.ensureEnd()
  }

  /** "Pause vs AI when tabbed out" off: the round keeps going while away. */
  private get keepsGoing(): boolean {
    return !this.pvp && !this.tabPrefs.pauseVsAi
  }

  /** Count the time away (up to now) as missed time to play back. */
  private creditAway(): void {
    const now = performance.now()
    const ms = now - this.creditedAt
    this.creditedAt = now
    if (this.keepsGoing && !this.sim.ended && !this.sim.paused && !this.restarting) this.catchUp.add(ms)
  }

  /** Play back missed time in fixed steps, silently, within `budgetMs` of work. */
  private runCatchUp(budgetMs: number): void {
    if (!this.catchUp.active) return
    this.quiet = true
    this.sfx.silent = true
    try {
      this.catchUp.run(() => {
        if (this.sim.ended || this.sim.paused) return false
        this.bot?.update(SIM_STEP_MS)
        this.sim.step(SIM_STEP_MS)
        return !this.sim.ended && !this.sim.paused
      }, () => performance.now(), budgetMs)
    } finally {
      this.quiet = false
      this.sfx.silent = false
    }
    // No late "3, 2, 1, Go!" for a countdown that ran out while away.
    if (this.sim.countdown <= 0) {
      this.countShown = 0
      this.goLeft = 0
    }
    if (!this.catchUp.active && !document.hidden) this.noteCaughtUp()
  }

  /**
   * Every 500 ms, frames or not: while hidden, keep a running round going
   * (vs AI with pausing off) and keep the online picture current, so a round
   * that ends meanwhile has its panel ready on return; and show the panel if
   * the round is over and none is up.
   */
  private watch(): void {
    if (!this.scene.isActive() || this.restarting) return
    if (typeof document !== 'undefined' && document.hidden) {
      if (this.client) {
        // Nothing missed is replayed (sounds, sparks): just the newest picture, and the end.
        this.client.resync()
        this.client.update(this.sim, {}, 0)
      } else if (this.keepsGoing && this.awayAt !== null) {
        this.creditAway()
        this.runCatchUp(8)
      }
    }
    this.ensureEnd()
  }

  private playerAim(cannon: Cannon, aim: Cannon | Point): boolean {
    const ok = this.order({ t: 'aim', cannon: cannon.id, at: aim instanceof Cannon ? { cannon: aim.id } : { x: aim.x, y: aim.y } }).ok
    if (ok) this.aimedOnce = true
    return ok
  }

  /**
   * Every order from this screen (clicks, keys, menus) goes through here: to
   * the round itself, or to the host when this is the second player. The other
   * player's orders reach the host's round through the same applyOrder.
   */
  /**
   * Can "Stop aiming" do anything for this cannon? It has an aim now (and no
   * stop queued yet), or, paused, an aim queued that the stop would cancel.
   */
  private canStop(c: Cannon): boolean {
    if (this.ended || this.restarting || c.side !== 'player') return false
    if (this.sim.paused) return this.sim.queuedAim(c) !== null || (!!c.aim() && !this.sim.queuedStop(c))
    return !!c.aim()
  }

  /** Stop aiming (right-click, or the menu's pill): the cannon drops its aim and holds its fire until you aim it again. */
  private stopAiming(c: Cannon): boolean {
    if (!this.canStop(c)) return false
    const paused = this.sim.paused
    const ok = this.order({ t: 'stop', cannon: c.id }).ok
    if (!ok) return false
    if (this.selected === c) this.selected = null
    this.popup(c.x, c.y - 30, paused ? 'Stops when you resume' : 'Stopped aiming', theme.textMuted)
    return true
  }

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
    // Check it against the picture first (the server checks again), and show it straight away:
    // the client keeps showing it (prediction) until the server's picture has it.
    const res = this.predict(o)
    if (res.ok) this.client.send(o, res.on)
    return res
  }

  /** Online numbers for the performance panel (null when not playing over a network). */
  private netSummary(): PerfNet | null {
    const c = this.client
    if (!c) return null
    const n = c.netStats
    const room = this.online
    const server = room?.info?.server
    return {
      rtt: room ? room.rttAvg : null,
      delayMs: n.delayMs,
      jitterMs: n.jitterMs,
      kbps: room ? room.kbpsIn : null,
      predicted: n.predicted,
      refused: n.refused,
      server: server ? `${server.colo ?? '?'} (${server.region})` : null,
    }
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
      case 'stop': {
        const c = mine(o.cannon)
        return { ok: !!c && this.canStop(c) }
      }
      case 'swap': {
        const c = mine(o.cannon)
        const ok = !!c && (o.kind !== c.kind || sim.queuedKind(c) !== null)
        // The new type's label pops now (the server's echo of it then shows nothing).
        if (ok && !sim.paused) this.popup(c!.x, c!.y, kindLabel(o.kind), cssHex(sideColor('player')))
        return { ok }
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

  /**
   * What colour each side wears, like roundSkins: your pick and its contrast
   * against the AI; two players: the host's/server's decision (each player
   * keeps theirs unless the pair clashes), flipped when this view is, so
   * everyone sees themselves in their own colour.
   */
  private roundColours(pvp: PvpData | null): SideColours {
    const mine = loadColour()
    if (!pvp) return vsAiColours(mine)
    if (pvp.role === 'host') return this.host!.colours
    const c = readColours(pvp.start.colours)
    if (pvp.role === 'client') return c ? flipColours(c) : vsAiColours(mine)
    // Online: a watcher sees the server's sides as they are. An older server sends no colours: guess.
    if (!c) return vsAiColours(pvp.start.spectate ? DEFAULT_COLOUR : mine)
    return pvp.start.side === 'enemy' ? flipColours(c) : c
  }

  /** This view's colours (labels for watchers, the board through theme.sideColor). */
  private setColours(c: SideColours): void {
    this.colours = c
    applyTeamColours(c)
    this.paintHud()
    this.glow?.paint(glowColours(c))
  }

  /**
   * The top bar's cannon bar in the team colours (again when they change: a
   * LAN joiner's colour arrives late). Segments use the side glow's colours,
   * so on a colour clash the enemy's is the same red as its glow; the dots
   * at the ends wear the cannons' own colours and ownership rings.
   */
  private paintHud(): void {
    if (!this.hud) return
    const g = glowColours(this.colours)
    this.hud.setColours(g.player, g.enemy, sideColor('player'), sideColor('enemy'), theme.ringYou, theme.ringEnemy)
  }

  /**
   * Name tags on: two players whose looks clash (config/looks.ts), or forced
   * with ?debug&tags. Then each owned cannon carries its owner's name.
   */
  private refreshTags(): void {
    const tags = this.tags
    if (!tags) return
    tags.setEnabled(DEBUG.tags ?? (!!this.pvp && looksClash(this.colours, this.skinsNow)))
    if (!tags.shown) return
    const [player, enemy] = this.tagNamesNow()
    tags.setNames(player, enemy)
  }

  /** The owners' names for the tags, in this view's sides ('player' is you; watchers: the gold seat). */
  private tagNamesNow(): [string, string] {
    if (this.online) {
      const info = this.online.info
      const [gold, pink] = tagNames(nameOnSide(info, 0), nameOnSide(info, 1))
      return this.me === 1 ? [pink, gold] : [gold, pink]
    }
    if (this.pvp) {
      // The same-browser test mode has no names.
      const [host, guest] = tagNames('Host', 'Player 2')
      return this.host ? [host, guest] : [guest, host]
    }
    return ['You', 'AI']
  }

  /** A side's colour name in this view ("Blueberry"). */
  private colourName(side: 'player' | 'enemy'): string {
    return TEAM_COLOUR[this.colours[side]].label
  }

  /** Player vs player: hook this screen up to the other player. */
  private startPvp(pvp: PvpData): void {
    if (this.host) {
      const host = this.host
      this.sim.makePvp()
      host.onPeer = (joined) => {
        this.peerHere = joined
        // The joiner's skin and colour arrive with them.
        this.skinsNow = host.skins
        this.sim.setSkins(this.skinsNow)
        this.setColours(host.colours)
        this.refreshTags()
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
    this.serverSide = start.spectate ? 'player' : start.side
    this.pausesOff = start.pauses === false
    room.entered = start.match
    const off = room.onChange(() => this.onRoomChange())
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, off)
    this.onRoomChange()
  }

  private onRoomChange(): void {
    const room = this.online
    if (!room || this.restarting) return
    const info = room.info
    if (info?.phase === 'playing') {
      this.sawPlaying = true
      this.playingSeen = true
    }
    // The match is over and the room says how. Usually the final snapshot says so too, but
    // after a hidden tab whose connection dropped, the server may have put the match away
    // before the reconnect: then the room's result is the only word, and it is enough.
    if (info?.phase === 'ended' && info.result && this.playingSeen && !this.roomOutcome) {
      this.roomOutcome = outcomeFromResult(info.result, info.sides, this.serverSide)
      this.ensureEnd()
    }
    if (info?.phase !== 'playing' && this.sawPlaying && !this.sim.ended && !this.roomOutcome) {
      // The room says the match is over but no final picture came: give it a moment, then call it interrupted.
      this.sawPlaying = false
      this.time.delayedCall(2500, () => {
        if (this.restarting || this.sim.ended || this.roomOutcome || this.client?.latest?.winner != null || room.info?.phase === 'playing') return
        this.showBanner('The match was interrupted (the server restarted). Back to the room…')
        this.time.delayedCall(3000, () => this.go(LOBBY))
      })
    }
    // Names can change mid-match (and arrive with the room).
    this.refreshTags()
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
          ? `Watching room ${this.online.code}: ${nameOnSide(info, 0)} (${this.colourName('player')}) vs ${nameOnSide(info, 1)} (${this.colourName('enemy')}).${this.tags?.shown ? ' Their looks are alike, so names are on the cannons.' : ''}`
          : `Online · room ${this.online.code} · you are ${this.colourName('player')} (light rings). ${this.tags?.shown ? 'Your looks are alike, so names are on the cannons (white: yours). ' : ''}Take every cannon, or hold the most when the ${mins} clock runs out.${this.pausesOff ? ' Pauses are off in this room.' : ''}`,
      )
      return
    }
    const you = `${this.colourName('player')} (${this.pvp.role === 'host' ? 'the host' : 'player 2'})`
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
    // Right-click is Stop aiming / cancel on the board, so the browser's own menu stays shut.
    this.input.mouse?.disableContextMenu()
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
    if (this.hud?.confirmOpen) this.hud.closeConfirm()
    else if (this.settings.open) this.settings.hide()
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
    // Online, the host can turn pauses off: then Space (and the HUD link) do nothing.
    if (this.ended || this.restarting || this.battleMenu?.open || this.pausesOff) return
    if (this.pvp && this.sim.countdown > 0) {
      // Shown in place of the countdown's hint line, where the player is already looking.
      this.countNoteLeft = 1600
      return
    }
    this.order({ t: this.sim.paused ? 'resume' : 'pause' })
    this.syncPauseButton()
  }

  /** The top bar's Pause / Resume button (pressed look while paused). */
  private syncPauseButton(): void {
    this.hud?.setButton('pause', this.sim.paused ? 'Resume' : 'Pause', this.sim.paused)
  }

  /**
   * Which top-bar buttons apply right now: no Pause when the room turned
   * pauses off (the line under the clock says so) or once the round is over,
   * Surrender only while it can be used. Cheap: show() returns at once when
   * nothing changed, so this runs every frame.
   */
  private syncButtons(): void {
    const hud = this.hud
    if (!hud) return
    const live = !this.ended && !this.restarting
    hud.show('pause', live && !this.pausesOff)
    hud.show('settings', live)
    hud.show('surrender', this.surrenderAllowed())
    if (!live || !this.surrenderAllowed()) hud.closeConfirm()
  }

  /**
   * Surrender: against the AI (levels, quick battles, custom maps) and online
   * for a seated player on a server that takes it. Not in puzzles (Restart is
   * the way out), playtests, or the same-browser PvP test.
   */
  private surrenderAllowed(): boolean {
    if (this.ended || this.restarting) return false
    if (this.online) return this.me !== null && this.online.info?.surrender === true && this.online.status === 'open'
    return this.surrenderHere
  }

  /** Does this kind of round have a Surrender button at all (whether or not it works this moment)? */
  private surrenderApplies(): boolean {
    if (this.online) return this.me !== null
    return !this.pvp && !this.isPuzzle && !editorReturn(this.ctx)
  }

  /** The Surrender button (or the Menu's): ask first, so a stray tap never gives the round away. */
  private askSurrender(): void {
    if (!this.surrenderAllowed() || !this.hud) return
    const note = this.online
      ? `${nameOnSide(this.online.info, (1 - this.me!) as 0 | 1)} wins the match. You can still rematch after.`
      : 'The AI wins this round. It counts as a loss.'
    this.hud.confirm('Surrender?', note, 'Surrender', () => this.surrender())
  }

  private surrender(): void {
    if (!this.surrenderAllowed()) return
    // Online the server decides: the other player wins and everyone sees why.
    if (this.online) return this.online.send({ t: 'surrender' } satisfies ClientMsg)
    this.surrendered = true
    this.sim.endMatch('lose', 'The AI takes this round.')
  }

  private onLoseFocus(): void {
    // Player vs player: the other player is still playing. Pausing off: the round keeps going.
    if (this.pvp || !this.tabPrefs.pauseVsAi) return
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
    menu.draw({ x: p.x / k, y: p.y / k }, TUNING.cannonRadius * this.wc.zoom, WORLD_VIEW.y + 4)
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
      // The panel is HTML above the board: its own controls handle presses on it.
      if (this.settings.hitAt(lp.x, lp.y)) {
        this.pressOnUi = true
        return
      }
      // A press elsewhere (but not on the HUD's Settings link) closes it, and does nothing else.
      if (!(over && over.length > 0)) {
        this.settings.hide()
        this.pressOnUi = true
        return
      }
    }
    if (pointer.rightButtonDown()) {
      // Right-click: cancel target mode if it's on, else stop the aim of the cannon under it.
      this.pressOnUi = true
      if (over && over.length > 0) return
      if (this.selected) {
        this.selected = null
        return
      }
      if (this.ended || !this.wc.inView(pointer.x, pointer.y)) return
      const w = this.wc.toWorld(pointer.x, pointer.y)
      const c = this.cannonAt(w.x, w.y)
      if (c && c.side === 'player') this.stopAiming(c)
      return
    }
    if (this.swapMenu.open && this.swapMenu.contains(lp.x, lp.y)) {
      this.pressOnUi = true
      const kind = this.swapMenu.pillAt(lp.x, lp.y)
      const cannon = this.swapMenu.cannon
      if (kind === 'auto') {
        if (cannon) this.toggleCannonAuto(cannon)
      } else if (kind === 'stop') {
        if (cannon) this.stopAiming(cannon)
        if (this.swapMenu.pinned) this.swapMenu.hide()
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
    if (this.settings.open && this.settings.contains(this.pointerLayout.x, this.pointerLayout.y)) {
      this.input.setDefaultCursor('default')
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
    this.foldedItems(items)
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
    this.foldedItems(items)
    if (this.ended || this.me === null) items.push({ id: 'lobby', label: 'Back to the room', run: () => this.go(LOBBY) })
    items.push({ id: 'leave', label: this.ended || this.me === null ? 'Leave the room' : 'Leave the match (an AI takes your side)', run: () => this.go(MAIN_MENU) })
    this.battleMenu.show('Menu', `Room ${this.online!.code}  ·  ${this.level.name}  ·  the match keeps going while this is open`, items)
  }

  /** Menu items for top-bar buttons that didn't fit (Settings), and Surrender (always here too, when it applies). */
  private foldedItems(items: { id: string; label: string; run: () => void; primary?: boolean; icon?: string }[]): void {
    if (this.hud?.folded.has('settings') && !this.ended) items.push({ id: 'settings', label: 'Settings', run: () => (this.closeMenu(), this.settings.toggle()) })
    if (this.surrenderAllowed()) items.push({ id: 'surrender', label: 'Surrender…', run: () => (this.closeMenu(), this.askSurrender()) })
    items.push({ id: 'music', label: 'Music', run: () => this.openJukebox(), icon: ICONS.music })
  }

  /** Menu → Music: the jukebox inside the battle menu (the song keeps playing, Back returns). */
  private openJukebox(): void {
    this.battleMenu.showPanel('Jukebox', 'Music carries on between the menu and battles', jukeboxPanel(music, { compact: true }))
  }

  closeMenu(): void {
    if (!this.battleMenu?.open) return
    this.battleMenu.hide()
    this.menuHold.release()
    this.syncPauseButton()
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
    // The cannon strip's band (the HTML strip sits on it, as wide as the board).
    hud.fillStyle(theme.hud, 0.6)
    hud.fillRect(0, HUD_H + 2, GAME_WIDTH, HUD_STRIP)
  }

  /**
   * The top bar: compact title, the cannon bar, the online clock, and the
   * buttons. The title is just the map (the level number in the campaign);
   * the room code and the rest live in the Menu's header.
   */
  private createHud(): void {
    const title = this.online
      ? this.level.name
      : this.pvp
        ? `PvP test  ·  ${this.level.name}`
        : this.levelIndex >= 0
          ? `${this.levelIndex + 1}. ${this.level.name}`
          : this.level.name
    const toEditor = editorReturn(this.ctx)
    const buttons: HudButton[] = []
    if (toEditor) buttons.push({ id: 'editor', label: `← Editor (${EDITOR_KEY})`, title: `Back to the editor (${EDITOR_KEY})`, keep: 6, left: true, onPress: () => this.go(toEditor) })
    this.surrenderHere = this.surrenderApplies()
    if (this.surrenderHere) buttons.push({ id: 'surrender', label: 'Surrender', title: this.online ? 'Surrender: give this match to the other player (asks first)' : 'Surrender: give up this round (asks first)', keep: 3, danger: true, onPress: () => this.askSurrender() })
    // Watchers can't pause.
    if (!(this.online && this.me === null)) buttons.push({ id: 'pause', label: 'Pause', title: 'Pause or resume (Space)', keep: 5, onPress: () => this.togglePause() })
    buttons.push({ id: 'settings', label: 'Settings', title: 'Settings: auto-target, sound, music, display and more', keep: 2, onPress: () => this.settings.toggle() })
    if (!this.online) buttons.push({ id: 'restart', label: 'Restart', title: 'Restart the round (R)', keep: 1, onPress: () => this.restart() })
    buttons.push({ id: 'menu', label: 'Menu', title: 'Menu (Esc)', keep: Infinity, onPress: () => this.openMenu() })
    // Your segment on your side of the board (watchers: the gold seat's side), like the side glow.
    const edges = glowEdges(this.cannons, this.board)
    const mineOn = edges.player ?? (edges.enemy === 'left' ? 'right' : 'left')
    const vs = this.opponentLine()
    this.hud = new BattleHud(
      this,
      {
        title,
        opponent: vs?.text ?? null,
        opponentTitle: vs?.title,
        buttons,
        counts: { mineOn, enemy: !this.isPuzzle },
        clock: !!this.online,
        aims: this.isPuzzle && this.level.aims !== undefined,
      },
      (cover) => this.fitViewUnderBar(cover),
    )
    if (DEBUG.enabled) this.hud.el.dataset.mineOn = mineOn
    this.paintHud()
    this.syncPauseButton()
    this.syncButtons()
  }

  /**
   * Who you play, for the top bar: the bot and its difficulty, the other
   * player online (both names when watching), or nothing (puzzles).
   */
  private opponentLine(): { text: string; title: string } | null {
    if (this.online) {
      const info = this.online.info
      const seat = this.me
      if (seat === null) {
        const text = `${nameOnSide(info, 0)} vs ${nameOnSide(info, 1)}`
        return { text, title: `Watching: ${text}` }
      }
      const name = info?.seats[1 - seat]?.name || 'Player ' + (2 - seat)
      return { text: `vs ${name}`, title: `You are playing ${name} online` }
    }
    if (this.pvp) return { text: 'vs Player 2', title: 'Two players on one network' }
    const bot = this.botLevel()
    if (!bot) return null
    const { name, vibe } = BOTS[bot]
    const label = DIFFICULTY[bot].label
    return { text: `vs ${name} · ${label}`, title: `${name} (${label}): ${vibe}` }
  }

  /** The bar and strip reach past their band (small screens): start the board's view below them, never under them. */
  private fitViewUnderBar(cover: number): void {
    const y = VIEW_TOP + cover
    if (Math.abs(y - WORLD_VIEW.y) < 0.5) return
    WORLD_VIEW.y = y
    WORLD_VIEW.h = GAME_HEIGHT - y
    this.wc?.setView(WORLD_VIEW)
  }

  /** The hint pill under the top bar (UI camera, never takes a click). */
  private createHint(): void {
    this.hintBg = this.add.graphics()
    this.hint = this.add
      .text(0, 0, '', { fontFamily: theme.font, fontSize: '14px', color: theme.text, align: 'center', wordWrap: { width: 860 } })
      .setOrigin(0.5)
    this.hintBox = this.add.container(GAME_WIDTH / 2, VIEW_TOP + 24, [this.hintBg, this.hint]).setDepth(29).setVisible(false)
  }

  /** Words for the cannon bar's tooltip and screen readers. */
  private readonly countsLabel = (mine: number, neutral: number, theirs: number): string => {
    const watching = this.online !== null && this.me === null
    const a = watching ? `${nameOnSide(this.online!.info, 0)} (${this.colourName('player')})` : 'You'
    const b = watching ? `${nameOnSide(this.online!.info, 1)} (${this.colourName('enemy')})` : this.pvp ? 'Them' : 'Enemy'
    return this.isPuzzle ? `Cannons: ${a} ${mine}, neutral ${neutral}` : `Cannons: ${a} ${mine}, neutral ${neutral}, ${b} ${theirs}`
  }

  private refreshHud(): void {
    // Counted without allocating (this runs every frame).
    let mine = 0
    let neutral = 0
    let theirs = 0
    for (const cannon of this.cannons) {
      if (cannon.side === 'player') mine++
      else if (cannon.side === 'enemy') theirs++
      else neutral++
    }
    const hud = this.hud
    if (hud) {
      hud.setCounts(mine, neutral, theirs, this.countsLabel)
      const left = this.aimsLeft
      if (this.isPuzzle && this.level.aims !== undefined && left !== this.aimsShown) {
        this.aimsShown = left
        hud.setAims(`${left} aim${left === 1 ? '' : 's'} left`, left === 0)
      }
      this.syncButtons()
      // The cannon strip spans the board as it shows on screen (zoom and pan included).
      const k = layoutScale(this)
      const b = this.board
      hud.setSpan(this.wc.toScreen(b.x, b.y).x / k, this.wc.toScreen(b.x + b.w, b.y).x / k)
      if (!this.online) {
        const sec = Math.floor(this.sim.clock / 1000)
        if (sec !== this.clockShown) {
          this.clockShown = sec
          hud.setClock(matchTime(this.sim.clock), false)
        }
      }
    }
    if (this.online) this.refreshOnlineHud()
    this.refreshHint()
  }

  private refreshOnlineHud(): void {
    const x = this.client?.latest?.x
    const t = performance.now()
    if (x) {
      for (let i = 0; i < 2; i++) {
        if (x.on[i] || x.ai[i]) this.dropAt[i] = null
        else this.dropAt[i] ??= t
      }
    }
    // The clock text only when its second changes; the ping line a few times a second.
    const tl = x ? x.tl : PVP_RULES.matchMs
    const sec = Math.max(0, Math.ceil(tl / 1000))
    if (sec !== this.clockShown) {
      this.clockShown = sec
      this.hud?.setClock(clock(tl), tl < 30_000)
    }
    if (t >= this.netAt) {
      this.netAt = t + 250
      this.hud?.setNet(netParts(x, this.me, this.pausesOff).join('  ·  '), this.online!.rttAvg)
      const vs = this.opponentLine()
      this.hud?.setOpponent(vs?.text ?? null, vs?.title)
      if (this.sim.paused) {
        const label = pauseLabel(x, this.me, this.online!.info)
        if (this.pausedLabel.text !== label) this.pausedLabel.setText(label)
      }
    }
  }

  /**
   * The hint pill. It is worked out again only when what it depends on
   * changed (hover, selection, the type menu's pill, pause), or a few times a
   * second for the timed lines, so it doesn't build strings every frame.
   */
  private refreshHint(): void {
    const lp = this.pointerLayout
    const pill = lp && this.swapMenu.open ? this.swapMenu.pillAt(lp.x, lp.y) : null
    const key = this.hintKey
    const now = performance.now()
    if (key[0] === this.hover && key[1] === this.selected && key[2] === pill && key[3] === this.sim.paused && now < this.hintAt) return
    key[0] = this.hover
    key[1] = this.selected
    key[2] = pill
    key[3] = this.sim.paused
    this.hintAt = now + 200
    if (this.sim.paused && !this.online && !this.ended) {
      const label = this.pausedHint()
      if (this.pausedLabel.text !== label) this.pausedLabel.setText(label)
    }
    this.setHint(this.hintLine())
  }

  private setHint(text: string): void {
    const box = this.hintBox
    if (!text) {
      box.setVisible(false)
      return
    }
    // Readable on a phone: at least ~12 CSS px, like the countdown's hint.
    const cssPerLayout = this.uiCam.zoom / (this.scale.displayScale.x || 1)
    const k = Math.min(2.2, Math.max(1, 12 / (14 * cssPerLayout)))
    if (this.hint.text !== text || k !== this.hintK) {
      this.hint.setText(text)
      this.hint.setWordWrapWidth((GAME_WIDTH - 80) / k)
      const w = this.hint.width + 28
      const h = this.hint.height + 12
      const g = this.hintBg
      g.clear()
      g.fillStyle(theme.panel, 0.9)
      g.fillRoundedRect(-w / 2, -h / 2, w, h, Math.min(16, h / 2))
      g.lineStyle(1.5, theme.boardEdge, 1)
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, Math.min(16, h / 2))
      box.setScale(k)
      this.hintK = k
    }
    box.setY(WORLD_VIEW.y + 6 + ((this.hint.height + 12) * k) / 2)
    box.setVisible(true)
  }

  /** News that always shows: the connection, the other player dropping, waiting for player 2. */
  private statusLine(): string | null {
    if (this.online && !this.ended) {
      const room = this.online
      if (room.closed) return room.error?.msg ?? 'Disconnected from the room.'
      if (room.status !== 'open') return `Connection lost: reconnecting… (after ${PVP_RULES.graceMs / 1000} s an AI plays your side until you are back)`
      if (this.me === null) return null
      const them = (1 - this.me) as 0 | 1
      return opponentLine(this.client?.latest?.x, this.me, room.info, this.dropAt[them], performance.now())
    }
    if (this.pvp && !this.ended) {
      if (this.host && !this.peerHere) return `Waiting for player 2 to join room ${this.pvp.room}…`
      if (this.client && !this.peerHere) return 'The host has left (or stopped answering).'
    }
    return null
  }

  /**
   * The hint pill's text ('' hides it). How-to lines show only at the start
   * of a round: through the countdown, then until your first aim or 10 s in
   * (puzzles: until your first aim, they're about planning). After that the
   * board speaks for itself and the line would only be noise. The type
   * menu's explanations still show while it is open (it is the only place
   * the types are explained), and so does connection news. Paused hints are
   * in the "Paused" pill instead.
   */
  private hintLine(): string {
    if (this.ended || this.restarting) return ''
    const status = this.statusLine()
    if (status) return status
    if (this.sim.paused || (this.online && this.me === null)) return ''
    const pillOpen = !!this.pointerLayout && this.swapMenu.open && this.swapMenu.pillAt(this.pointerLayout.x, this.pointerLayout.y) !== null
    const early = this.sim.countdown > 0 || (!this.aimedOnce && (this.isPuzzle || this.sim.clock < GUIDE_MS))
    if (!pillOpen && !early) return ''
    return this.guideLine()
  }

  /** The "Paused" pill's text: what you're doing while paused (single player; online it says who paused). */
  private pausedHint(): string {
    const lp = this.pointerLayout
    const pill = lp && this.swapMenu.open ? this.swapMenu.pillAt(lp.x, lp.y) : null
    const c = this.swapMenu.cannon
    if (pill === 'auto') return this.guideLine()
    if (pill === 'stop') return !c ? '' : this.sim.queuedAim(c) ? `Cancel ${c.name}'s queued aim.` : `Queue: ${c.name} stops aiming when you resume (it holds its fire).`
    if (pill && c) {
      if (pill === c.kind) return this.sim.queuedKind(c) ? `Cancel ${c.name}'s queued swap (it stays a ${kindLabel(c.kind)}).` : `${c.name} is a ${kindLabel(c.kind)}.`
      return `Queue: ${c.name} → ${kindLabel(pill)} when you resume (its reload starts then, not now).`
    }
    if (this.selected) return `Paused: click where ${this.selected.name} should aim; it happens when you resume (Space).`
    return 'Paused: select cannons, aim them, swap types. Everything happens at once when you resume (Space).'
  }

  /** How-to lines for what's under the pointer and what's selected. */
  private guideLine(): string {
    const lp = this.pointerLayout
    const pill = lp && this.swapMenu.open ? this.swapMenu.pillAt(lp.x, lp.y) : null
    if (pill === 'auto') {
      const c = this.swapMenu.cannon!
      if (!this.sim.autoTarget) return `Auto-target is off for all your cannons (Settings). ${c.name}'s own toggle is ${c.autoTarget ? 'on' : 'off'}: click to flip it for when Settings is back on.`
      if (c.autoTarget) return `${c.name} auto-targets: when its target is captured it picks the nearest foe itself. Click (or M) for manual: it keeps your aim and waits for orders.`
      return `${c.name} is on manual: it never picks a target by itself. Click (or M) to turn auto-target back on.`
    }
    if (pill === 'stop') return `Stop aiming: ${this.swapMenu.cannon?.name ?? 'it'} holds its fire until you aim it again (or right-click it).`
    if (pill && this.swapMenu.cannon) {
      const c = this.swapMenu.cannon
      if (pill === c.kind) return `${c.name} is a ${kindLabel(c.kind)}: ${KINDS[c.kind].blurb}.`
      return `Swap ${c.name} to ${kindLabel(pill)}: ${KINDS[pill].blurb}. ${KINDS[pill].fires ? 'It reloads before its first shot.' : 'Its barrier comes up after the reload.'}`
    }
    if (!this.selected) {
      if (this.hover && this.hover.side === 'player') return `Click to select ${this.hover.name}, or pick a type above it (long-press on touch).${this.hover.aim() ? ' Right-click stops its aim.' : ''}`
      return 'Click one of your cannons (light ring) to select it, then click where it should aim.'
    }
    const name = this.selected.name
    if (!this.selected.fires) {
      if (this.hover === this.selected) return `Click ${name} again to deselect.`
      if (this.hover && this.hover.side === 'player' && !this.hover.damaged) return `Click to select ${this.hover.name} instead.`
      return `${name} is a shield: click where its barrier should face (the chevron points that way; enemy shots stop on it, yours pass through).`
    }
    if (this.hover && this.hover !== this.selected) {
      if (this.hover.side === 'player' && this.hover.damaged) return `${name} → heal ${this.hover.name} (it goes back to its old aim once ${this.hover.name} is whole).`
      if (this.hover.side === 'player') return `Click to select ${this.hover.name} instead.`
      return `${name} → ${this.hover.name}`
    }
    if (this.hover === this.selected) return `Click ${name} again to deselect.`
    return `${name}: click anywhere to aim (it deselects after), or click it again (or right-click) to cancel.`
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
    const y = this.banner.y
    if (motionOK()) {
      this.banner.y = y + 10
      this.tweens.add({ targets: this.banner, alpha: 1, y, duration: 280, ease: 'Back.Out' })
    } else this.tweens.add({ targets: this.banner, alpha: 1, duration: 200 })
    this.time.delayedCall(9000, () => this.hideBanner())
  }

  private hideBanner(): void {
    const banner = this.banner
    if (!banner) return
    this.banner = null
    this.tweens.add({ targets: banner, alpha: 0, y: banner.y + (motionOK() ? 8 : 0), duration: 240, ease: 'Quad.In', onComplete: () => banner.destroy() })
  }

  /** Online: draw the end screen again (rematch votes, names). */
  private showEnd(_result: Outcome): void {
    if (this.online && this.endRoot) this.buildResult()
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

  /** A result panel button was pressed. */
  private onResultAction(action: ResultAction): void {
    if (action === 'next') this.goNext()
    else if (action === 'back') this.goBack()
    else if (action === 'restart') this.restart()
    else if (action === 'rematch') this.voteRematch()
    else if (action === 'lobby') this.go(LOBBY)
    else this.go(MAIN_MENU)
  }

  /** Online end screen: drawn again whenever the room changes (rematch votes). */
  private onlineView(result: Outcome): ResultView {
    const info = this.online!.info
    // The final snapshot's reason and count, or the room's when that snapshot never came.
    const fromRoom = this.client?.latest?.winner == null && info?.result ? info.result : null
    const why = this.client?.latest?.x?.why ?? info?.result?.why
    const cannons = fromRoom && info ? cannonsFromResult(fromRoom, info.sides, this.serverSide) : this.tally()
    const { headline, detail } = endTexts(result, this.me, info, why, cannons)
    const seat = info?.you.seat ?? null
    const player =
      this.me === null
        ? null
        : {
            rematchLine: rematchLine(info),
            otherWants: !!(info && seat !== null && info.rematch[1 - seat]),
            iWant: !!(info && seat !== null && info.rematch[seat]),
            otherHere: !!(info && seat !== null && info.seats[1 - seat]),
          }
    if (DEBUG.enabled) (window as unknown as { __ccResult?: unknown }).__ccResult = { online: true, result, headline, detail, seconds: Math.round(this.sim.clock / 1000) }
    const opponent = info ? (seat === null ? `${nameOnSide(info, 0)} vs ${nameOnSide(info, 1)}` : info.seats[1 - seat]?.name || 'Player ' + (2 - seat)) : null
    return onlineResult({ result, headline, detail, player, brag: { opponent, map: this.level.name, ms: this.sim.clock } })
  }

  private offlineView(result: Outcome): ResultView {
    const campaign = this.levelIndex >= 0
    const seconds = Math.round(this.sim.clock / 1000)
    const stars = result === 'win' && campaign ? this.endStars : 0
    if (DEBUG.enabled) {
      ;(window as unknown as { __ccResult?: unknown }).__ccResult = {
        level: this.level.id,
        result,
        seconds,
        aimsUsed: this.sim.aimsUsed,
        stars,
      }
    }
    const bot = this.botLevel()
    return offlineResult({
      result: result === 'win' ? 'win' : 'lose',
      campaign,
      hasNext: !!this.nextLevel(),
      fromPuzzles: this.from === 'puzzles',
      pvp: !!this.pvp,
      isPuzzle: this.isPuzzle,
      surrendered: this.surrendered,
      endReason: this.sim.endReason,
      seconds,
      aimsUsed: this.sim.aimsUsed,
      countsAims: this.isPuzzle && this.level.aims !== undefined,
      par: this.level.par,
      stars,
      backLabel: this.backLabel(false),
      brag: { opponent: bot ? `${BOTS[bot].name} · ${DIFFICULTY[bot].label}` : null, map: this.level.name, ms: this.sim.clock },
      ...(bot ? { bot: { level: bot, name: BOTS[bot].name, line: this.botSays(bot, result), ...(this.endBadge ? { newBadge: this.endBadge } : {}) } } : {}),
    })
  }

  /** The bot's line for this round: picked once, so a rebuilt panel says the same thing. */
  private botSays(bot: AiLevel, result: Outcome): string {
    this.endLine ??= botLine(bot, botMoment(result === 'win' ? 'win' : 'lose', this.surrendered))
    return this.endLine
  }

  /** The AI playing the other side (vs AI, campaign levels), if there is one. */
  private botLevel(): AiLevel | null {
    if (this.pvp || this.online) return null
    if (!this.level.cannons.some((c) => c.side === 'enemy')) return null
    return this.sim.ais.find((a) => a.side === 'enemy')?.difficulty ?? null
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
    for (const { cannon: c, aim, kind, stop } of this.sim.queuedOrders()) {
      const fires = firesAs(kind ?? c.kind)
      if (stop) {
        // A crossed-out ring by the cannon: it stops aiming when you resume.
        const r = 9
        const sx = c.x + TUNING.cannonRadius + 6
        const sy = c.y - TUNING.cannonRadius - 6
        g.fillStyle(theme.hud, 0.85)
        g.fillCircle(sx, sy, r + 2)
        g.lineStyle(2.5, theme.select, pulse)
        g.strokeCircle(sx, sy, r)
        g.lineBetween(sx - r * 0.7, sy + r * 0.7, sx + r * 0.7, sy - r * 0.7)
      }
      if (aim) {
        if (fires) {
          const end = this.clipAim(c.x, c.y, aim.x, aim.y, walls)
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
    const top = WORLD_VIEW.y + 8
    this.pausedLabel.setY(top + 14)
    g.fillStyle(theme.select, 0.95)
    g.fillRoundedRect(GAME_WIDTH / 2 - w / 2, top, w, 28, 14)
  }

  /** Effects off: the old plain spark circles stand in for the effects' sparks. */
  private get plainSparks(): boolean {
    return !this.vfx || this.vfx.cfg.particles === 0
  }

  /**
   * Effects: move and draw them; the end-of-round sweep once, only when the
   * end is seen as it happens (never after a hidden tab or a catch-up); and,
   * with automatic quality at High, drop to Low if frames keep running slow.
   */
  private updateVfx(delta: number, time: number): void {
    const vfx = this.vfx
    if (!vfx) return
    const now = performance.now()
    const gap = this.lastFrameAt ? now - this.lastFrameAt : 0
    this.lastFrameAt = now
    // Real time (up to 100 ms a frame), so effects keep their timing on a slow device.
    vfx.update(Math.min(delta, 100), time, this.cannons, this.sim.shots, this.fans)
    this.obAuras?.update(time)
    const ended = this.sim.ended
    if (ended && !this.endFxDone) {
      this.endFxDone = true
      if (gap < 400 && !this.catchUp.active && !document.hidden) vfx.end(ended === 'win' ? 'player' : ended === 'lose' ? 'enemy' : null)
    }
    const fx = currentFx()
    if (!fx.auto || fx.quality !== 'high' || ended || this.sim.paused || this.sim.countdown > 0 || gap > 250) {
      if (gap > 250) this.slowWatch.reset()
      return
    }
    if (this.slowWatch.push(delta)) noteSlowDevice()
  }

  /**
   * Target mode: while one of your cannons is selected, the board dims except
   * that cannon, its current target, any cannon aiming at it, and the cannon
   * you are pointing at (the one you'd aim at). Null when nothing is selected.
   */
  private spotlight(): Set<Cannon> | null {
    return this.ended ? null : spotlightSet(this.selected, this.cannons, this.hover)
  }

  /** The dim over the board (eases in and out; at once under Reduce motion). */
  private drawDim(lit: Set<Cannon> | null, dt: number): void {
    const want = lit ? 1 : 0
    this.dimLevel = motionOK() ? moveToward(this.dimLevel, want, dt / DIM.fadeMs) : want
    for (const c of this.cannons) c.spotlit = !!lit?.has(c)
    const d = this.dimFx
    d.clear()
    if (this.dimLevel <= 0) return
    const b = this.board
    d.fillStyle(theme.bg, DIM.alpha * this.dimLevel)
    d.fillRect(b.x - DIM.margin, b.y - DIM.margin, b.w + DIM.margin * 2, b.h + DIM.margin * 2)
  }

  private drawFx(time: number, dt = 16): void {
    const g0 = this.fx
    g0.clear()
    const top = this.fxTop
    top.clear()
    const lit = this.spotlight()
    this.drawDim(lit, dt)
    // Target mode: the selected cannon's lines (and those aiming at it) go above the dim.
    let g = g0
    // Broken walls are gone: aim lines go through where they stood.
    const walls = this.sim.intactWalls

    for (const cannon of this.cannons) {
      if (cannon.side === 'neutral') continue
      // A shield's barrier shows where it faces; no aim line (it doesn't shoot).
      if (!cannon.fires) continue
      const aim = cannon.aim()
      if (!aim) continue
      g = lit && (cannon === this.selected || (lit.has(cannon) && cannon.target === this.selected)) ? top : g0
      const mine = cannon.side === 'player'
      const color = sideColor(cannon.side)
      const alpha = mine ? (cannon.selected ? 0.85 : 0.4) : 0.34
      const end = this.clipAim(cannon.x, cannon.y, aim.x, aim.y, walls)
      const blocked = end.x !== aim.x || end.y !== aim.y
      const endInset = cannon.target && !blocked ? TUNING.cannonRadius + 14 : 4
      if (!this.aimThroughPortal(g, cannon.x, cannon.y, end, walls, TUNING.cannonRadius + 14, color, alpha))
        dash(g, cannon.x, cannon.y, end.x, end.y, TUNING.cannonRadius + 14, endInset, color, alpha)
      if (!cannon.target) {
        crosshair(g, aim.x, aim.y, mine && cannon.selected ? 11 : 8, color, mine ? alpha + 0.1 : alpha)
      }
    }

    // Live preview from the selected cannon to wherever the pointer is (above the dim).
    g = lit ? top : g0
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
        const end = this.clipAim(sel.x, sel.y, hover.x, hover.y, walls)
        const blocked = end.x !== hover.x || end.y !== hover.y
        if (!this.aimThroughPortal(g, sel.x, sel.y, end, walls, haloR() + 2, theme.select, 0.9))
          dash(g, sel.x, sel.y, end.x, end.y, haloR() + 2, blocked ? 4 : haloR() + 2, theme.select, 0.9)
        g.lineStyle(2, theme.select, 0.6 + 0.3 * Math.sin(time / 120))
        g.strokeCircle(hover.x, hover.y, haloR())
      } else if (!this.hover && this.pointer) {
        const end = this.clipAim(sel.x, sel.y, this.pointer.x, this.pointer.y, walls)
        if (!this.aimThroughPortal(g, sel.x, sel.y, end, walls, haloR() + 2, theme.select, 0.55))
          dash(g, sel.x, sel.y, end.x, end.y, haloR() + 2, 4, theme.select, 0.55)
        crosshair(g, this.pointer.x, this.pointer.y, 10, theme.select, 0.75)
      }
    }

    g = g0
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

  /**
   * An aim line that runs into a portal mouth: dashed to the mouth, then on
   * from the linked mouth the way the shot would come out (one hop, as far
   * as the line had left, at least 140 px, up to the next obstacle). False
   * when the line meets no portal (draw it as usual).
   */
  private aimThroughPortal(g: Phaser.GameObjects.Graphics, x: number, y: number, end: Point, walls: WallDef[], startInset: number, color: number, alpha: number): boolean {
    if (!this.mouths.length) return false
    const hit = mouthOnSegment(this.mouths, x, y, end.x, end.y, portalReach(TUNING.shotRadius))
    if (!hit) return false
    const from = this.mouths[hit.k]
    const to = this.mouths[from.to]
    const len = Math.hypot(end.x - x, end.y - y) || 1
    const out = portalExit(from, to, hit.x, hit.y, (end.x - x) / len, (end.y - y) / len)
    const rest = Math.max(140, len * (1 - hit.t))
    // It comes out where it would touch the exit's disc, on the side it is heading for.
    const sx = out.x
    const sy = out.y
    const stop = this.clipAim(sx, sy, sx + out.vx * rest, sy + out.vy * rest, walls)
    dash(g, x, y, hit.x, hit.y, startInset, 2, color, alpha)
    dash(g, sx, sy, stop.x, stop.y, 0, 4, color, alpha * 0.85)
    // Ring both mouths in the pair's colour so the link reads.
    // (on the rim itself: the disc is the mouth, nothing bigger).
    g.lineStyle(2.5, portalColour(from.pair), Math.min(1, alpha + 0.2))
    g.strokeCircle(from.x, from.y, PORTAL.radius - 1.5)
    g.strokeCircle(to.x, to.y, PORTAL.radius - 1.5)
    return true
  }

  /** The aim line stops at the first wall, pillar or solid side of a glass pane. */
  private clipAim(x1: number, y1: number, x2: number, y2: number, walls: WallDef[]): Point {
    const a = clipToWalls(x1, y1, x2, y2, walls)
    const b = clipToPillars(x1, y1, a.x, a.y, this.level.pillars ?? [])
    return clipToGlass(x1, y1, b.x, b.y, this.level.glass ?? [])
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
