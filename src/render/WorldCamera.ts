import Phaser from 'phaser'
import type { Point, Rect } from '../types'
import { layoutScale } from './resolution'

/** A rectangle of the 1200x720 layout (e.g. the area under the HUD). */
export interface ViewRect {
  x: number
  y: number
  w: number
  h: number
}

/** Space kept around the board when clamping, matching the original layout. */
const MARGIN = { left: 24, right: 24, top: 14, bottom: 24 }
const MAX_ZOOM = 1.6
/** Pointer travel (canvas px at 1x) before a press counts as a drag. */
const DRAG_SLOP = 7

/**
 * The world camera shared by play and the editor.
 *
 * zoom = 1 is the "near" view (the original board at its normal size). Bigger
 * maps can zoom out until the whole board fits, and pan with drag, WASD or
 * arrow keys, clamped to the board. Screen<->world conversion is done here
 * (toWorld) so clicks land correctly at any zoom, pan and DPI.
 */
export class WorldCamera {
  readonly cam: Phaser.Cameras.Scene2D.Camera
  zoom = 1
  center: Point
  private board: Rect
  private view: ViewRect
  private press: { id: number; x: number; y: number; lastX: number; lastY: number; dragging: boolean; canPan: boolean } | null = null
  private pinch: { dist: number; zoom: number; mid: Point } | null = null
  private keys: Record<string, Phaser.Input.Keyboard.Key> | null = null
  /** Play stops at the near view (1); the editor may zoom in further. */
  maxZoom = MAX_ZOOM

  constructor(
    private readonly scene: Phaser.Scene,
    board: Rect,
    view: ViewRect,
    focus?: Point,
    maxZoom = MAX_ZOOM,
  ) {
    this.maxZoom = maxZoom
    this.cam = scene.cameras.main
    this.board = board
    this.view = view
    this.center = focus ? { ...focus } : { x: board.x + board.w / 2, y: board.y + board.h / 2 }
    const onResize = (): void => this.apply()
    scene.scale.on(Phaser.Scale.Events.RESIZE, onResize)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.scale.off(Phaser.Scale.Events.RESIZE, onResize))
    scene.input.addPointer(1) // second finger for pinch
    const kb = scene.input.keyboard
    if (kb) {
      this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>
    }
    this.apply()
  }

  get minZoom(): number {
    const fit = Math.min(
      this.view.w / (this.board.w + MARGIN.left + MARGIN.right),
      this.view.h / (this.board.h + MARGIN.top + MARGIN.bottom),
    )
    return Math.min(1, fit)
  }

  /** True when the board doesn't fit at the near zoom (zoom/pan is useful). */
  get canZoomOut(): boolean {
    return this.minZoom < 0.98
  }

  get dragging(): boolean {
    return !!this.press?.dragging || !!this.pinch
  }

  /**
   * A new viewport (the top bar grew on a small screen). A view that showed
   * the whole board keeps showing all of it.
   */
  setView(view: ViewRect): void {
    const fitted = this.zoom <= this.minZoom + 1e-6
    this.view = { ...view }
    if (fitted) this.zoom = this.minZoom
    this.apply()
  }

  setBoard(board: Rect): void {
    this.board = board
    this.zoom = Phaser.Math.Clamp(this.zoom, this.minZoom, this.maxZoom)
    this.apply()
  }

  private get s(): number {
    return layoutScale(this.scene)
  }

  apply(): void {
    const s = this.s
    const v = this.view
    this.zoom = Phaser.Math.Clamp(this.zoom, this.minZoom, this.maxZoom)
    this.cam.setViewport(Math.round(v.x * s), Math.round(v.y * s), Math.round(v.w * s), Math.round(v.h * s))
    this.cam.setZoom(s * this.zoom)
    this.clamp()
    this.cam.centerOn(this.center.x, this.center.y)
  }

  private clamp(): void {
    const b = this.board
    const bx = b.x - MARGIN.left
    const bw = b.w + MARGIN.left + MARGIN.right
    const by = b.y - MARGIN.top
    const bh = b.h + MARGIN.top + MARGIN.bottom
    const vw = this.view.w / this.zoom
    const vh = this.view.h / this.zoom
    this.center.x = vw >= bw ? bx + bw / 2 : Phaser.Math.Clamp(this.center.x, bx + vw / 2, bx + bw - vw / 2)
    this.center.y = vh >= bh ? by + bh / 2 : Phaser.Math.Clamp(this.center.y, by + vh / 2, by + bh - vh / 2)
  }

  /** CSS px per world px right now (screen fit, DPR and zoom), e.g. to keep a line readable on a phone. */
  cssPerWorld(): number {
    return this.cam.zoom / (this.scene.scale.displayScale.x || 1)
  }

  /** The part of the world on screen right now. */
  visibleRect(): Rect {
    const w = this.view.w / this.zoom
    const h = this.view.h / this.zoom
    return { x: this.center.x - w / 2, y: this.center.y - h / 2, w, h }
  }

  /** Canvas pixel -> world point, consistent with how the camera renders. */
  toWorld(px: number, py: number): Point {
    const s = this.s
    const k = s * this.zoom
    const cx = (this.view.x + this.view.w / 2) * s
    const cy = (this.view.y + this.view.h / 2) * s
    return { x: this.center.x + (px - cx) / k, y: this.center.y + (py - cy) / k }
  }

  /** World point -> canvas pixel. */
  toScreen(wx: number, wy: number): Point {
    const s = this.s
    const k = s * this.zoom
    return {
      x: (this.view.x + this.view.w / 2) * s + (wx - this.center.x) * k,
      y: (this.view.y + this.view.h / 2) * s + (wy - this.center.y) * k,
    }
  }

  /** Is this canvas pixel inside the world viewport (not over the HUD/panel)? */
  inView(px: number, py: number): boolean {
    const s = this.s
    const v = this.view
    return px >= v.x * s && px <= (v.x + v.w) * s && py >= v.y * s && py <= (v.y + v.h) * s
  }

  zoomBy(factor: number, px?: number, py?: number): void {
    const s = this.s
    const sx = px ?? (this.view.x + this.view.w / 2) * s
    const sy = py ?? (this.view.y + this.view.h / 2) * s
    const before = this.toWorld(sx, sy)
    this.zoom = Phaser.Math.Clamp(this.zoom * factor, this.minZoom, this.maxZoom)
    const after = this.toWorld(sx, sy)
    this.center.x += before.x - after.x
    this.center.y += before.y - after.y
    this.apply()
  }

  fit(): void {
    this.zoom = this.minZoom
    this.center = { x: this.board.x + this.board.w / 2, y: this.board.y + this.board.h / 2 }
    this.apply()
  }

  near(focus?: Point): void {
    this.zoom = 1
    if (focus) this.center = { ...focus }
    this.apply()
  }

  /** Pan by a canvas-pixel delta (content follows the pointer). */
  panBy(dx: number, dy: number): void {
    const k = this.s * this.zoom
    this.center.x -= dx / k
    this.center.y -= dy / k
    this.apply()
  }

  // ---- pointer gestures. Scenes forward their pointer events here first.

  /** Start tracking a press. `canPan`: dragging this press should pan the view. */
  down(pointer: Phaser.Input.Pointer, canPan: boolean): void {
    const active = this.scene.input.manager.pointers.filter((p) => p.isDown && this.inView(p.x, p.y))
    if (active.length >= 2) {
      const [a, b] = active
      this.pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        zoom: this.zoom,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      }
      if (this.press) this.press.dragging = true
      return
    }
    this.press = { id: pointer.id, x: pointer.x, y: pointer.y, lastX: pointer.x, lastY: pointer.y, dragging: false, canPan }
  }

  /** Returns true while this pointer is panning/pinching (callers skip hover work). */
  move(pointer: Phaser.Input.Pointer): boolean {
    if (this.pinch) {
      const active = this.scene.input.manager.pointers.filter((p) => p.isDown)
      if (active.length >= 2) {
        const [a, b] = active
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
        const target = this.pinch.zoom * (dist / this.pinch.dist)
        this.zoomBy(target / this.zoom, this.pinch.mid.x, this.pinch.mid.y)
      }
      return true
    }
    const p = this.press
    if (!p || p.id !== pointer.id || !pointer.isDown) return false
    const slop = DRAG_SLOP * Math.max(1, this.s)
    if (!p.dragging && Math.hypot(pointer.x - p.x, pointer.y - p.y) > slop) p.dragging = true
    if (p.dragging && p.canPan) this.panBy(pointer.x - p.lastX, pointer.y - p.lastY)
    p.lastX = pointer.x
    p.lastY = pointer.y
    return p.dragging
  }

  /** Ends a press. Returns 'click' for a tap/click, 'drag' if it moved (or was a pinch). */
  up(pointer: Phaser.Input.Pointer): 'click' | 'drag' | 'none' {
    if (this.pinch) {
      const stillDown = this.scene.input.manager.pointers.filter((p) => p.isDown).length
      if (stillDown < 2) this.pinch = null
      if (this.press?.id === pointer.id) this.press = null
      return 'drag'
    }
    const p = this.press
    if (!p || p.id !== pointer.id) return 'none'
    this.press = null
    // A press that can't pan (nothing to scroll, or grabbing an item) still counts as a click.
    return p.dragging && p.canPan ? 'drag' : 'click'
  }

  /** Mouse wheel: zoom around the cursor. */
  wheel(pointer: Phaser.Input.Pointer, deltaY: number): void {
    if (!this.inView(pointer.x, pointer.y)) return
    this.zoomBy(Math.exp(-deltaY * 0.0015), pointer.x, pointer.y)
  }

  /** Keyboard panning (WASD / arrows). Call every frame. */
  update(dt: number): void {
    const k = this.keys
    if (!k) return
    const el = document.activeElement
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return // typing in a panel field
    let dx = 0
    let dy = 0
    if (k.A.isDown || k.LEFT.isDown) dx -= 1
    if (k.D.isDown || k.RIGHT.isDown) dx += 1
    if (k.W.isDown || k.UP.isDown) dy -= 1
    if (k.S.isDown || k.DOWN.isDown) dy += 1
    if (!dx && !dy) return
    const speed = 700 / this.zoom // world px per second
    this.center.x += (dx * speed * dt) / 1000
    this.center.y += (dy * speed * dt) / 1000
    this.apply()
  }
}
