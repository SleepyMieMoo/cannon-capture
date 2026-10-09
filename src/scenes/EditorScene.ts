import { DEFAULT_SKIN, vsAiSkins, type SideSkins } from '../config/skins'
import { vsAiColours } from '../config/teamColours'
import { loadColour } from '../menu/colourPref'
import { loadSkin } from '../menu/skinPref'
import { KINDS, KIND_IDS, kindLabel, nextKind } from '../config/kinds'
import Phaser from 'phaser'
import { GAME_HEIGHT, GAME_WIDTH } from '../config/layout'
import { TUNING } from '../config/tuning'
import { applyTeamColours, cssHex, sideColor, theme } from '../config/theme'
import { DEBUG } from '../debug'
import {
  DIFFICULTY,
  LIMITS,
  blankMap,
  decodeShare,
  difficultyOf,
  editorWall,
  encodeShare,
  getMap,
  getMapView,
  loadDraft,
  mapToJson,
  newMapId,
  nextCannonId,
  sanitizeLevel,
  saveDraft,
  saveMap,
  tidyAngle,
  validateMap,
  withDifficulty,
  type Difficulty,
  type MapView,
} from '../editor/maps'
import { Cannon, setRingScale } from '../entities/Cannon'
import { Fan } from '../entities/Fan'
import { Glass } from '../entities/Glass'
import { Pillar } from '../entities/Pillar'
import { Wall } from '../entities/Wall'
import { BRICK, GLASS, PILLAR_OVALS, PILLAR_SIZES, PORTAL, ROCK, VOID_COLOURS, portalColour } from '../config/obstacles'
import { Portal } from '../entities/Portal'
import { exitAngle } from '../sim/portals'
/** How far apart a new portal pair's mouths are placed (px). */
const PORTAL_PAIR_GAP = 220
import { pillarReach } from '../sim/geometry'
import { MAP_SIZES, MAP_SIZE_IDS, boardFor, insideBoard } from '../levels/board'
import { EXAMPLE_MAPS } from '../levels/examples'
import { drawBoardSurface } from '../render/boardSurface'
import { bindSceneResolution } from '../render/resolution'
import { WorldCamera } from '../render/WorldCamera'
import { Overlay, h } from '../ui/overlay'
import type { CannonDef, CannonKind, GlassDef, LevelDef, MapSize, PillarDef, Point, PortalEnd, Rect, Side, WallDef } from '../types'

export interface EditorData {
  /** Open a saved map from My maps. */
  mapId?: string
  /** Start from this map (e.g. an import from My maps). */
  level?: LevelDef
  /** Start a fresh blank map. */
  fresh?: boolean
  /** Coming back from a playtest: keep the working copy. */
  resume?: boolean
}

type Tool = 'select' | 'player' | 'enemy' | 'neutral' | 'wall' | 'void' | 'pillar' | 'glass' | 'portal' | 'fan' | 'delete'
type Popover = 'map' | 'share' | 'help'
type ItemKind = 'cannon' | 'wall' | 'pillar' | 'glass' | 'portal' | 'fan'
interface ItemRef {
  kind: ItemKind
  index: number
}

/** Toolbar + slim context bar across the top; the board gets everything below. */
const TOOLBAR_H = 44
const CONTEXT_H = 34
const TOP = TOOLBAR_H + CONTEXT_H
const VIEW = { x: 0, y: TOP, w: GAME_WIDTH, h: GAME_HEIGHT - TOP }
const GRID = 16
const ROTATE_STEP = Math.PI / 12 // 15 degrees
const UNDO_LIMIT = 120
const deg = (rad: number): number => Math.round((rad * 180) / Math.PI)
const rad = (d: number): number => (d * Math.PI) / 180

const TOOL_TIPS: Record<Tool, string> = {
  select: 'Move: drag things, drag empty space to pan',
  player: 'Place one of your (player) cannons',
  enemy: 'Place an enemy cannon',
  neutral: 'Place a neutral cannon',
  wall: 'Place a wall',
  void: 'Place a void wall (absorbs shots)',
  pillar: 'Place a pillar (a rock: round or oval)',
  glass: 'Place one-way glass',
  portal: 'Place a linked pair of portals',
  fan: 'Place a fan',
  delete: 'Delete tool',
}

/** `side`: drawn in that side's team colour (yours and the AI's pick, see config/teamColours.ts). */
const TOOLS: { id: Tool; label: string; key: string; color?: number; side?: Side }[] = [
  { id: 'select', label: 'Move', key: 'V' },
  { id: 'player', label: 'Yours', key: '1', side: 'player' },
  { id: 'enemy', label: 'Enemy', key: '2', side: 'enemy' },
  { id: 'neutral', label: 'Neutral', key: '3', color: theme.neutral },
  { id: 'wall', label: 'Wall', key: '4', color: theme.wall },
  { id: 'fan', label: 'Fan', key: '5', color: theme.fan },
  { id: 'void', label: 'Void', key: '6', color: VOID_COLOURS.rim },
  { id: 'pillar', label: 'Pillar', key: '7', color: ROCK.light },
  { id: 'glass', label: 'Glass', key: '8', color: GLASS },
  { id: 'portal', label: 'Portal', key: '9', color: PORTAL.colours[0] },
]

export class EditorScene extends Phaser.Scene {
  private level!: LevelDef
  private savedId: string | null = null
  private savedJson = ''
  private tool: Tool = 'select'
  private sel: ItemRef | null = null
  private hover: ItemRef | null = null
  private ghost: Point | null = null
  private snap = true
  private pickingAim = false
  private undoStack: string[] = []
  private redoStack: string[] = []
  private lastMerge = { key: '', at: 0 }

  private wc!: WorldCamera
  private uiCam!: Phaser.Cameras.Scene2D.Camera
  private board: Rect = boardFor(undefined)
  private surface: Phaser.GameObjects.GameObject[] = []
  private cannonViews: Cannon[] = []
  /** Gold in your skin, pink in the one the AI would wear (as in the playtest). */
  private skins: SideSkins = vsAiSkins(DEFAULT_SKIN)
  private wallViews: Wall[] = []
  private pillarViews: Pillar[] = []
  private glassViews: Glass[] = []
  private portalViews: Portal[] = []
  private fanViews: Fan[] = []
  private fx!: Phaser.GameObjects.Graphics

  private drag: { ref: ItemRef; dx: number; dy: number; moved: boolean } | null = null
  private pressOnUi = false
  private startView: MapView | undefined
  private lastViewKey = ''
  private viewSavedAt = 0

  private dom: {
    tools: Map<Tool, HTMLButtonElement>
    props: HTMLDivElement
    mapName: HTMLSpanElement
    status: HTMLSpanElement
    zoomText: HTMLSpanElement
    snap: HTMLButtonElement
    undo: HTMLButtonElement
    redo: HTMLButtonElement
    popBtns: Map<Popover, HTMLButtonElement>
    pops: Map<Popover, Overlay>
    name: HTMLInputElement
    mode: HTMLSelectElement
    aims: HTMLInputElement
    unlimited: HTMLInputElement
    aimsRow: HTMLDivElement
    diff: HTMLSelectElement
    diffRow: HTMLDivElement
    diffNote: HTMLDivElement
    size: HTMLSelectElement
    hint: HTMLInputElement
    issues: HTMLDivElement
    share: HTMLTextAreaElement
    file: HTMLInputElement
  } | null = null
  private propsFor = ''
  private openPop: Popover | null = null
  private statusMsg: { text: string; kind: '' | 'err' | 'ok' } | null = null
  private readonly onKey = (e: KeyboardEvent): void => this.handleKey(e)

  constructor() {
    super('editor')
  }

  init(data: EditorData): void {
    const draft = loadDraft()
    this.undoStack = []
    this.redoStack = []
    this.sel = null
    this.hover = null
    this.tool = 'select'
    this.pickingAim = false
    this.drag = null
    let level: LevelDef
    let savedId: string | null = null
    this.startView = undefined
    if (data?.mapId && getMap(data.mapId)) {
      level = getMap(data.mapId) as LevelDef
      savedId = level.id
      this.startView = getMapView(level.id)
    } else if (data?.level) {
      level = sanitizeLevel(data.level)
      savedId = getMap(level.id) ? level.id : null
    } else if (!data?.fresh && draft) {
      level = draft.level
      savedId = draft.savedId
      this.startView = draft.view
    } else {
      level = blankMap()
    }
    this.level = toEditor(level)
    this.savedId = savedId
    this.savedJson = savedId ? JSON.stringify(sanitizeLevel(getMap(savedId) ?? level)) : ''
  }

  create(): void {
    this.skins = vsAiSkins(loadSkin())
    applyTeamColours(vsAiColours(loadColour()))
    this.surface = []
    this.cannonViews = []
    this.wallViews = []
    this.fanViews = []
    this.pressOnUi = false
    this.propsFor = ''

    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height)
    bindSceneResolution(this, { camera: this.uiCam })
    this.board = boardFor(this.level)
    this.wc = new WorldCamera(this, this.board, VIEW)
    // Back from a playtest or reopening a map: the exact last camera.
    // Otherwise fit the whole board to the screen.
    if (this.startView) this.setView(this.startView)
    else this.wc.fit()
    this.lastViewKey = this.viewKey()

    this.fx = this.world(this.add.graphics().setDepth(7))
    this.buildBar()
    this.rebuildBoard()
    this.renderAll()
    this.refreshPanel(true)

    this.input.on('pointerdown', this.onDown, this)
    this.input.on('pointermove', this.onMove, this)
    this.input.on('pointerup', this.onUp, this)
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => this.wc.wheel(p, dy))
    window.addEventListener('keydown', this.onKey)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', this.onKey)
      this.input.setDefaultCursor('default')
    })
    this.persist()
    if (DEBUG.enabled) (window as unknown as { __ed?: unknown }).__ed = this
  }

  update(time: number, delta: number): void {
    this.wc.update(Math.min(delta, 32))
    // Remember the camera (throttled) so a reload keeps it.
    const key = this.viewKey()
    if (this.dom) {
      const pct = `${Math.round(this.wc.zoom * 100)}%`
      if (this.dom.zoomText.textContent !== pct) this.dom.zoomText.textContent = pct
    }
    if (key !== this.lastViewKey && time - this.viewSavedAt > 400) {
      this.lastViewKey = key
      this.viewSavedAt = time
      this.persist()
    }
    for (const wall of this.wallViews) wall.tick(time, true)
    for (const pane of this.glassViews) pane.draw(time, true)
    for (const portal of this.portalViews) portal.tick(time, true)
    for (const fan of this.fanViews) fan.draw(time)
    setRingScale(this.wc.cssPerWorld())
    this.cannonViews.forEach((c, i) => {
      c.selected = this.sel?.kind === 'cannon' && this.sel.index === i
      c.hovered = !c.selected && this.hover?.kind === 'cannon' && this.hover.index === i
      c.draw(time)
    })
    this.drawFx(time)
  }

  // ---------------------------------------------------------------- cameras

  private world<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.uiCam.ignore(obj)
    return obj
  }

  // ---------------------------------------------------------------- world drawing

  private rebuildBoard(): void {
    this.surface.forEach((o) => o.destroy())
    this.surface = drawBoardSurface(this, this.board).map((o) => this.world(o))
  }

  /** Recreate every item's display objects from the level data. */
  private renderAll(): void {
    this.cannonViews.forEach((c) => c.root?.destroy())
    this.wallViews.forEach((w) => w.destroy())
    this.pillarViews.forEach((p) => p.destroy())
    this.glassViews.forEach((g) => g.destroy())
    this.portalViews.forEach((p) => p.destroy())
    this.fanViews.forEach((f) => f.destroy())
    this.wallViews = this.level.walls.map((w) => {
      const view = new Wall(this, w)
      view.parts.forEach((o) => this.world(o))
      return view
    })
    this.pillarViews = (this.level.pillars ?? []).map((d) => {
      const view = new Pillar(this, d)
      this.world(view.gfx)
      return view
    })
    this.glassViews = (this.level.glass ?? []).map((d) => {
      const view = new Glass(this, d)
      this.world(view.gfx)
      return view
    })
    this.portalViews = (this.level.portals ?? []).flatMap((pair, i) =>
      [pair.a, pair.b].map((end, j) => {
        const view = new Portal(this, end, i, j ? 'b' : 'a')
        view.parts.forEach((o) => this.world(o))
        return view
      }),
    )
    this.fanViews = this.level.fans.map((f) => {
      const view = new Fan(this, f)
      this.world(view.gfx)
      return view
    })
    this.cannonViews = this.level.cannons.map((c) => this.makeCannon(c))
  }

  private makeCannon(def: CannonDef): Cannon {
    const view = new Cannon(this, def.id, def.name, def.x, def.y, def.side, 0, def.kind)
    view.skins = this.skins
    const aim = this.startAim(def)
    if (aim) view.angle = Math.atan2(aim.y - def.y, aim.x - def.x)
    if (view.root) this.world(view.root)
    return view
  }

  private startAim(def: CannonDef): Point | null {
    if (def.aimAt) {
      const t = this.level.cannons.find((c) => c.id === def.aimAt)
      return t ? { x: t.x, y: t.y } : null
    }
    return def.aimPoint ?? null
  }

  /** Cheap update of one item while dragging. */
  private refreshItem(ref: ItemRef): void {
    if (ref.kind === 'cannon') {
      this.cannonViews[ref.index]?.root?.destroy()
      this.cannonViews[ref.index] = this.makeCannon(this.level.cannons[ref.index])
      // Cannons aiming at this one turn with it.
      const id = this.level.cannons[ref.index].id
      this.level.cannons.forEach((c, i) => {
        if (c.aimAt === id) {
          this.cannonViews[i]?.root?.destroy()
          this.cannonViews[i] = this.makeCannon(c)
        }
      })
    } else if (ref.kind === 'wall') {
      const view = this.wallViews[ref.index]
      view?.set(this.level.walls[ref.index])
      view?.parts.forEach((o) => this.world(o))
    } else if (ref.kind === 'pillar') {
      this.pillarViews[ref.index]?.set(this.level.pillars![ref.index])
    } else if (ref.kind === 'glass') {
      this.glassViews[ref.index]?.set(this.level.glass![ref.index])
    } else if (ref.kind === 'portal') {
      this.portalViews[ref.index]?.set(this.portalEnd(ref.index))
    } else {
      const f = this.level.fans[ref.index]
      const field = this.fanViews[ref.index]?.field
      if (field) Object.assign(field, { x: f.x, y: f.y, radius: f.radius, angle: f.angle, force: f.force ?? TUNING.fanForce })
    }
  }

  private drawFx(time: number): void {
    const g = this.fx
    g.clear()
    const z = 1 / this.wc.zoom
    // Starting aims.
    for (const c of this.level.cannons) {
      const aim = this.startAim(c)
      if (!aim) continue
      dashed(g, c.x, c.y, aim.x, aim.y, sideColor(c.side), 0.55, TUNING.cannonRadius + 12, c.aimAt ? TUNING.cannonRadius + 12 : 4)
      if (!c.aimAt) {
        g.lineStyle(2, sideColor(c.side), 0.7)
        g.strokeCircle(aim.x, aim.y, 8)
      }
    }
    const outline = (ref: ItemRef, color: number, alpha: number): void => {
      g.lineStyle(2 * Math.max(1, z * 0.8), color, alpha)
      if (ref.kind === 'wall') {
        const w = this.level.walls[ref.index]
        strokeRotated(g, w, 6)
      } else if (ref.kind === 'pillar') {
        strokeOval(g, this.level.pillars![ref.index], 6)
      } else if (ref.kind === 'glass') {
        strokeRotated(g, glassBox(this.level.glass![ref.index]), 6)
      } else if (ref.kind === 'portal') {
        // The selected mouth, and a faint line to its twin.
        const e = this.portalEnd(ref.index)
        const twin = this.portalEnd(ref.index ^ 1)
        g.strokeCircle(e.x, e.y, PORTAL.radius + 8)
        g.lineStyle(1.5, portalColour(ref.index >> 1), alpha * 0.5)
        g.strokeCircle(twin.x, twin.y, PORTAL.radius + 8)
        dashed(g, e.x, e.y, twin.x, twin.y, portalColour(ref.index >> 1), alpha * 0.45, PORTAL.radius + 10, PORTAL.radius + 10)
      } else if (ref.kind === 'fan') {
        const f = this.level.fans[ref.index]
        g.strokeCircle(f.x, f.y, 30)
        g.lineStyle(1.5, color, alpha * 0.6)
        g.strokeCircle(f.x, f.y, f.radius)
      }
    }
    if (this.hover && !(this.sel && same(this.hover, this.sel)) && this.hover.kind !== 'cannon') outline(this.hover, 0xffffff, 0.45)
    if (this.sel && this.sel.kind !== 'cannon') outline(this.sel, theme.select, 0.6 + 0.35 * Math.sin(time / 140))

    // Placement preview.
    const p = this.ghost
    if (p && !this.hover && !this.drag) {
      if (this.pickingAim && this.sel?.kind === 'cannon') {
        const c = this.level.cannons[this.sel.index]
        dashed(g, c.x, c.y, p.x, p.y, theme.select, 0.8, TUNING.cannonRadius + 12, 4)
        g.lineStyle(2, theme.select, 0.9)
        g.strokeCircle(p.x, p.y, 10)
      } else if (this.tool === 'player' || this.tool === 'enemy' || this.tool === 'neutral') {
        g.fillStyle(sideColor(this.tool), 0.35)
        g.fillCircle(p.x, p.y, TUNING.cannonRadius)
      } else if (this.tool === 'wall' || this.tool === 'void') {
        g.fillStyle(this.tool === 'void' ? VOID_COLOURS.rim : theme.wall, 0.4)
        g.fillRect(p.x - 110, p.y - 13, 220, 26)
      } else if (this.tool === 'pillar') {
        g.fillStyle(ROCK.base, 0.5)
        g.fillCircle(p.x, p.y, PILLAR_SIZES[1])
      } else if (this.tool === 'glass') {
        g.lineStyle(6, GLASS, 0.45)
        g.lineBetween(p.x - 100, p.y, p.x + 100, p.y)
      } else if (this.tool === 'portal') {
        const col = portalColour((this.level.portals ?? []).length)
        g.lineStyle(3, col, 0.5)
        g.strokeCircle(p.x, p.y, PORTAL.radius)
        g.strokeCircle(p.x + PORTAL_PAIR_GAP, p.y, PORTAL.radius)
        dashed(g, p.x, p.y, p.x + PORTAL_PAIR_GAP, p.y, col, 0.35, PORTAL.radius + 4, PORTAL.radius + 4)
      } else if (this.tool === 'fan') {
        g.lineStyle(2, theme.fan, 0.45)
        g.strokeCircle(p.x, p.y, 140)
        g.fillStyle(theme.fan, 0.4)
        g.fillCircle(p.x, p.y, 14)
      }
    }
  }

  // ---------------------------------------------------------------- hit testing

  private itemAt(x: number, y: number): ItemRef | null {
    const cs = this.level.cannons
    let best: ItemRef | null = null
    let bestD = TUNING.cannonRadius + 8
    cs.forEach((c, i) => {
      const d = Math.hypot(c.x - x, c.y - y)
      if (d <= bestD) {
        best = { kind: 'cannon', index: i }
        bestD = d
      }
    })
    if (best) return best
    for (let i = this.level.fans.length - 1; i >= 0; i--) {
      const f = this.level.fans[i]
      if (Math.hypot(f.x - x, f.y - y) <= 28) return { kind: 'fan', index: i }
    }
    const portals = this.level.portals ?? []
    for (let i = portals.length * 2 - 1; i >= 0; i--) {
      const e = this.portalEnd(i)
      if (Math.hypot(e.x - x, e.y - y) <= PORTAL.radius + 4) return { kind: 'portal', index: i }
    }
    const glass = this.level.glass ?? []
    for (let i = glass.length - 1; i >= 0; i--) {
      if (inWall(glassBox(glass[i]), x, y, 8)) return { kind: 'glass', index: i }
    }
    const pillars = this.level.pillars ?? []
    for (let i = pillars.length - 1; i >= 0; i--) {
      if (inOval(pillars[i], x, y, 6)) return { kind: 'pillar', index: i }
    }
    for (let i = this.level.walls.length - 1; i >= 0; i--) {
      if (inWall(this.level.walls[i], x, y, 6)) return { kind: 'wall', index: i }
    }
    return null
  }

  private snapPoint(x: number, y: number): Point {
    if (!this.snap) return { x: Math.round(x), y: Math.round(y) }
    const b = this.board
    return { x: b.x + Math.round((x - b.x) / GRID) * GRID, y: b.y + Math.round((y - b.y) / GRID) * GRID }
  }

  private clampCenter(p: Point, pad: number): Point {
    const b = this.board
    return {
      x: Phaser.Math.Clamp(p.x, b.x + pad, b.x + b.w - pad),
      y: Phaser.Math.Clamp(p.y, b.y + pad, b.y + b.h - pad),
    }
  }

  private centerOf(ref: ItemRef): Point {
    if (ref.kind === 'wall') {
      const w = this.level.walls[ref.index]
      return { x: w.x + w.w / 2, y: w.y + w.h / 2 }
    }
    if (ref.kind === 'pillar') {
      const p = this.level.pillars![ref.index]
      return { x: p.x, y: p.y }
    }
    if (ref.kind === 'glass') {
      const g = this.level.glass![ref.index]
      return { x: (g.x + g.x2) / 2, y: (g.y + g.y2) / 2 }
    }
    if (ref.kind === 'portal') {
      const e = this.portalEnd(ref.index)
      return { x: e.x, y: e.y }
    }
    const item = ref.kind === 'cannon' ? this.level.cannons[ref.index] : this.level.fans[ref.index]
    return { x: item.x, y: item.y }
  }

  private moveItem(ref: ItemRef, to: Point): void {
    if (ref.kind === 'wall') {
      const w = this.level.walls[ref.index]
      const c = this.clampCenter(to, 0)
      w.x = Math.round(c.x - w.w / 2)
      w.y = Math.round(c.y - w.h / 2)
    } else if (ref.kind === 'pillar') {
      const p = this.level.pillars![ref.index]
      const c = this.clampCenter(to, pillarReach(p))
      p.x = Math.round(c.x)
      p.y = Math.round(c.y)
    } else if (ref.kind === 'portal') {
      const e = this.portalEnd(ref.index)
      const c = this.clampCenter(to, PORTAL.radius)
      e.x = Math.round(c.x)
      e.y = Math.round(c.y)
    } else if (ref.kind === 'glass') {
      const g = this.level.glass![ref.index]
      const c = this.clampCenter(to, 0)
      const hx = (g.x2 - g.x) / 2
      const hy = (g.y2 - g.y) / 2
      g.x = Math.round(c.x - hx)
      g.y = Math.round(c.y - hy)
      g.x2 = Math.round(c.x + hx)
      g.y2 = Math.round(c.y + hy)
    } else {
      const item = ref.kind === 'cannon' ? this.level.cannons[ref.index] : this.level.fans[ref.index]
      const c = this.clampCenter(to, TUNING.cannonRadius + 4)
      item.x = Math.round(c.x)
      item.y = Math.round(c.y)
    }
  }

  // ---------------------------------------------------------------- pointer

  private worldAt(pointer: Phaser.Input.Pointer): Point {
    return this.wc.toWorld(pointer.x, pointer.y)
  }

  private onDown(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    this.pressOnUi = (over && over.length > 0) || !this.wc.inView(pointer.x, pointer.y)
    if (this.pressOnUi) return
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    this.togglePop(null)
    const p = this.worldAt(pointer)
    const hit = this.pickingAim || this.tool === 'delete' ? null : this.itemAt(p.x, p.y)
    if (hit) {
      // Grab: drag moves the item, a click just selects it.
      this.select(hit)
      const c = this.centerOf(hit)
      this.drag = { ref: hit, dx: c.x - p.x, dy: c.y - p.y, moved: false }
      this.wc.down(pointer, false)
      return
    }
    this.wc.down(pointer, true)
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    const moving = this.wc.move(pointer)
    if (this.drag) {
      if (!moving) return
      const p = this.worldAt(pointer)
      if (!this.drag.moved) {
        this.drag.moved = true
        this.pushUndo('drag')
      }
      this.moveItem(this.drag.ref, this.snapPoint(p.x + this.drag.dx, p.y + this.drag.dy))
      this.refreshItem(this.drag.ref)
      this.input.setDefaultCursor('grabbing')
      return
    }
    if (moving) {
      this.hover = null
      this.ghost = null
      this.input.setDefaultCursor('grabbing')
      return
    }
    if (!this.wc.inView(pointer.x, pointer.y)) {
      this.hover = null
      this.ghost = null
      this.input.setDefaultCursor('default')
      return
    }
    const p = this.worldAt(pointer)
    this.hover = this.pickingAim ? null : this.itemAt(p.x, p.y)
    this.ghost = insideBoard(this.board, p.x, p.y) && !pointer.wasTouch ? this.snapPoint(p.x, p.y) : null
    if (this.pickingAim) this.ghost = insideBoard(this.board, p.x, p.y) ? { x: p.x, y: p.y } : null
    const cursor = this.pickingAim
      ? 'crosshair'
      : this.hover
        ? this.tool === 'delete'
          ? 'not-allowed'
          : 'grab'
        : this.tool !== 'select' && this.tool !== 'delete' && this.ghost
          ? 'copy'
          : 'default'
    this.input.setDefaultCursor(cursor)
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    const gesture = this.wc.up(pointer)
    if (this.pressOnUi) {
      this.pressOnUi = false
      return
    }
    const drag = this.drag
    this.drag = null
    if (drag) {
      if (drag.moved) this.afterChange(false)
      this.input.setDefaultCursor('grab')
      return
    }
    if (gesture !== 'click') return
    this.onClick(this.worldAt(pointer))
  }

  private onClick(p: Point): void {
    if (this.pickingAim) {
      this.setAimFromClick(p)
      return
    }
    if (this.tool === 'delete') {
      const hit = this.itemAt(p.x, p.y)
      if (hit) this.deleteItem(hit)
      return
    }
    if (!insideBoard(this.board, p.x, p.y)) {
      this.select(null)
      return
    }
    if (this.tool === 'select') {
      this.select(null)
      return
    }
    this.place(this.tool, this.snapPoint(p.x, p.y))
  }

  // ---------------------------------------------------------------- edits

  /** Record the current state for undo. Rapid edits with the same key merge. */
  private pushUndo(mergeKey = ''): void {
    const now = performance.now()
    if (mergeKey && mergeKey === this.lastMerge.key && now - this.lastMerge.at < 900) {
      this.lastMerge.at = now
      return
    }
    this.lastMerge = { key: mergeKey, at: now }
    this.undoStack.push(JSON.stringify(this.level))
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
    this.redoStack = []
  }

  /** Apply an edit: snapshot for undo, mutate, redraw, save the draft. */
  private edit(fn: () => void, opts: { merge?: string; rebuild?: boolean } = {}): void {
    this.pushUndo(opts.merge ?? '')
    fn()
    this.afterChange(opts.rebuild ?? true)
  }

  private afterChange(rebuild: boolean): void {
    if (rebuild) this.renderAll()
    this.persist()
    this.refreshPanel(false)
  }

  private persist(): void {
    saveDraft(this.level, this.savedId, this.view())
  }

  /** The current camera, as stored with the draft / saved map. */
  view(): MapView {
    return { zoom: this.wc.zoom, x: this.wc.center.x, y: this.wc.center.y }
  }

  private setView(v: MapView): void {
    this.wc.zoom = v.zoom
    this.wc.center = { x: v.x, y: v.y }
    this.wc.apply()
  }

  private viewKey(): string {
    return `${this.wc.zoom.toFixed(4)},${this.wc.center.x.toFixed(1)},${this.wc.center.y.toFixed(1)}`
  }

  private restore(json: string): void {
    this.level = JSON.parse(json) as LevelDef
    this.sel = null
    this.hover = null
    this.pickingAim = false
    this.applyBoard()
    this.renderAll()
    this.persist()
    this.refreshPanel(true)
  }

  undo(): void {
    const prev = this.undoStack.pop()
    if (!prev) return this.status('Nothing to undo.')
    this.redoStack.push(JSON.stringify(this.level))
    this.lastMerge = { key: '', at: 0 }
    this.restore(prev)
  }

  redo(): void {
    const next = this.redoStack.pop()
    if (!next) return this.status('Nothing to redo.')
    this.undoStack.push(JSON.stringify(this.level))
    this.restore(next)
  }

  private place(tool: Tool, p: Point): void {
    const L = this.level
    if (tool === 'player' || tool === 'enemy' || tool === 'neutral') {
      if (L.cannons.length >= LIMITS.cannons) return this.status(`Maps can have up to ${LIMITS.cannons} cannons.`, true)
      const near = L.cannons.find((c) => Math.hypot(c.x - p.x, c.y - p.y) < TUNING.cannonRadius * 2 + 4)
      if (near) return this.status('Too close to another cannon.', true)
      const id = nextCannonId(tool, L.cannons.map((c) => c.id))
      const c = this.clampCenter(p, TUNING.cannonRadius + 4)
      this.edit(() => L.cannons.push({ id, name: id.toUpperCase(), x: Math.round(c.x), y: Math.round(c.y), side: tool }))
      this.select({ kind: 'cannon', index: L.cannons.length - 1 })
    } else if (tool === 'wall' || tool === 'void') {
      if (L.walls.length >= LIMITS.walls) return this.status(`Maps can have up to ${LIMITS.walls} walls.`, true)
      const c = this.clampCenter(p, 0)
      const wall: WallDef = { x: Math.round(c.x - 110), y: Math.round(c.y - 13), w: 220, h: 26 }
      if (tool === 'void') wall.kind = 'void'
      this.edit(() => L.walls.push(wall))
      this.select({ kind: 'wall', index: L.walls.length - 1 })
    } else if (tool === 'pillar') {
      const list = (L.pillars ??= [])
      if (list.length >= LIMITS.pillars) return this.status(`Maps can have up to ${LIMITS.pillars} pillars.`, true)
      const r: number = PILLAR_SIZES[1]
      const c = this.clampCenter(p, r)
      this.edit(() => (L.pillars ??= []).push({ x: Math.round(c.x), y: Math.round(c.y), r }))
      this.select({ kind: 'pillar', index: L.pillars!.length - 1 })
    } else if (tool === 'glass') {
      const list = (L.glass ??= [])
      if (list.length >= LIMITS.glass) return this.status(`Maps can have up to ${LIMITS.glass} glass panes.`, true)
      const c = this.clampCenter(p, 0)
      this.edit(() => (L.glass ??= []).push({ x: Math.round(c.x - 100), y: Math.round(c.y), x2: Math.round(c.x + 100), y2: Math.round(c.y) }))
      this.select({ kind: 'glass', index: L.glass!.length - 1 })
    } else if (tool === 'portal') {
      const list = L.portals ?? []
      if (list.length >= PORTAL.maxPairs) return this.status(`Maps can have up to ${PORTAL.maxPairs} portal pairs.`, true)
      // The pair side by side (the second to the left if there is no room on the right).
      const a = this.clampCenter(p, PORTAL.radius)
      const room = a.x + PORTAL_PAIR_GAP <= this.board.x + this.board.w - PORTAL.radius
      const b = this.clampCenter({ x: a.x + (room ? PORTAL_PAIR_GAP : -PORTAL_PAIR_GAP), y: a.y }, PORTAL.radius)
      this.edit(() => (L.portals ??= []).push({ a: { x: Math.round(a.x), y: Math.round(a.y), angle: 0 }, b: { x: Math.round(b.x), y: Math.round(b.y), angle: 0 } }))
      this.select({ kind: 'portal', index: (L.portals!.length - 1) * 2 + 1 })
      this.status('Portal pair placed: drag either mouth; Q/E turns the selected one.', false, true)
    } else if (tool === 'fan') {
      if (L.fans.length >= LIMITS.fans) return this.status(`Maps can have up to ${LIMITS.fans} fans.`, true)
      const c = this.clampCenter(p, TUNING.cannonRadius + 4)
      this.edit(() => L.fans.push({ x: Math.round(c.x), y: Math.round(c.y), radius: 140, angle: -Math.PI / 2, force: TUNING.fanForce }))
      this.select({ kind: 'fan', index: L.fans.length - 1 })
    }
  }

  private deleteItem(ref: ItemRef): void {
    this.edit(() => {
      if (ref.kind === 'cannon') {
        const [gone] = this.level.cannons.splice(ref.index, 1)
        for (const c of this.level.cannons) if (c.aimAt === gone.id) delete c.aimAt
      } else if (ref.kind === 'wall') this.level.walls.splice(ref.index, 1)
      else if (ref.kind === 'pillar') this.level.pillars?.splice(ref.index, 1)
      else if (ref.kind === 'glass') this.level.glass?.splice(ref.index, 1)
      else if (ref.kind === 'portal') {
        // A mouth never stands alone: the pair goes together.
        this.level.portals?.splice(ref.index >> 1, 1)
        if (!this.level.portals?.length) delete this.level.portals
      } else this.level.fans.splice(ref.index, 1)
    })
    this.sel = null
    this.hover = null
    this.pickingAim = false
    this.refreshPanel(true)
  }

  private setAimFromClick(p: Point): void {
    const ref = this.sel
    this.pickingAim = false
    if (!ref || ref.kind !== 'cannon') return
    const me = this.level.cannons[ref.index]
    const hit = this.itemAt(p.x, p.y)
    const target = hit?.kind === 'cannon' ? this.level.cannons[hit.index] : null
    if (target === me) {
      this.refreshPanel(true)
      return
    }
    if (!target && !insideBoard(this.board, p.x, p.y)) {
      this.refreshPanel(true)
      return this.status('Aim cancelled.')
    }
    this.edit(() => {
      if (target) {
        me.aimAt = target.id
        delete me.aimPoint
      } else {
        delete me.aimAt
        me.aimPoint = { x: Math.round(p.x), y: Math.round(p.y) }
      }
    })
    this.refreshPanel(true)
  }

  private select(ref: ItemRef | null): void {
    this.sel = ref
    if (!ref) this.pickingAim = false

    this.refreshPanel(false)
  }

  private setTool(tool: Tool): void {
    this.tool = tool
    this.pickingAim = false
    this.refreshPanel(false)
  }

  private rotateSelected(dir: number): void {
    const ref = this.sel
    if (!ref || ref.kind === 'cannon') return
    // A round pillar looks the same at any turn.
    if (ref.kind === 'pillar' && !isOvalPillar(this.level.pillars![ref.index])) return
    this.edit(
      () => {
        if (ref.kind === 'pillar') {
          const p = this.level.pillars![ref.index]
          const a = normAngle(Math.round(((p.angle ?? 0) + dir * ROTATE_STEP) / ROTATE_STEP) * ROTATE_STEP, Math.PI)
          if (a > 1e-3 && a < Math.PI - 1e-3) p.angle = a
          else delete p.angle
          const c = this.clampCenter(p, pillarReach(p))
          p.x = Math.round(c.x)
          p.y = Math.round(c.y)
        } else if (ref.kind === 'portal') {
          const e = this.portalEnd(ref.index)
          e.angle = tidyAngle(Math.round((e.angle + dir * ROTATE_STEP) / ROTATE_STEP) * ROTATE_STEP)
        } else if (ref.kind === 'glass') {
          const g = this.level.glass![ref.index]
          setGlassAngle(g, Math.round((glassAngle(g) + dir * ROTATE_STEP) / ROTATE_STEP) * ROTATE_STEP)
        } else if (ref.kind === 'wall') {
          const w = this.level.walls[ref.index]
          w.angle = normAngle(Math.round(((w.angle ?? 0) + dir * ROTATE_STEP) / ROTATE_STEP) * ROTATE_STEP, Math.PI)
        } else {
          const f = this.level.fans[ref.index]
          f.angle = normAngle(Math.round((f.angle + dir * ROTATE_STEP) / ROTATE_STEP) * ROTATE_STEP, Math.PI * 2)
        }
      },
      { merge: `rot-${ref.kind}-${ref.index}`, rebuild: false },
    )
    this.refreshItem(ref)
    this.refreshPanel(true)
  }

  private applyBoard(): void {
    this.board = boardFor(this.level)
    this.wc.setBoard(this.board)
    this.rebuildBoard()
  }

  private setSize(size: MapSize): void {
    if (size === (this.level.size ?? 'small')) return
    this.edit(() => {
      this.level.size = size
      this.board = boardFor(size)
      // Keep everything on the (possibly smaller) board.
      this.level.cannons.forEach((_, i) => this.moveItem({ kind: 'cannon', index: i }, this.centerOf({ kind: 'cannon', index: i })))
      this.level.fans.forEach((_, i) => this.moveItem({ kind: 'fan', index: i }, this.centerOf({ kind: 'fan', index: i })))
      this.level.walls.forEach((_, i) => this.moveItem({ kind: 'wall', index: i }, this.centerOf({ kind: 'wall', index: i })))
      this.level.pillars?.forEach((_, i) => this.moveItem({ kind: 'pillar', index: i }, this.centerOf({ kind: 'pillar', index: i })))
      this.level.glass?.forEach((_, i) => this.moveItem({ kind: 'glass', index: i }, this.centerOf({ kind: 'glass', index: i })))
      for (let i = 0; i < (this.level.portals?.length ?? 0) * 2; i++) this.moveItem({ kind: 'portal', index: i }, this.centerOf({ kind: 'portal', index: i }))
      for (const c of this.level.cannons) {
        if (c.aimPoint) c.aimPoint = this.clampCenter(c.aimPoint, 0)
      }
    })
    this.applyBoard()
    this.wc.fit()
    this.status(`Map size: ${MAP_SIZES[size].label} (${this.board.w}×${this.board.h}).`, false, true)
  }

  private replaceLevel(level: LevelDef, savedId: string | null, message: string): void {
    this.pushUndo()
    this.level = toEditor(level)
    this.savedId = savedId
    this.savedJson = savedId ? JSON.stringify(sanitizeLevel(level)) : ''
    this.sel = null
    this.pickingAim = false
    this.applyBoard()
    this.wc.fit()
    this.afterChange(true)
    this.refreshPanel(true)
    this.status(message, false, true)
  }

  // ---------------------------------------------------------------- actions

  private playLevel(): LevelDef {
    return sanitizeLevel(this.level)
  }

  playtest(): void {
    const problems = validateMap(this.level)
    if (problems.length) return this.status(problems.join(' '), true)
    this.persist()
    // Playtest starts where the editor camera is (clamped to play's limits).
    this.scene.start('battle', { custom: this.playLevel(), from: 'editor', view: this.view() })
  }

  save(asCopy = false): void {
    if (asCopy) {
      this.level.id = newMapId()
      this.level.name = `${this.level.name} copy`.slice(0, LIMITS.name)
    }
    const stored = saveMap(this.level, this.view())
    this.savedId = stored.id
    this.savedJson = JSON.stringify(stored)
    this.persist()
    this.refreshPanel(true)
    const problems = validateMap(this.level)
    this.status(
      `Saved "${stored.name}" to My maps.${problems.length ? ' (Not playable yet: ' + problems[0] + ')' : ''}`,
      false,
      true,
    )
  }

  private get dirty(): boolean {
    return !this.savedId || JSON.stringify(this.playLevel()) !== this.savedJson
  }

  private shareCode(): void {
    if (!this.dom) return
    this.dom.share.value = encodeShare(this.level)
    this.dom.share.select()
    navigator.clipboard?.writeText(this.dom.share.value).then(
      () => this.status('Share code copied. Anyone can paste it into Import.', false, true),
      () => this.status('Share code ready: copy it from the box above.', false, true),
    ) ?? this.status('Share code ready: copy it from the box above.', false, true)
  }

  private importCode(text: string): void {
    try {
      const level = decodeShare(text)
      level.id = newMapId()
      this.replaceLevel(level, null, `Imported "${level.name}". Undo (Ctrl+Z) brings your previous map back.`)
    } catch (err) {
      this.status((err as Error).message, true)
    }
  }

  private download(): void {
    const json = mapToJson(this.level)
    const blob = new Blob([json + '\n'], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${slug(this.level.name)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    this.status(`Downloaded ${a.download}.`, false, true)
  }

  private upload(file: File): void {
    file.text().then(
      (text) => this.importCode(text),
      () => this.status('Could not read that file.', true),
    )
  }

  private back(): void {
    this.persist()
    this.scene.start('title')
  }

  // ---------------------------------------------------------------- keyboard

  private handleKey(e: KeyboardEvent): void {
    const el = document.activeElement
    const typing = !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') {
      if (typing) return
      e.preventDefault()
      if (e.shiftKey) this.redo()
      else this.undo()
      return
    }
    if (mod && e.key.toLowerCase() === 'y') {
      if (typing) return
      e.preventDefault()
      this.redo()
      return
    }
    if (typing || mod) return
    const key = e.key
    if (key === 'Escape') {
      if (this.openPop) this.togglePop(null)
      else if (this.pickingAim) {
        this.pickingAim = false
        this.refreshPanel(true)
      } else this.select(null)
    } else if ((key === 'Delete' || key === 'Backspace') && this.sel) {
      e.preventDefault()
      this.deleteItem(this.sel)
    } else if (key === 'q' || key === 'Q') this.rotateSelected(-1)
    else if (key === 'e' || key === 'E') this.rotateSelected(1)
    else if (key === 'g' || key === 'G') {
      this.snap = !this.snap
      this.refreshPanel(false)
    } else if (key === 'v' || key === 'V') this.setTool('select')
    else if (key === 'x' || key === 'X') this.setTool('delete')
    else if (key === 'p' || key === 'P') this.playtest()
    else if ((key === 't' || key === 'T') && this.sel?.kind === 'cannon') this.cycleKind(this.sel.index)
    else if ((key === 'f' || key === 'F') && this.sel?.kind === 'glass') this.flipGlass(this.sel.index)
    else if ((key === '[' || key === ']') && this.sel?.kind === 'pillar') this.resizePillar(this.sel.index, key === ']' ? 4 : -4, 0)
    else if ((key === '{' || key === '}') && this.sel?.kind === 'pillar') this.resizePillar(this.sel.index, 0, key === '}' ? 4 : -4)
    else if (key === '+' || key === '=') this.wc.zoomBy(1.25)
    else if (key === '-' || key === '_') this.wc.zoomBy(0.8)
    else if (key === '0') this.wc.fit()
    else {
      const tool = TOOLS.find((t) => t.key === key)
      if (tool) this.setTool(tool.id)
    }
  }

  // ---------------------------------------------------------------- top bar (DOM)

  private buildBar(): void {
    const bar = new Overlay(this, { x: 0, y: 0, w: GAME_WIDTH, h: TOP }, 'cc-bar')

    const tools = new Map<Tool, HTMLButtonElement>()
    const toolGroup = h('div.cc-group')
    for (const t of TOOLS) {
      const btn = h(
        'button.cc-btn.sm',
        { title: `${TOOL_TIPS[t.id]} (${t.key})`, onclick: () => this.setTool(t.id) },
        t.side ? dot(sideColor(t.side)) : t.color !== undefined ? dot(t.color) : null,
        // A dotted tool can drop its word when the bar is too narrow (wider system fonts): see fitToolbar.
        t.side || t.color !== undefined ? h('span.cc-lbl', {}, t.label) : t.label,
      )
      tools.set(t.id, btn)
      toolGroup.append(btn)
    }
    const del = h('button.cc-btn.sm.danger', { title: 'Delete tool: click things to remove them (X)', onclick: () => this.setTool('delete') }, 'Delete')
    tools.set('delete', del)
    toolGroup.append(del)

    const undo = h('button.cc-btn.sm.icon', { title: 'Undo (Ctrl+Z)', onclick: () => this.undo() }, '↶')
    const redo = h('button.cc-btn.sm.icon', { title: 'Redo (Ctrl+Shift+Z)', onclick: () => this.redo() }, '↷')
    const snap = h('button.cc-btn.sm.icon', { title: `Snap to a ${GRID}px grid (G)`, onclick: () => {
      this.snap = !this.snap
      this.refreshPanel(false)
    } }, '▦')

    const popBtns = new Map<Popover, HTMLButtonElement>()
    const popBtn = (id: Popover, label: string, title: string): HTMLButtonElement => {
      const btn = h('button.cc-btn.sm', { title, onclick: () => this.togglePop(id) }, label)
      popBtns.set(id, btn)
      return btn
    }

    const toolbar = h('div.cc-toolbar', {},
      toolGroup,
      h('div.cc-group', {}, undo, redo, snap),
      h('div.cc-group', {},
        popBtn('map', 'Map ▾', 'Name, mode, AI, size and hint'),
        popBtn('share', 'Share ▾', 'Share code, import, .json files'),
        popBtn('help', '?', 'Controls and keys'),
      ),
      h('div.cc-spacer'),
      h('div.cc-group', {},
        h('button.cc-btn.sm.primary', { title: 'Play this map now (P)', onclick: () => this.playtest() }, '▶ Play'),
        h('button.cc-btn.sm', { title: 'Save to My maps', onclick: () => this.save() }, 'Save'),
        h('button.cc-btn.sm', { title: 'All your saved maps', onclick: () => {
          this.persist()
          this.scene.start('maps')
        } }, 'My maps'),
        h('button.cc-btn.sm', { title: 'Back to the title screen', onclick: () => this.back() }, 'Menu'),
      ),
    )

    const mapName = h('span.cc-name')
    const props = h('div.cc-props')
    const status = h('span.cc-status')
    const zoomText = h('span.cc-val', { style: 'min-width:40px;text-align:center', title: 'Zoom' }, '100%')
    const zoom = h('span.cc-field', {},
      h('button.cc-btn.xs', { title: 'Zoom out (− or wheel)', onclick: () => this.wc.zoomBy(0.8) }, '−'),
      zoomText,
      h('button.cc-btn.xs', { title: 'Zoom in (+ or wheel)', onclick: () => this.wc.zoomBy(1.25) }, '+'),
      h('button.cc-btn.xs', { title: 'Fit the whole board (0)', onclick: () => this.wc.fit() }, 'Fit'),
    )
    const context = h('div.cc-context', {}, mapName, h('span.cc-vsep'), props, h('div.cc-spacer'), status, h('span.cc-vsep'), zoom)
    bar.el.append(toolbar, context)

    // ---- popovers (fixed size, never scroll)
    const name = h('input.cc-in', { maxLength: LIMITS.name, value: this.level.name, oninput: () => {
      this.edit(() => (this.level.name = name.value.slice(0, LIMITS.name) || 'My map'), { merge: 'name', rebuild: false })
    } })
    const unlimited = h('input', { type: 'checkbox' })
    const mode = h(
      'select.cc-sel',
      { onchange: () => this.edit(() => {
        this.level.kind = mode.value === 'puzzle' ? 'puzzle' : 'battle'
        if (this.level.kind === 'battle') delete this.level.aims
        else if (this.level.aims === undefined && !unlimited.checked) this.level.aims = 3
      }, { rebuild: false }) },
      h('option', { value: 'battle' }, 'Battle (beat the AI)'),
      h('option', { value: 'puzzle' }, 'Puzzle (aim budget)'),
    )
    const aims = h('input.cc-in.num', { type: 'number', min: 1, max: 99, value: 3, oninput: () => {
      const n = Math.round(Number(aims.value))
      if (n >= 1 && n <= 99) this.edit(() => (this.level.aims = n), { merge: 'aims', rebuild: false })
    } })
    unlimited.addEventListener('change', () => this.edit(() => {
      if (unlimited.checked) delete this.level.aims
      else this.level.aims = Math.max(1, Math.round(Number(aims.value)) || 3)
    }, { rebuild: false }))
    const aimsRow = h('div.cc-row', {}, h('label', {}, 'Aims'), aims, h('label.cc-check', {}, unlimited, 'Unlimited'))
    const diff = h(
      'select.cc-sel',
      { onchange: () => this.edit(() => (this.level = withDifficulty(this.level, diff.value as Difficulty)), { rebuild: false }) },
      ...(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => h('option', { value: d, title: DIFFICULTY[d].blurb }, DIFFICULTY[d].label)),
    )
    // Difficulty is how smart pink plays; every level fires and turns like you.
    const diffNote = h('div.cc-note', { style: 'margin:-2px 0 6px' }, '')
    const diffRow = h('div', {}, h('div.cc-row', {}, h('label', {}, 'AI'), diff), diffNote)
    const size = h(
      'select.cc-sel',
      { onchange: () => this.setSize(size.value as MapSize) },
      ...MAP_SIZE_IDS.map((sz) => {
        const b = boardFor(sz)
        return h('option', { value: sz }, `${MAP_SIZES[sz].label}  ·  ${b.w}×${b.h}`)
      }),
    )
    const hint = h('input.cc-in', { maxLength: 160, placeholder: 'Optional, shown when the map starts', oninput: () => {
      this.edit(() => {
        const v = hint.value.trim()
        if (v) this.level.hint = v.slice(0, 160)
        else delete this.level.hint
      }, { merge: 'hint', rebuild: false })
    } })
    const issues = h('div.cc-msg.err')
    // Example boards for the newer obstacles: opens a copy (yours to change and save).
    const example = h(
      'select.cc-sel',
      { title: 'Open an example map using void walls, pillars and one-way glass', onchange: () => {
        const ex = EXAMPLE_MAPS.find((m) => m.id === example.value)
        example.value = ''
        if (!ex) return
        this.togglePop(null)
        const copy: LevelDef = { ...JSON.parse(JSON.stringify(ex)) as LevelDef, id: newMapId() }
        this.replaceLevel(copy, null, `Opened the "${ex.name}" example. Undo (Ctrl+Z) brings your previous map back.`)
      } },
      h('option', { value: '' }, 'Open an example…'),
      ...EXAMPLE_MAPS.map((m) => h('option', { value: m.id }, m.name)),
    )
    const share = h('textarea.cc-area', { placeholder: 'Paste a share code (CC1:...) or map JSON here, then Import.', spellcheck: false })
    const file = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: () => {
      const f = file.files?.[0]
      if (f) this.upload(f)
      file.value = ''
    } })

    const pops = new Map<Popover, Overlay>()
    const pop = (id: Popover, x: number, w: number, hgt: number, ...children: (HTMLElement | null)[]): void => {
      const o = new Overlay(this, { x, y: TOOLBAR_H + 2, w, h: hgt }, 'cc-pop')
      o.el.append(...(children.filter(Boolean) as HTMLElement[]))
      o.el.style.display = 'none'
      pops.set(id, o)
    }
    pop('map', 470, 340, 336,
      h('div.cc-h', {}, 'Map settings'),
      h('div.cc-row', {}, h('label', {}, 'Name'), name),
      h('div.cc-row', {}, h('label', {}, 'Mode'), mode),
      aimsRow,
      diffRow,
      h('div.cc-row', {}, h('label', {}, 'Size'), size),
      h('div.cc-row', {}, h('label', {}, 'Hint'), hint),
      h('div.cc-row', {}, h('label', {}, 'Examples'), example),
      issues,
      h('div.cc-row', { style: 'margin-top:8px' },
        h('button.cc-btn.sm', { style: 'flex:1', onclick: () => this.save(true) }, 'Save as copy'),
        h('button.cc-btn.sm', { style: 'flex:1', onclick: () => {
          this.togglePop(null)
          this.replaceLevel(blankMap(this.level.size ?? 'small'), null, 'New map. Undo (Ctrl+Z) brings the old one back.')
        } }, 'New map'),
      ),
    )
    pop('share', 540, 340, 222,
      h('div.cc-h', {}, 'Share'),
      share,
      h('div.cc-row', {},
        h('button.cc-btn.sm', { style: 'flex:1', onclick: () => this.shareCode() }, 'Get code'),
        h('button.cc-btn.sm', { style: 'flex:1', onclick: () => this.importCode(share.value) }, 'Import'),
      ),
      h('div.cc-row', {},
        h('button.cc-btn.sm', { style: 'flex:1', onclick: () => this.download() }, 'Download .json'),
        h('button.cc-btn.sm', { style: 'flex:1', onclick: () => file.click() }, 'Upload .json'),
      ),
      file,
      h('div.cc-note', { style: 'margin-top:4px' }, 'Codes start with CC1: and hold the whole map.'),
    )
    const keys: [string, string][] = [
      ['Click / tap', 'Place with the chosen tool, or select'],
      ['Drag', 'Move things · drag empty space to pan'],
      ['Wheel / pinch', 'Zoom (+ / − / 0 keys, or the zoom buttons)'],
      ['WASD / arrows', 'Pan'],
      ['1 2 3', 'Your / enemy / neutral cannon'],
      ['4 5', 'Wall (Type: breakable for brick) / fan'],
      ['6 7 8 9', 'Void wall / pillar / one-way glass / portal pair'],
      ['V · X', 'Move tool · Delete tool'],
      ['Del', 'Delete the selection'],
      ['Q / E · F', 'Turn wall, glass, oval, portal or fan 15° · flip glass'],
      ['[ ] · { }', 'Pillar width · height'],
      ['T', 'Next type for the selected cannon'],
      ['G · P', 'Snap · Playtest'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
      ['Esc', 'Close, cancel or deselect'],
    ]
    pop('help', 610, 400, 334,
      h('div.cc-h', {}, 'Controls'),
      h('div.cc-keys', {}, ...keys.flatMap(([k, v]) => [h('b', {}, k), h('span', {}, v)])),
    )

    // If the bar overflows, first close up the gaps; if it still does (a wider fallback font),
    // dotted tools show just their dot (the tooltip names them).
    const fitToolbar = (): void => {
      toolbar.classList.remove('snug', 'tight')
      if (toolbar.scrollWidth > toolbar.clientWidth + 1) toolbar.classList.add('snug')
      if (toolbar.scrollWidth > toolbar.clientWidth + 1) toolbar.classList.add('tight')
    }
    requestAnimationFrame(fitToolbar)
    void document.fonts?.ready.then(fitToolbar)

    this.dom = { tools, props, mapName, status, zoomText, snap, undo, redo, popBtns, pops, name, mode, aims, unlimited, aimsRow, diff, diffRow, diffNote, size, hint, issues, share, file }
  }

  /** Open one popover (or close all with null). Clicking its button again closes it. */
  private togglePop(id: Popover | null): void {
    const d = this.dom
    if (!d) return
    const next = id && this.openPop !== id ? id : null
    this.openPop = next
    for (const [key, o] of d.pops) o.el.style.display = key === next ? '' : 'none'
    for (const [key, btn] of d.popBtns) btn.classList.toggle('on', key === next)
  }

  private statusTimer: Phaser.Time.TimerEvent | null = null

  private status(message: string, error = false, ok = false): void {
    this.statusMsg = { text: message, kind: error ? 'err' : ok ? 'ok' : '' }
    this.statusTimer?.remove()
    this.statusTimer = this.time.delayedCall(error ? 8000 : 5000, () => {
      if (this.statusMsg?.text === message) this.statusMsg = null
      this.refreshStatus()
    })
    this.refreshStatus()
  }

  /** Right side of the context bar: a recent message, else problems, else save state. */
  private refreshStatus(): void {
    const d = this.dom
    if (!d) return
    const problems = validateMap(this.level)
    let text: string
    let kind = ''
    if (this.statusMsg) {
      text = this.statusMsg.text
      kind = this.statusMsg.kind
    } else if (problems.length) {
      text = problems[0]
      kind = 'err'
    } else {
      text = this.savedId ? (this.dirty ? 'Unsaved changes' : 'Saved') : 'Draft (not saved yet)'
    }
    d.status.textContent = text
    d.status.title = text
    d.status.className = `cc-status ${kind}`
  }

  /** Sync the bar with the level. `props`: also rebuild the selection controls. */
  private refreshPanel(props: boolean): void {
    const d = this.dom
    if (!d) return
    const L = this.level
    for (const [id, btn] of d.tools) btn.classList.toggle('on', id === this.tool && !this.pickingAim)
    d.snap.classList.toggle('on', this.snap)
    d.undo.disabled = this.undoStack.length === 0
    d.redo.disabled = this.redoStack.length === 0
    const active = document.activeElement
    if (active !== d.name) d.name.value = L.name
    d.mode.value = L.kind === 'puzzle' ? 'puzzle' : 'battle'
    d.aimsRow.style.display = L.kind === 'puzzle' ? '' : 'none'
    d.diffRow.style.display = L.kind === 'puzzle' ? 'none' : ''
    d.unlimited.checked = L.kind === 'puzzle' && L.aims === undefined
    d.aims.disabled = d.unlimited.checked
    if (active !== d.aims && L.aims !== undefined) d.aims.value = String(L.aims)
    d.diff.value = difficultyOf(L)
    d.diffNote.textContent = DIFFICULTY[difficultyOf(L)].blurb
    d.size.value = L.size ?? 'small'
    if (active !== d.hint) d.hint.value = L.hint ?? ''
    d.issues.textContent = validateMap(L).join(' ')
    const mode = L.kind === 'puzzle' ? 'Puzzle' : 'Battle'
    d.mapName.textContent = `${L.name} · ${MAP_SIZES[L.size ?? 'small'].label} · ${mode}`
    d.mapName.title = `${L.name} (open Map ▾ to rename)`

    const key = this.sel ? `${this.sel.kind}:${this.sel.index}:${this.pickingAim}` : `none:${this.pickingAim}:${this.tool}`
    if (props || key !== this.propsFor) {
      this.propsFor = key
      d.props.replaceChildren(...this.buildProps())
    }
    this.refreshStatus()
  }

  /** The slim contextual bar: controls for whatever is selected. */
  private buildProps(): HTMLElement[] {
    const ref = this.sel
    const L = this.level
    if (this.pickingAim) {
      return [h('span.cc-note', {}, 'Click a cannon or a spot for the starting aim. Esc cancels.')]
    }
    if (!ref) {
      const tip =
        this.tool === 'select'
          ? 'Drag to move · drag empty space to pan · scroll to zoom'
          : this.tool === 'delete'
            ? 'Click anything to delete it'
            : `Click the board to place: ${TOOLS.find((t) => t.id === this.tool)?.label ?? ''}`
      const extras = [L.pillars?.length ? `${L.pillars.length} pillars` : '', L.glass?.length ? `${L.glass.length} glass` : ''].filter(Boolean)
      return [h('span.cc-note', {}, `${[`${L.cannons.length} cannons`, `${L.walls.length} walls`, ...extras, `${L.fans.length} fans`].join(' · ')}  —  ${tip}`)]
    }
    const remove = h('button.cc-btn.xs.danger', { title: 'Delete (Del)', onclick: () => this.deleteItem(ref) }, 'Delete')
    const slider = (
      label: string,
      value: number,
      min: number,
      max: number,
      step: number,
      apply: (v: number) => void,
      merge: string,
    ): HTMLElement => {
      const out = h('span.cc-val', {}, String(value))
      const input = h('input.cc-range', { type: 'range', min, max, step, value, oninput: () => {
        const v = Number(input.value)
        out.textContent = String(v)
        this.edit(() => apply(v), { merge, rebuild: false })
        this.refreshItem(ref)
      } })
      return h('span.cc-field', {}, h('label', {}, label), input, out)
    }

    if (ref.kind === 'cannon') {
      const c = L.cannons[ref.index]
      const side = h(
        'select.cc-sel.xs',
        { onchange: () => this.setSide(ref.index, side.value as Side) },
        h('option', { value: 'player' }, 'Yours (player)'),
        h('option', { value: 'enemy' }, 'Enemy'),
        h('option', { value: 'neutral' }, 'Neutral'),
      )
      side.value = c.side
      const type = h(
        'select.cc-sel.xs',
        { title: `Tower type (T). ${KIND_IDS.map((k) => `${KINDS[k].label}: ${KINDS[k].blurb}`).join(' · ')}`, onchange: () => this.setKind(ref.index, type.value as CannonKind) },
        ...KIND_IDS.map((k) => h('option', { value: k }, KINDS[k].label)),
      )
      type.value = c.kind ?? 'normal'
      const target = c.aimAt ? L.cannons.find((o) => o.id === c.aimAt) : null
      const aimText = target ? `at ${target.name}` : c.aimPoint ? `at (${c.aimPoint.x}, ${c.aimPoint.y})` : 'none'
      return [
        h('span.cc-field', {}, dot(sideColor(c.side)), h('b', {}, `Cannon ${c.name}`)),
        h('span.cc-field', {}, h('label', {}, 'Owner'), side),
        h('span.cc-field', {}, h('label', {}, 'Type'), type),
        h('span.cc-field', {}, h('label', {}, 'Aim'), h('span.cc-val', { style: 'min-width:0' }, aimText)),
        h('button.cc-btn.xs', { onclick: () => {
          this.pickingAim = true
          this.refreshPanel(true)
        } }, 'Set aim'),
        h('button.cc-btn.xs', { disabled: !c.aimAt && !c.aimPoint, onclick: () => {
          this.edit(() => {
            delete c.aimAt
            delete c.aimPoint
          })
          this.refreshPanel(true)
        } }, 'Clear'),
        remove,
      ]
    }

    if (ref.kind === 'wall') {
      const w = L.walls[ref.index]
      const resize = (len: number, thick: number): void => {
        const cx = w.x + w.w / 2
        const cy = w.y + w.h / 2
        w.w = len
        w.h = thick
        w.x = Math.round(cx - len / 2)
        w.y = Math.round(cy - thick / 2)
      }
      const isVoid = w.kind === 'void'
      const isBrick = w.kind === 'breakable'
      const wallType = h(
        'select.cc-sel.xs',
        { title: 'Void swallows shots. Breakable bounces them until it has taken its HP in damage (any side\'s shots), then breaks for good.', onchange: () => {
          this.edit(() => {
            if (wallType.value === 'void' || wallType.value === 'breakable') w.kind = wallType.value
            else delete w.kind
            if (w.kind !== 'breakable') delete w.hp
          })
          this.refreshItem(ref)
          this.refreshPanel(true)
        } },
        h('option', { value: 'wall' }, 'Wall (bounces)'),
        h('option', { value: 'void' }, 'Void (absorbs)'),
        h('option', { value: 'breakable' }, 'Breakable'),
      )
      wallType.value = isVoid ? 'void' : isBrick ? 'breakable' : 'wall'
      const hp = isBrick
        ? [
            slider('HP', w.hp ?? TUNING.breakable.hp, 1, TUNING.breakable.maxHp, 1, (v) => {
              if (v === TUNING.breakable.hp) delete w.hp
              else w.hp = v
            }, `whp-${ref.index}`),
          ]
        : []
      return [
        h('span.cc-field', {}, dot(isVoid ? VOID_COLOURS.rim : isBrick ? BRICK.base : theme.wall), h('b', { title: isBrick ? 'Normal shot 1 damage, sniper 2, machine gun 0.3' : '' }, isVoid ? 'Void wall' : isBrick ? 'Breakable' : 'Wall')),
        h('span.cc-field', {}, h('label', {}, 'Type'), wallType),
        ...hp,
        slider('Length', w.w, 30, Math.min(1400, this.board.w), 10, (v) => resize(v, w.h), `wl-${ref.index}`),
        slider('Thick', w.h, 12, 80, 2, (v) => resize(w.w, v), `wt-${ref.index}`),
        h('span.cc-field', {},
          h('label', {}, 'Turn'),
          h('button.cc-btn.xs', { title: 'Q', onclick: () => this.rotateSelected(-1) }, '⟲'),
          h('span.cc-val', { style: 'min-width:34px;text-align:center' }, `${deg(w.angle ?? 0)}°`),
          h('button.cc-btn.xs', { title: 'E', onclick: () => this.rotateSelected(1) }, '⟳'),
        ),
        remove,
      ]
    }

    if (ref.kind === 'pillar') {
      const p = L.pillars![ref.index]
      const ry = p.ry ?? p.r
      const shape = (r: number, h: number): void => {
        this.edit(() => {
          p.r = r
          if (h === r) {
            delete p.ry
            delete p.angle
          } else p.ry = h
          const c = this.clampCenter(p, pillarReach(p))
          p.x = Math.round(c.x)
          p.y = Math.round(c.y)
        }, { rebuild: false })
        this.refreshItem(ref)
        this.refreshPanel(true)
      }
      const presets: { name: string; r: number; ry: number; title: string }[] = [
        ...PILLAR_SIZES.map((r, i) => ({ name: ['S', 'M', 'L'][i], r, ry: r, title: `${['Small', 'Medium', 'Large'][i]} round rock, ${r * 2} px across` })),
        ...PILLAR_OVALS.map((o) => ({ ...o, title: `Oval, ${o.r * 2}×${o.ry * 2} px` })),
      ]
      return [
        h('span.cc-field', { title: 'A rock: shots glance off its curve. [ ] width · { } height · Q / E turn an oval' }, dot(ROCK.light), h('b', {}, 'Pillar')),
        h('span.cc-field', {},
          ...presets.map((o) =>
            h('button.cc-btn.xs', { className: `cc-btn xs${p.r === o.r && ry === o.ry ? ' on' : ''}`, title: o.title, onclick: () => shape(o.r, o.ry) }, o.name),
          ),
        ),
        slider('W', p.r * 2, 24, 240, 4, (v) => {
          p.r = v / 2
          if ((p.ry ?? p.r) === p.r) delete p.ry
          else p.ry ??= ry
        }, `pw-${ref.index}`),
        slider('H', ry * 2, 24, 240, 4, (v) => {
          if (v / 2 === p.r) {
            delete p.ry
            delete p.angle
          } else p.ry = v / 2
        }, `ph-${ref.index}`),
        isOvalPillar(p)
          ? h('span.cc-field', {},
            h('label', {}, 'Turn'),
            h('button.cc-btn.xs', { title: 'Q', onclick: () => this.rotateSelected(-1) }, '⟲'),
            h('span.cc-val', { style: 'min-width:34px;text-align:center' }, `${deg(normAngle(p.angle ?? 0, Math.PI))}°`),
            h('button.cc-btn.xs', { title: 'E', onclick: () => this.rotateSelected(1) }, '⟳'),
          )
          : null,
        remove,
      ].filter(Boolean) as HTMLElement[]
    }

    if (ref.kind === 'glass') {
      const g = L.glass![ref.index]
      const len = Math.round(Math.hypot(g.x2 - g.x, g.y2 - g.y))
      return [
        h('span.cc-field', {}, dot(GLASS), h('b', {}, 'One-way glass')),
        slider('Length', len, 40, Math.min(1400, this.board.w), 10, (v) => setGlassLength(g, v), `gl-${ref.index}`),
        h('span.cc-field', {},
          h('label', {}, 'Turn'),
          h('button.cc-btn.xs', { title: 'Q', onclick: () => this.rotateSelected(-1) }, '⟲'),
          h('span.cc-val', { style: 'min-width:34px;text-align:center' }, `${deg(normAngle(glassAngle(g), Math.PI * 2))}°`),
          h('button.cc-btn.xs', { title: 'E', onclick: () => this.rotateSelected(1) }, '⟳'),
        ),
        h('button.cc-btn.xs', { title: 'Swap which side shots pass through (F)', onclick: () => this.flipGlass(ref.index) }, 'Flip'),
        h('span.cc-note', {}, 'Shots pass the way the arrows point; the bright side bounces them.'),
        remove,
      ]
    }

    if (ref.kind === 'portal') {
      const pair = ref.index >> 1
      const e = this.portalEnd(ref.index)
      return [
        h('span.cc-field', {}, dot(portalColour(pair)), h('b', { title: 'A shot touching either disc falls in and comes out of the other at the same speed. The beam and chevrons show where shots come out: straight into one beam means straight out along the other; at an angle, out at the same angle. Its range carries over.' }, `Portal ${pair + 1} · ${ref.index & 1 ? 'B' : 'A'}`)),
        h('span.cc-field', {},
          h('label', { title: 'The way shots come out of this mouth (its beam and chevrons)' }, 'Out'),
          h('button.cc-btn.xs', { title: 'Q', onclick: () => this.rotateSelected(-1) }, '⟲'),
          h('span.cc-val', { style: 'min-width:34px;text-align:center' }, `${deg(normAngle(exitAngle(ref.index & 1 ? 'b' : 'a', e.angle), Math.PI * 2))}°`),
          h('button.cc-btn.xs', { title: 'E', onclick: () => this.rotateSelected(1) }, '⟳'),
        ),
        h('button.cc-btn.xs', { title: 'Select the linked mouth', onclick: () => this.select({ kind: 'portal', index: ref.index ^ 1 }) }, ref.index & 1 ? 'Other: A' : 'Other: B'),
        h('span.cc-note', {}, 'Shots come out along the beam.'),
        h('button.cc-btn.xs.danger', { title: 'Delete this pair (Del)', onclick: () => this.deleteItem(ref) }, 'Delete pair'),
      ]
    }

    const f = L.fans[ref.index]
    const dirs: [string, number][] = [['→', 0], ['↓', 90], ['←', 180], ['↑', 270]]
    return [
      h('span.cc-field', {}, dot(theme.fan), h('b', {}, 'Fan')),
      h('span.cc-field', {},
        h('label', {}, 'Blows'),
        ...dirs.map(([label, d]) =>
          h('button.cc-btn.xs', { className: `cc-btn xs${Math.abs(normAngle(f.angle, Math.PI * 2) - rad(d)) < 0.01 ? ' on' : ''}`, onclick: () => {
            this.edit(() => (f.angle = rad(d === 270 ? -90 : d)), { rebuild: false })
            this.refreshItem(ref)
            this.refreshPanel(true)
          } }, label),
        ),
        h('span.cc-val', { style: 'min-width:34px;text-align:center', title: 'Q / E turn by 15°' }, `${deg(normAngle(f.angle, Math.PI * 2))}°`),
      ),
      slider('Strength', f.force ?? TUNING.fanForce, 100, 1200, 20, (v) => (f.force = v), `ff-${ref.index}`),
      slider('Radius', f.radius, 60, 360, 10, (v) => (f.radius = v), `fr-${ref.index}`),
      remove,
    ]
  }

  /** Portal mouth `index` (pair * 2, plus 1 for the second mouth). */
  private portalEnd(index: number): PortalEnd {
    const pair = this.level.portals![index >> 1]
    return index & 1 ? pair.b : pair.a
  }

  /** Grow or shrink a pillar's width / height (keys [ ] and { }). Equal sides make it round again. */
  private resizePillar(index: number, dw: number, dh: number): void {
    const p = this.level.pillars?.[index]
    if (!p) return
    this.edit(() => {
      const ry = p.ry ?? p.r
      p.r = Math.min(120, Math.max(12, p.r + dw / 2))
      const h = Math.min(120, Math.max(12, ry + dh / 2))
      if (h === p.r) {
        delete p.ry
        delete p.angle
      } else p.ry = h
      const c = this.clampCenter(p, pillarReach(p))
      p.x = Math.round(c.x)
      p.y = Math.round(c.y)
    }, { merge: `size-pillar-${index}`, rebuild: false })
    this.refreshItem({ kind: 'pillar', index })
    this.refreshPanel(true)
  }

  /** Swap the side of a glass pane that shots pass through. */
  private flipGlass(index: number): void {
    const g = this.level.glass?.[index]
    if (!g) return
    this.edit(() => {
      if (g.flip) delete g.flip
      else g.flip = true
    }, { rebuild: false })
    this.refreshItem({ kind: 'glass', index })
    this.refreshPanel(true)
    this.status('Glass flipped: shots now pass through the other way.')
  }

  /** Tower type for one cannon. */
  private setKind(index: number, kind: CannonKind): void {
    const c = this.level.cannons[index]
    if ((c.kind ?? 'normal') === kind && c.delay === undefined) return
    this.edit(() => {
      if (kind === 'normal') delete c.kind
      else c.kind = kind
      delete c.delay
    })
    this.refreshPanel(true)
  }

  /** T key: Normal ↔ Sniper (and any future types in order). */
  private cycleKind(index: number): void {
    const c = this.level.cannons[index]
    const kind = nextKind(c.kind ?? 'normal')
    this.setKind(index, kind)
    this.status(`${c.name} is now ${kindLabel(kind)}.`)
  }

  private setSide(index: number, side: Side): void {
    const c = this.level.cannons[index]
    if (c.side === side) return
    this.edit(() => {
      const oldId = c.id
      const autoName = c.name === c.id.toUpperCase()
      c.side = side
      c.id = nextCannonId(side, this.level.cannons.filter((o) => o !== c).map((o) => o.id))
      if (autoName) c.name = c.id.toUpperCase()
      for (const o of this.level.cannons) if (o.aimAt === oldId) o.aimAt = c.id
    })
    this.refreshPanel(true)
  }
}

// ------------------------------------------------------------------ helpers

function toEditor(level: LevelDef): LevelDef {
  const copy = JSON.parse(JSON.stringify(level)) as LevelDef
  copy.walls = copy.walls.map(editorWall)
  copy.size = copy.size ?? 'small'
  copy.kind = copy.kind ?? 'battle'
  return copy
}

function same(a: ItemRef, b: ItemRef): boolean {
  return a.kind === b.kind && a.index === b.index
}

function normAngle(a: number, period: number): number {
  let r = a % period
  if (r < 0) r += period
  if (Math.abs(r - period) < 1e-6) r = 0
  return r
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map'
}

function dot(color: number): HTMLSpanElement {
  return h('span.cc-dot', { style: `background:${cssHex(color)}` })
}

function inWall(w: WallDef, x: number, y: number, pad: number): boolean {
  const cx = w.x + w.w / 2
  const cy = w.y + w.h / 2
  const a = -(w.angle ?? 0)
  const dx = x - cx
  const dy = y - cy
  const lx = dx * Math.cos(a) - dy * Math.sin(a)
  const ly = dx * Math.sin(a) + dy * Math.cos(a)
  return Math.abs(lx) <= w.w / 2 + pad && Math.abs(ly) <= w.h / 2 + pad
}

function strokeRotated(g: Phaser.GameObjects.Graphics, w: WallDef, pad: number): void {
  const cx = w.x + w.w / 2
  const cy = w.y + w.h / 2
  const a = w.angle ?? 0
  const hx = w.w / 2 + pad
  const hy = w.h / 2 + pad
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const pts = [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ].map(([x, y]) => new Phaser.Math.Vector2(cx + x * cos - y * sin, cy + x * sin + y * cos))
  g.strokePoints(pts, true)
}

function dashed(
  g: Phaser.GameObjects.Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: number,
  alpha: number,
  startInset: number,
  endInset: number,
): void {
  const len = Math.hypot(x2 - x1, y2 - y1)
  if (len <= startInset + endInset) return
  const ux = (x2 - x1) / len
  const uy = (y2 - y1) / len
  g.lineStyle(2, color, alpha)
  g.beginPath()
  for (let t = startInset; t < len - endInset; t += 16) {
    const e = Math.min(t + 9, len - endInset)
    g.moveTo(x1 + ux * t, y1 + uy * t)
    g.lineTo(x1 + ux * e, y1 + uy * e)
  }
  g.strokePath()
}

/** A glass pane as a thin rotated box (hit testing and the selection outline). */
function glassBox(g: GlassDef): WallDef {
  const len = Math.hypot(g.x2 - g.x, g.y2 - g.y)
  const cx = (g.x + g.x2) / 2
  const cy = (g.y + g.y2) / 2
  return { x: cx - len / 2, y: cy - 5, w: len, h: 10, angle: glassAngle(g) }
}

function glassAngle(g: GlassDef): number {
  return Math.atan2(g.y2 - g.y, g.x2 - g.x)
}

/** Turn a pane about its middle (keeping its length). */
function setGlassAngle(g: GlassDef, angle: number): void {
  const len = Math.hypot(g.x2 - g.x, g.y2 - g.y)
  placeGlass(g, (g.x + g.x2) / 2, (g.y + g.y2) / 2, angle, len)
}

/** Stretch a pane about its middle (keeping its angle). */
function setGlassLength(g: GlassDef, len: number): void {
  placeGlass(g, (g.x + g.x2) / 2, (g.y + g.y2) / 2, glassAngle(g), len)
}

function placeGlass(g: GlassDef, cx: number, cy: number, angle: number, len: number): void {
  const hx = (Math.cos(angle) * len) / 2
  const hy = (Math.sin(angle) * len) / 2
  g.x = Math.round(cx - hx)
  g.y = Math.round(cy - hy)
  g.x2 = Math.round(cx + hx)
  g.y2 = Math.round(cy + hy)
}

/** A pillar that is an oval (it has a turn). */
function isOvalPillar(p: PillarDef): boolean {
  return p.ry !== undefined && p.ry !== p.r
}

/** True when (x, y) is on a pillar, give or take `pad`. */
function inOval(p: PillarDef, x: number, y: number, pad: number): boolean {
  const cos = Math.cos(p.angle ?? 0)
  const sin = Math.sin(p.angle ?? 0)
  const dx = x - p.x
  const dy = y - p.y
  const lx = (dx * cos + dy * sin) / (p.r + pad)
  const ly = (-dx * sin + dy * cos) / ((p.ry ?? p.r) + pad)
  return lx * lx + ly * ly <= 1
}

/** Outline a pillar (round or oval, turned), `pad` px outside it. */
function strokeOval(g: Phaser.GameObjects.Graphics, p: PillarDef, pad: number): void {
  const cos = Math.cos(p.angle ?? 0)
  const sin = Math.sin(p.angle ?? 0)
  const a = p.r + pad
  const b = (p.ry ?? p.r) + pad
  const pts: Phaser.Math.Vector2[] = []
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2
    const lx = Math.cos(t) * a
    const ly = Math.sin(t) * b
    pts.push(new Phaser.Math.Vector2(p.x + lx * cos - ly * sin, p.y + lx * sin + ly * cos))
  }
  g.strokePoints(pts, true)
}
