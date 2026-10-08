import type Phaser from 'phaser'
import { GAME_WIDTH } from '../config/layout'
import { cssHex, theme } from '../config/theme'
import { h } from './dom'
import { motionOK } from './motion'

/** A cannon flip: a light sweep over the bar segment that gained, and its number popping (made once, reused). */
const GLINT: Keyframe[] = [
  { opacity: 0, transform: 'translateX(-70%)' },
  { opacity: 1, offset: 0.3 },
  { opacity: 0, transform: 'translateX(70%)' },
]
const GLINT_TIMING: KeyframeAnimationOptions = { duration: 560, easing: 'ease-out' }
const POP: Keyframe[] = [{ transform: 'scale(1)' }, { transform: 'scale(1.3)', offset: 0.3 }, { transform: 'scale(1)' }]
const POP_TIMING: KeyframeAnimationOptions = { duration: 420, easing: 'cubic-bezier(.34, 1.56, .64, 1)' }

/**
 * The battle's top bar, as HTML over the canvas: real buttons (Dark Choco,
 * like the main menu's), the tug-of-war cannon bar, the online clock.
 *
 * It is sized in CSS pixels, not scaled with the 1200x720 layout, so text
 * and tap targets stay readable on a phone and in a Discord frame. Its
 * bottom lines up with the canvas's HUD band; when it needs more height than
 * the band has it grows upward into the space above the canvas (portrait
 * phones), or, with no room there, a little way over the board's top margin.
 * Below 600 px it takes two rows: the cannon bar and clock, then the buttons.
 * Buttons that still don't fit fold into the Menu, least used first.
 *
 * Nothing here runs per frame unless something changed: the scene calls the
 * setters every frame and they return straight away when the value is the same.
 */

export type HudButtonId = 'editor' | 'pause' | 'settings' | 'restart' | 'surrender' | 'menu'

export interface HudButton {
  id: HudButtonId
  label: string
  /** Tooltip (with the key). */
  title: string
  /** Space is short: lower folds into the Menu first. Infinity never folds. */
  keep: number
  /** 'left' sits before the title (the playtest's Editor button). */
  left?: boolean
  danger?: boolean
  onPress: () => void
}

export interface HudCounts {
  /** Board side your cannons start on (the bar puts your segment there). */
  mineOn: 'left' | 'right'
  /** An enemy segment (puzzles have none). */
  enemy: boolean
}

export interface HudOpts {
  title: string
  buttons: HudButton[]
  counts: HudCounts
  /** Online: the match clock and the ping / pauses line. */
  clock: boolean
  /** Puzzles with an aim budget: "3 aims left". */
  aims: boolean
}

/** Phaser's event names (Phaser.Scale.Events.RESIZE, Phaser.Scenes.Events.SHUTDOWN), so this file loads without Phaser in the tests. */
const SCALE_RESIZE = 'resize'
const SCENE_SHUTDOWN = 'shutdown'

/** The HUD band at the top of the canvas, in layout px (BattleScene's HUD_H). */
const BAND = 54
/** Below this width (CSS px) the bar takes two rows. */
const TWO_ROWS_BELOW = 600

/** Dark text on light team colours, light text on dark ones. */
export function inkOn(colour: number): string {
  const r = ((colour >> 16) & 255) / 255
  const g = ((colour >> 8) & 255) / 255
  const b = (colour & 255) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? '#1a120e' : '#ffffff'
}

/**
 * Which buttons fold into the Menu so the rest fit: drop the lowest `keep`
 * first until `fits` says yes. Pure, for the tests; the HUD measures the DOM.
 */
export function foldOrder(buttons: readonly { id: HudButtonId; keep: number }[]): HudButtonId[] {
  return buttons
    .filter((b) => Number.isFinite(b.keep))
    .slice()
    .sort((a, b) => a.keep - b.keep)
    .map((b) => b.id)
}

/**
 * Does a row's content spill out of it? scrollWidth only sees spill on the end
 * side: a right-aligned row (the buttons row on phones) spills off its start,
 * so its buttons' edges are checked too.
 */
function rowOverflows(row: HTMLElement): boolean {
  if (row.scrollWidth > row.clientWidth + 1) return true
  const box = row.getBoundingClientRect()
  for (const child of row.children) {
    const r = child.getBoundingClientRect()
    if (r.width && (r.left < box.left - 1 || r.right > box.right + 1)) return true
  }
  return false
}

export class BattleHud {
  readonly el: HTMLDivElement
  /** Buttons folded into the Menu right now (the scene adds them there). */
  readonly folded = new Set<HudButtonId>()
  /** performance.now() of the last cannon-count change (the bar eases for TUG_MS after). */
  lastChange = -Infinity
  private readonly canvas: HTMLCanvasElement
  private readonly rowA: HTMLDivElement
  private readonly rowB: HTMLDivElement
  private readonly titleEl: HTMLDivElement
  private readonly tug: HTMLDivElement
  private readonly seg: { mine: HTMLDivElement; neutral: HTMLDivElement; theirs: HTMLDivElement }
  private readonly num: { mine: HTMLSpanElement; neutral: HTMLSpanElement; theirs: HTMLSpanElement }
  private readonly dots: { mine: HTMLSpanElement; theirs: HTMLSpanElement }
  private readonly clockBox: HTMLDivElement | null = null
  private readonly clockEl: HTMLElement | null = null
  private readonly netEl: HTMLElement | null = null
  private readonly aimsEl: HTMLSpanElement | null = null
  private readonly btn = new Map<HudButtonId, HTMLButtonElement>()
  private readonly defs: HudButton[]
  /** Hidden by the scene (not folded): ended, spectating, no pauses... */
  private readonly off = new Set<HudButtonId>()
  private readonly counts = { mine: -1, neutral: -1, theirs: -1 }
  private confirmEl: HTMLDivElement | null = null
  private confirmTimer = 0
  private readonly observer: ResizeObserver | null
  private readonly onResize = (): void => this.place()
  private placing = 0
  private twoRows = false
  /** Bar bottom below the canvas top (CSS px) and CSS px per layout px, from the last place(). */
  private cover = 0
  private k = 1

  constructor(scene: Phaser.Scene, opts: HudOpts) {
    injectHudStyles()
    this.canvas = scene.game.canvas
    this.defs = opts.buttons
    const stop = (e: Event): void => e.preventDefault()
    const button = (b: HudButton): HTMLButtonElement => {
      const el = h(`button.bh-btn${b.danger ? '.danger' : ''}`, { type: 'button', title: b.title, 'aria-label': b.title, dataset: { hud: b.id } }, b.label)
      // No focus on press: Space must stay the pause key, never "click the last button".
      el.addEventListener('pointerdown', stop)
      el.addEventListener('click', (e) => {
        e.preventDefault()
        b.onPress()
      })
      this.btn.set(b.id, el)
      return el
    }
    this.titleEl = h('div.bh-title', { title: opts.title }, opts.title)
    const mk = (cls: string): [HTMLDivElement, HTMLSpanElement] => {
      const n = h('span.bh-n')
      return [h(`div.bh-seg.${cls}`, {}, h('span.bh-glint'), n), n]
    }
    const [mineSeg, mineNum] = mk('mine')
    const [neutralSeg, neutralNum] = mk('neutral')
    const [theirsSeg, theirsNum] = mk('theirs')
    this.seg = { mine: mineSeg, neutral: neutralSeg, theirs: theirsSeg }
    this.num = { mine: mineNum, neutral: neutralNum, theirs: theirsNum }
    if (!opts.counts.enemy) theirsSeg.style.display = 'none'
    const left = opts.counts.mineOn === 'left'
    this.tug = h('div.bh-tug', { role: 'img' }, ...(left ? [mineSeg, neutralSeg, theirsSeg] : [theirsSeg, neutralSeg, mineSeg]))
    this.dots = { mine: h('span.bh-dot'), theirs: h('span.bh-dot') }
    if (!opts.counts.enemy) this.dots.theirs.style.visibility = 'hidden'
    const tugWrap = h('div.bh-tugwrap', {}, left ? this.dots.mine : this.dots.theirs, this.tug, left ? this.dots.theirs : this.dots.mine)
    if (opts.aims) this.aimsEl = h('span.bh-aims')
    if (opts.clock) {
      this.clockEl = h('b.bh-clock')
      this.netEl = h('small.bh-net')
      this.clockBox = h('div.bh-clockbox', {}, this.clockEl, this.netEl)
    }
    const lefts = opts.buttons.filter((b) => b.left).map(button)
    const rights = opts.buttons.filter((b) => !b.left).map(button)
    this.rowA = h('div.bh-row.a', {}, ...lefts, this.titleEl, tugWrap, this.aimsEl, this.clockBox)
    this.rowB = h('div.bh-row.b', {}, ...rights)
    this.el = h('div.bh', { role: 'toolbar', 'aria-label': 'Battle controls' }, this.rowA, this.rowB)
    document.body.appendChild(this.el)
    window.addEventListener('resize', this.onResize)
    scene.scale.on(SCALE_RESIZE, this.onResize)
    this.observer = 'ResizeObserver' in window ? new ResizeObserver(this.onResize) : null
    this.observer?.observe(this.canvas)
    scene.events.once(SCENE_SHUTDOWN, () => {
      scene.scale.off(SCALE_RESIZE, this.onResize)
      this.destroy()
    })
    this.place()
    this.placing = requestAnimationFrame(this.onResize)
  }

  /** Line the bar up with the canvas (on resize, and when buttons come and go). */
  place(): void {
    this.placing = 0
    const r = this.canvas.getBoundingClientRect()
    if (!r.width) return
    const k = r.width / GAME_WIDTH
    const band = BAND * k
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    const two = r.width < TWO_ROWS_BELOW
    const btnH = touch ? 40 : Math.round(Math.min(36, Math.max(30, band - 16)))
    this.el.classList.toggle('two', two)
    this.el.classList.toggle('touch', touch)
    this.el.style.setProperty('--bh-btn', `${btnH}px`)
    this.twoRows = two
    // Two rows: the cannon bar row, then the buttons. One row: everything.
    if (two) {
      if (this.rowB.parentElement !== this.el) this.el.append(this.rowB)
    } else if (this.rowB.parentElement === this.el) this.el.removeChild(this.rowB)
    this.layoutButtons()
    const rowH = btnH + 8
    const height = two ? rowH + Math.max(34, rowH - 8) : Math.max(Math.round(band), rowH)
    const safeTop = safeInsetTop()
    const top = Math.max(safeTop, r.top + band - height)
    this.el.style.left = `${Math.round(r.left)}px`
    this.el.style.top = `${Math.round(top)}px`
    this.el.style.width = `${Math.round(r.width)}px`
    this.el.style.height = `${Math.round(height)}px`
    this.k = k
    this.cover = Math.round(top + height) - r.top
    this.fold()
    if (this.confirmEl) this.placeConfirm()
  }

  /** Buttons in their row (row B on two rows, else the end of row A, Editor first). */
  private layoutButtons(): void {
    const target = this.twoRows ? this.rowB : this.rowA
    // append() moves: the order stays the scene's.
    for (const d of this.defs) if (!d.left) target.append(this.btn.get(d.id)!)
  }

  /** Fold buttons into the Menu, least used first, until the bar fits. Only on layout changes (it measures). */
  private fold(): void {
    this.folded.clear()
    this.titleEl.style.display = ''
    for (const d of this.defs) this.btn.get(d.id)!.style.display = this.off.has(d.id) ? 'none' : ''
    const over = (): boolean => {
      const rows = this.twoRows ? [this.rowA, this.rowB] : [this.rowA]
      return rows.some((row) => rowOverflows(row))
    }
    // A title cut down to "Ski…" says nothing: drop it instead.
    const titleTooSmall = (): boolean => this.titleEl.scrollWidth > this.titleEl.clientWidth + 1 && this.titleEl.clientWidth < 110
    if (over() || titleTooSmall()) this.titleEl.style.display = 'none'
    for (const id of foldOrder(this.defs)) {
      if (!over()) break
      if (this.off.has(id)) continue
      this.btn.get(id)!.style.display = 'none'
      this.folded.add(id)
    }
  }

  private schedulePlace(): void {
    if (!this.placing) this.placing = requestAnimationFrame(this.onResize)
  }

  /** How far the bar reaches below the canvas's top `band` layout px (landscape phones), in layout px; 0 when it doesn't. */
  coverBelow(band: number): number {
    return Math.max(0, this.cover / (this.k || 1) - band - 1)
  }

  /** Show or hide a button (not folding: the scene says it doesn't apply now). */
  show(id: HudButtonId, on: boolean): void {
    const el = this.btn.get(id)
    if (!el || on === !this.off.has(id)) return
    if (on) this.off.delete(id)
    else this.off.add(id)
    el.style.display = on && !this.folded.has(id) ? '' : 'none'
    this.schedulePlace()
  }

  /** Is the button there (shown and not folded)? */
  visible(id: HudButtonId): boolean {
    return this.btn.has(id) && !this.off.has(id) && !this.folded.has(id)
  }

  /** A button's label and pressed look (Pause / Resume). */
  setButton(id: HudButtonId, label: string, pressed = false): void {
    const el = this.btn.get(id)
    if (!el) return
    if (el.textContent !== label) el.textContent = label
    const p = pressed ? 'true' : 'false'
    if (el.getAttribute('aria-pressed') !== p) el.setAttribute('aria-pressed', p)
  }

  /** Team colours on the bar (your segment and theirs; theirs is red on a colour clash) and the ring dots. */
  setColours(mine: number, theirs: number, mineDot: number, theirsDot: number, ringMine: number, ringTheirs: number): void {
    this.seg.mine.style.background = cssHex(mine)
    this.seg.mine.style.color = inkOn(mine)
    this.seg.theirs.style.background = cssHex(theirs)
    this.seg.theirs.style.color = inkOn(theirs)
    this.seg.neutral.style.background = cssHex(theme.neutral)
    this.seg.neutral.style.color = inkOn(theme.neutral)
    const dot = (el: HTMLSpanElement, fill: number, ring: number): void => {
      el.style.background = cssHex(fill)
      el.style.boxShadow = `0 0 0 2px ${cssHex(ring)}, 0 0 0 3.5px ${cssHex(theme.ringEdge)}`
    }
    dot(this.dots.mine, mineDot, ringMine)
    dot(this.dots.theirs, theirsDot, ringTheirs)
  }

  /** Cannons held. Segment widths ease to the new counts (CSS transition, no per-frame work). */
  setCounts(mine: number, neutral: number, theirs: number, label: (m: number, n: number, t: number) => string): void {
    const c = this.counts
    if (c.mine === mine && c.neutral === neutral && c.theirs === theirs) return
    if (c.mine >= 0) {
      this.lastChange = performance.now()
      // A cannon changed hands: the side that gained flashes and its number pops (only on a change, never per frame).
      if (motionOK()) {
        if (mine > c.mine) this.flash(this.seg.mine, this.num.mine)
        if (theirs > c.theirs) this.flash(this.seg.theirs, this.num.theirs)
        if (neutral > c.neutral) this.flash(this.seg.neutral, this.num.neutral)
      }
    }
    c.mine = mine
    c.neutral = neutral
    c.theirs = theirs
    const set = (seg: HTMLDivElement, num: HTMLSpanElement, n: number): void => {
      seg.style.flexGrow = String(n)
      seg.classList.toggle('zero', n === 0)
      num.textContent = String(n)
    }
    set(this.seg.mine, this.num.mine, mine)
    set(this.seg.neutral, this.num.neutral, neutral)
    set(this.seg.theirs, this.num.theirs, theirs)
    const text = label(mine, neutral, theirs)
    this.tug.setAttribute('aria-label', text)
    this.tug.title = text
  }

  private flash(seg: HTMLDivElement, num: HTMLSpanElement): void {
    ;(seg.firstElementChild as HTMLElement | null)?.animate?.(GLINT, GLINT_TIMING)
    num.animate?.(POP, POP_TIMING)
  }

  setAims(text: string, out: boolean): void {
    const el = this.aimsEl
    if (!el) return
    if (el.textContent !== text) el.textContent = text
    el.classList.toggle('out', out)
  }

  setClock(text: string, warn: boolean): void {
    const el = this.clockEl
    if (!el) return
    if (el.textContent !== text) el.textContent = text
    el.classList.toggle('warn', warn)
  }

  /**
   * The line under the clock. `rtt` (online): the round trip to the server,
   * shown as a small coloured chip ("● 42 ms"; null while measuring).
   */
  setNet(text: string, rtt?: number | null): void {
    const el = this.netEl
    if (!el) return
    if (rtt === undefined) {
      if (el.textContent !== text) el.textContent = text
      return
    }
    let note = el.querySelector<HTMLElement>('.bh-nettext')
    let chip = el.querySelector<HTMLElement>('.bh-ping')
    if (!note || !chip) {
      el.textContent = ''
      note = h('span.bh-nettext')
      chip = h('span.bh-ping', { dataset: { id: 'ping' } })
      el.append(note, chip)
    }
    const t = text ? text + '  ·  ' : ''
    if (note.textContent !== t) note.textContent = t
    const label = rtt === null ? '… ms' : `${Math.round(rtt)} ms`
    if (chip.textContent !== label) chip.textContent = label
    const level = rtt === null ? '' : rtt < 100 ? 'good' : rtt < 200 ? 'ok' : 'bad'
    if (chip.dataset.level !== level) chip.dataset.level = level
    chip.title = rtt === null ? 'Measuring the connection…' : `Round trip to the game server: ${Math.round(rtt)} ms`
  }

  get confirmOpen(): boolean {
    return this.confirmEl !== null
  }

  /**
   * The surrender check: a small panel under the bar with a red Surrender
   * and Keep playing. It closes by itself after a few seconds, on Esc, and
   * when the round ends, so a stray tap never loses the match.
   */
  confirm(title: string, note: string, yes: string, onYes: () => void): void {
    this.closeConfirm()
    const stop = (e: Event): void => e.preventDefault()
    const yesBtn = h('button.bh-btn.danger.solid', { type: 'button', dataset: { hud: 'surrender-yes' } }, yes)
    const noBtn = h('button.bh-btn', { type: 'button', dataset: { hud: 'surrender-no' } }, 'Keep playing')
    for (const b of [yesBtn, noBtn]) b.addEventListener('pointerdown', stop)
    yesBtn.addEventListener('click', () => {
      this.closeConfirm()
      onYes()
    })
    noBtn.addEventListener('click', () => this.closeConfirm())
    this.confirmEl = h('div.bh-confirm', { role: 'alertdialog', 'aria-label': title }, h('b', {}, title), h('div.bh-note', {}, note), h('div.bh-confirm-row', {}, noBtn, yesBtn))
    document.body.appendChild(this.confirmEl)
    this.placeConfirm()
    this.btn.get('surrender')?.setAttribute('aria-expanded', 'true')
    this.confirmTimer = window.setTimeout(() => this.closeConfirm(), 8000)
  }

  closeConfirm(): void {
    if (!this.confirmEl) return
    window.clearTimeout(this.confirmTimer)
    this.confirmEl.remove()
    this.confirmEl = null
    this.btn.get('surrender')?.setAttribute('aria-expanded', 'false')
  }

  /** Under the Surrender button (or the bar's middle when it is folded into the Menu). */
  private placeConfirm(): void {
    const el = this.confirmEl
    if (!el) return
    const bar = this.el.getBoundingClientRect()
    const b = this.visible('surrender') ? this.btn.get('surrender')!.getBoundingClientRect() : null
    const w = Math.min(300, bar.width - 16)
    el.style.width = `${w}px`
    const cx = b ? b.left + b.width / 2 : bar.left + bar.width / 2
    const left = Math.max(bar.left + 8, Math.min(bar.right - 8 - w, cx - w / 2))
    el.style.left = `${Math.round(left)}px`
    el.style.top = `${Math.round(bar.bottom + 6)}px`
  }

  destroy(): void {
    this.closeConfirm()
    if (this.placing) cancelAnimationFrame(this.placing)
    window.removeEventListener('resize', this.onResize)
    this.observer?.disconnect()
    this.el.remove()
  }
}

/** The page's top safe area (a notch, Discord's own bar on phones), in CSS px. */
function safeInsetTop(): number {
  if (typeof document === 'undefined') return 0
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;top:0;height:var(--discord-safe-area-inset-top, env(safe-area-inset-top, 0px))'
  document.body.appendChild(probe)
  const v = probe.getBoundingClientRect().height
  probe.remove()
  return v
}

let injected = false

function injectHudStyles(): void {
  if (injected) return
  injected = true
  const gold = cssHex(theme.player)
  const edge = cssHex(theme.boardEdge)
  const red = cssHex(theme.ringEnemy)
  const rgba = (c: number, a: number): string => `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`
  // 97% opaque, like the other panels over the canvas (fully opaque layers made Chrome skip canvas strips).
  const css = `
.bh {
  position: fixed; z-index: 4; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center;
  gap: 2px; padding: 0 10px; font-family: ${theme.font}; color: ${theme.text}; font-size: 14px;
  background: ${rgba(theme.hud, 0.97)}; border-bottom: 2px solid ${edge};
  -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none;
}
.bh * { box-sizing: border-box; }
.bh-row { display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; }
.bh.two .bh-row.b { gap: 6px; justify-content: flex-end; }
.bh.two .bh-row.b .bh-btn { flex: 1 0 auto; max-width: 160px; }
.bh.two .bh-row.a { min-height: 30px; }
.bh-title { font-weight: bold; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 0; max-width: 240px; margin-right: 4px; }
.bh-tugwrap { flex: 1 1 220px; min-width: 120px; max-width: 420px; display: flex; align-items: center; gap: 8px; margin: 0 auto; }
.bh.two .bh-tugwrap { max-width: none; }
.bh-dot { width: 11px; height: 11px; border-radius: 50%; flex: none; }
.bh-tug { flex: 1 1 auto; min-width: 0; display: flex; height: 16px; border-radius: 999px; overflow: hidden; background: ${cssHex(theme.board)}; box-shadow: 0 0 0 1.5px ${edge}; }
.bh.touch .bh-tug { height: 18px; }
.bh-seg { flex: 0 1 0px; flex-grow: 0; min-width: 0; display: flex; align-items: center; overflow: hidden; transition: flex-grow .34s cubic-bezier(.2,.8,.3,1); font-weight: bold; font-size: 11px; line-height: 1; font-variant-numeric: tabular-nums; }
.bh-seg + .bh-seg { box-shadow: inset 2px 0 0 ${cssHex(theme.hud)}; }
.bh-seg .bh-n { padding: 0 6px; white-space: nowrap; }
.bh-tug > .bh-seg:first-child { justify-content: flex-start; }
.bh-tug > .bh-seg:last-child { justify-content: flex-end; }
.bh-seg.neutral { justify-content: center; }
.bh-seg.zero .bh-n { visibility: hidden; }
.bh-aims { font-weight: bold; font-size: 14px; white-space: nowrap; flex: none; }
.bh-aims.out { color: ${cssHex(theme.enemy)}; }
.bh-clockbox { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.1; flex: none; min-width: 64px; }
.bh-clock { font-size: 17px; font-variant-numeric: tabular-nums; }
.bh-clock.warn { color: ${cssHex(theme.enemy)}; }
.bh-net { font-size: 12px; color: ${theme.textMuted}; white-space: nowrap; }
.bh-ping { font-variant-numeric: tabular-nums; font-weight: bold; }
.bh-ping::before { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 4px; background: currentColor; vertical-align: 1px; }
.bh-ping[data-level='good'] { color: ${cssHex(theme.fan)}; }
.bh-ping[data-level='ok'] { color: ${cssHex(theme.player)}; }
.bh-ping[data-level='bad'] { color: ${cssHex(theme.enemy)}; }
.bh-btn {
  font: inherit; font-weight: bold; font-size: 14px; color: ${theme.text}; background: ${rgba(theme.board, 0.97)};
  border: 2px solid ${edge}; border-radius: 11px; height: var(--bh-btn, 34px); min-width: var(--bh-btn, 34px); padding: 0 12px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; white-space: nowrap; flex: none;
  box-shadow: 0 2px 0 ${cssHex(theme.dim)}; transition: background .12s, border-color .12s, transform .06s, box-shadow .06s;
}
.bh.touch .bh-btn, .bh.two .bh-btn { font-size: 13px; padding: 0 10px; }
.bh-btn:hover { background: ${rgba(theme.grid, 0.97)}; border-color: ${gold}; }
.bh-btn:active { transform: translateY(2px); box-shadow: 0 0 0 ${cssHex(theme.dim)}; }
.bh-btn:focus-visible { outline: 3px solid ${gold}; outline-offset: 1px; }
.bh-btn[aria-pressed="true"] { background: ${gold}; color: ${theme.ink}; border-color: ${gold}; }
.bh-btn.danger { color: ${cssHex(theme.enemy)}; }
.bh-btn.danger:hover { border-color: ${red}; }
.bh-btn.danger.solid { background: ${red}; border-color: ${red}; color: #fff; }
.bh-btn.danger.solid:hover { background: ${cssHex(theme.enemy)}; border-color: ${cssHex(theme.enemy)}; }
.bh-confirm {
  position: fixed; z-index: 6; box-sizing: border-box; font-family: ${theme.font}; color: ${theme.text}; font-size: 13px;
  background: ${rgba(theme.panel, 0.97)}; border: 2px solid ${red}; border-radius: 14px; padding: 12px 14px;
  box-shadow: 0 10px 28px rgba(0,0,0,.5); display: flex; flex-direction: column; gap: 6px;
}
.bh-confirm b { font-size: 15px; }
.bh-confirm .bh-note { color: ${theme.textMuted}; line-height: 1.35; }
.bh-confirm-row { display: flex; gap: 8px; margin-top: 4px; }
.bh-confirm-row .bh-btn { flex: 1 1 0; height: 40px; }
`
  document.head.appendChild(Object.assign(document.createElement('style'), { id: 'cc-hud', textContent: css }))
}
