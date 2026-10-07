import { KINDS, KIND_IDS, kindLabel, nextKind } from '../config/kinds'
import Phaser from 'phaser'
import { GAME_HEIGHT, GAME_WIDTH } from '../config/layout'
import { TUNING } from '../config/tuning'
import { cssHex, sideColor, theme } from '../config/theme'
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
  validateMap,
  withDifficulty,
  type Difficulty,
  type MapView,
} from '../editor/maps'
import { Cannon } from '../entities/Cannon'
import { Fan } from '../entities/Fan'
import { Wall } from '../entities/Wall'
import { MAP_SIZES, MAP_SIZE_IDS, boardFor, insideBoard } from '../levels/board'
import { drawBoardSurface } from '../render/boardSurface'
import { bindSceneResolution } from '../render/resolution'
import { WorldCamera } from '../render/WorldCamera'
import { Overlay, h } from '../ui/overlay'
import type { CannonDef, CannonKind, LevelDef, MapSize, Point, Rect, Side, WallDef } from '../types'

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

type Tool = 'select' | 'player' | 'enemy' | 'neutral' | 'wall' | 'fan' | 'delete'
type Popover = 'map' | 'share' | 'help'
type ItemKind = 'cannon' | 'wall' | 'fan'
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
  player: 'Place a gold (player) cannon',
  enemy: 'Place an enemy cannon',
  neutral: 'Place a neutral cannon',
  wall: 'Place a wall',
  fan: 'Place a fan',
  delete: 'Delete tool',
}

const TOOLS: { id: Tool; label: string; key: string; color?: number }[] = [
  { id: 'select', label: 'Move', key: 'V' },
  { id: 'player', label: 'Gold', key: '1', color: theme.player },
  { id: 'enemy', label: 'Enemy', key: '2', color: theme.enemy },
  { id: 'neutral', label: 'Neutral', key: '3', color: theme.neutral },
  { id: 'wall', label: 'Wall', key: '4', color: theme.wall },
  { id: 'fan', label: 'Fan', key: '5', color: theme.fan },
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
  private wallViews: Wall[] = []
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
    for (const fan of this.fanViews) fan.draw(time)
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
    this.fanViews.forEach((f) => f.destroy())
    this.wallViews = this.level.walls.map((w) => {
      const view = new Wall(this, w)
      this.world(view.gfx)
      return view
    })
    this.fanViews = this.level.fans.map((f) => {
      const view = new Fan(this, f)
      this.world(view.gfx)
      return view
    })
    this.cannonViews = this.level.cannons.map((c) => this.makeCannon(c))
  }

  private makeCannon(def: CannonDef): Cannon {
    const view = new Cannon(this, def.id, def.name, def.x, def.y, def.side, 0, def.kind)
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
      this.wallViews[ref.index]?.set(this.level.walls[ref.index])
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
      } else if (this.tool === 'wall') {
        g.fillStyle(theme.wall, 0.4)
        g.fillRect(p.x - 110, p.y - 13, 220, 26)
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
    const item = ref.kind === 'cannon' ? this.level.cannons[ref.index] : this.level.fans[ref.index]
    return { x: item.x, y: item.y }
  }

  private moveItem(ref: ItemRef, to: Point): void {
    if (ref.kind === 'wall') {
      const w = this.level.walls[ref.index]
      const c = this.clampCenter(to, 0)
      w.x = Math.round(c.x - w.w / 2)
      w.y = Math.round(c.y - w.h / 2)
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
    } else if (tool === 'wall') {
      if (L.walls.length >= LIMITS.walls) return this.status(`Maps can have up to ${LIMITS.walls} walls.`, true)
      const c = this.clampCenter(p, 0)
      this.edit(() => L.walls.push({ x: Math.round(c.x - 110), y: Math.round(c.y - 13), w: 220, h: 26 }))
      this.select({ kind: 'wall', index: L.walls.length - 1 })
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
      else this.level.fans.splice(ref.index, 1)
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
    this.edit(
      () => {
        if (ref.kind === 'wall') {
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
        t.color !== undefined ? dot(t.color) : null,
        t.label,
      )
      tools.set(t.id, btn)
      toolGroup.append(btn)
    }
    const del = h('button.cc-btn.sm.danger', { title: 'Delete tool: click things to remove them (X)', onclick: () => this.setTool('delete') }, 'Delete')
    tools.set('delete', del)
    toolGroup.append(del)

    const undo = h('button.cc-btn.sm.icon', { title: 'Undo (Ctrl+Z)', onclick: () => this.undo() }, '↶')
    const redo = h('button.cc-btn.sm.icon', { title: 'Redo (Ctrl+Shift+Z)', onclick: () => this.redo() }, '↷')
    const snap = h('button.cc-btn.sm', { title: `Snap to a ${GRID}px grid (G)`, onclick: () => {
      this.snap = !this.snap
      this.refreshPanel(false)
    } }, '▦ Snap')

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
        h('button.cc-btn.sm.primary', { title: 'Play this map now (P)', onclick: () => this.playtest() }, '▶ Playtest'),
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
      ...(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => h('option', { value: d }, DIFFICULTY[d].label)),
    )
    const diffRow = h('div.cc-row', {}, h('label', {}, 'AI'), diff)
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
    pop('map', 470, 340, 300,
      h('div.cc-h', {}, 'Map settings'),
      h('div.cc-row', {}, h('label', {}, 'Name'), name),
      h('div.cc-row', {}, h('label', {}, 'Mode'), mode),
      aimsRow,
      diffRow,
      h('div.cc-row', {}, h('label', {}, 'Size'), size),
      h('div.cc-row', {}, h('label', {}, 'Hint'), hint),
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
      ['1 2 3', 'Gold / enemy / neutral cannon'],
      ['4 5', 'Wall / fan'],
      ['V · X', 'Move tool · Delete tool'],
      ['Del', 'Delete the selection'],
      ['Q / E', 'Rotate wall or fan 15°'],
      ['T', 'Next type for the selected cannon'],
      ['G · P', 'Snap · Playtest'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
      ['Esc', 'Close, cancel or deselect'],
    ]
    pop('help', 610, 400, 292,
      h('div.cc-h', {}, 'Controls'),
      h('div.cc-keys', {}, ...keys.flatMap(([k, v]) => [h('b', {}, k), h('span', {}, v)])),
    )

    this.dom = { tools, props, mapName, status, zoomText, snap, undo, redo, popBtns, pops, name, mode, aims, unlimited, aimsRow, diff, diffRow, size, hint, issues, share, file }
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
      return [h('span.cc-note', {}, `${L.cannons.length} cannons · ${L.walls.length} walls · ${L.fans.length} fans  —  ${tip}`)]
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
        h('option', { value: 'player' }, 'Gold (yours)'),
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
      return [
        h('span.cc-field', {}, dot(theme.wall), h('b', {}, 'Wall')),
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
