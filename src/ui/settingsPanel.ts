import Phaser from 'phaser'
import { cssHex, theme } from '../config/theme'
import { GAME_WIDTH } from '../config/layout'
import { injectMenuStyles } from '../menu/menuStyles'
import { h } from './dom'
import { closeHelpTips, setHelpText } from './helpTip'
import { settingRow } from './settingRow'

/** What a press on the panel hit (the board only needs to know it was the panel). */
export type SettingsHit = 'panel'

/** What the panel shows: the global auto-target toggle, and whether it can be changed here. */
export interface SettingsState {
  autoTarget: boolean
  /** Puzzles: nothing auto-targets, so the toggle is shown greyed out. */
  puzzle: boolean
  /** Sound effects: master volume (0..1) and mute, saved on this device. */
  volume: number
  muted: boolean
  /** False when the browser has no audio (the sound rows are greyed out). */
  audio: boolean
  /** The performance overlay is shown (also F3 / backtick). */
  perf: boolean
}

/** What the panel's controls do (the scene owns the round, the sound and the overlay). */
export interface SettingsActions {
  auto(): void
  mute(): void
  volume(v: number): void
  perf(): void
}

/** The auto-target explanation for the state it is in. */
export function autoHelp(s: Pick<SettingsState, 'autoTarget' | 'puzzle'>): string {
  return s.puzzle
    ? 'Puzzles never auto-target: every aim there is yours to spend.'
    : s.autoTarget
      ? 'Your cannons pick a new target by themselves when theirs is captured, and cannons you capture aim at the nearest foe. To keep one cannon on manual, use the Auto pill in its hover menu (long-press on touch) or press M over it. Starts on every game.'
      : "Off for all your cannons: they keep the aim you gave them and never pick a target themselves (one whose target is captured holds its fire until you aim it). Each cannon's own toggle is kept for when this is back on. Starts on every game."
}

const rgba = (c: number, a: number): string => `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`

/**
 * The in-game Settings panel (top right, under the battle's top bar): the
 * global auto-target toggle, sound effects (on/off and volume) and the
 * performance overlay, one compact row each with the explanations behind "?".
 * HTML on the page at its real size (readable on phones), so presses on it
 * never reach the board.
 */
export class SettingsPanel {
  open = false
  private readonly el: HTMLDivElement
  private readonly autoSw: HTMLInputElement
  private readonly soundSw: HTMLInputElement
  private readonly perfSw: HTMLInputElement
  private readonly range: HTMLInputElement
  private readonly val: HTMLSpanElement
  private readonly autoSub: HTMLSpanElement
  private readonly autoRow: HTMLDivElement & { help?: HTMLSpanElement }
  private readonly soundRow: HTMLDivElement & { help?: HTMLSpanElement }
  private last = ''
  /** The last press on a control was a mouse or finger (then give focus back to the board). */
  private byPointer = false
  private readonly onResize = (): void => this.place()

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly actions: SettingsActions,
    /** Where the panel's top-right corner goes, in page pixels (under the top bar). */
    private readonly anchor: () => { top: number; right: number },
    private readonly onClose: () => void,
  ) {
    injectMenuStyles()
    injectPanelStyles()
    const sw = (id: string, label: string): HTMLInputElement => h('input.mm-switch', { type: 'checkbox', role: 'switch', id, 'aria-label': label, dataset: { id } }) as HTMLInputElement
    this.autoSw = sw('bs-auto', 'Auto-target')
    this.soundSw = sw('bs-sound', 'Sound effects')
    this.perfSw = sw('bs-perf', 'Performance')
    this.range = h('input.mm-range', { type: 'range', min: '0', max: '100', step: '5', id: 'bs-volume', dataset: { id: 'bs-volume' }, 'aria-label': 'Volume' }) as HTMLInputElement
    this.val = h('span.mm-val')
    this.autoSub = h('span')
    this.autoSw.addEventListener('change', () => this.act(() => this.actions.auto()))
    this.soundSw.addEventListener('change', () => this.act(() => this.actions.mute()))
    this.perfSw.addEventListener('change', () => this.act(() => this.actions.perf()))
    this.range.addEventListener('input', () => this.actions.volume(Number(this.range.value) / 100))
    this.range.addEventListener('change', () => this.act(() => {}))
    this.autoRow = settingRow({ id: 'bs-auto', label: 'Auto-target', for: 'bs-auto', sub: this.autoSub, help: autoHelp({ autoTarget: true, puzzle: false }), control: [this.autoSw] })
    this.soundRow = settingRow({ id: 'bs-sound', label: 'Sound effects', for: 'bs-sound', help: 'Saved on this device. N mutes or unmutes them. Music: Menu → Music.', control: [this.soundSw] })
    const close = h('button.bs-x', { type: 'button', 'aria-label': 'Close Settings', title: 'Close (Esc)', dataset: { id: 'bs-close' } }, '×')
    close.addEventListener('click', () => this.onClose())
    this.el = h('div.bs', { role: 'dialog', 'aria-label': 'Settings' },
      h('div.bs-head', {}, h('b', {}, 'Settings'), close),
      this.autoRow,
      this.soundRow,
      settingRow({ id: 'bs-volume', label: 'Volume', for: 'bs-volume', control: [this.range, this.val] }),
      settingRow({ id: 'bs-perf', label: 'Performance', for: 'bs-perf', sub: 'Also F3', help: 'FPS and timings in a small corner panel, with a Copy button for bug reports. Also F3 or ` (backtick).', control: [this.perfSw] }),
    )
    this.el.style.display = 'none'
    // Keys typed on the panel are the panel's (Space on a switch is not Pause); Esc still closes it.
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') e.stopPropagation()
    })
    this.el.addEventListener('pointerdown', () => (this.byPointer = true))
    document.body.append(this.el)
    window.addEventListener('resize', this.onResize)
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.onResize)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy())
  }

  /** Run a control's action; after a mouse or finger press, hand the keys back to the board. */
  private act(run: () => void): void {
    run()
    if (this.byPointer) (document.activeElement as HTMLElement | null)?.blur?.()
    this.byPointer = false
  }

  toggle(): void {
    if (this.open) this.hide()
    else this.show()
  }

  show(): void {
    if (this.open) return
    this.open = true
    this.last = ''
    this.el.style.display = ''
    this.place()
  }

  hide(): void {
    if (!this.open) return
    this.open = false
    this.el.style.display = 'none'
    closeHelpTips()
    if (this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
  }

  private place(): void {
    if (!this.open) return
    const a = this.anchor()
    const vw = window.innerWidth
    const w = Math.min(330, vw - 16)
    this.el.style.width = `${w}px`
    this.el.style.left = `${Math.max(8, Math.min(a.right, vw - 8) - w)}px`
    this.el.style.top = `${Math.max(8, a.top)}px`
    this.el.style.maxHeight = `${Math.max(120, window.innerHeight - a.top - 8)}px`
  }

  /** The panel's box in layout units (the board's coordinates). */
  private layoutBox(): { x: number; y: number; w: number; h: number } | null {
    if (!this.open) return null
    const c = this.scene.game.canvas.getBoundingClientRect()
    const r = this.el.getBoundingClientRect()
    const k = c.width / GAME_WIDTH
    if (!k) return null
    return { x: (r.left - c.left) / k, y: (r.top - c.top) / k, w: r.width / k, h: r.height / k }
  }

  contains(lx: number, ly: number): boolean {
    const b = this.layoutBox()
    return !!b && lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h
  }

  /** 'panel' when a layout point is on the panel (its controls handle themselves). */
  hitAt(lx: number, ly: number): SettingsHit | null {
    return this.contains(lx, ly) ? 'panel' : null
  }

  /** Bring the controls in step with the round (cheap when nothing changed). */
  draw(state: SettingsState): void {
    if (!this.open) return
    const key = JSON.stringify(state)
    if (key === this.last) return
    this.last = key
    const on = state.autoTarget && !state.puzzle
    this.autoSw.checked = on
    this.autoSw.disabled = state.puzzle
    this.autoSub.textContent = state.puzzle ? 'Off in puzzles' : state.autoTarget ? 'On for your cannons' : 'Off for all'
    if (this.autoRow.help) setHelpText(this.autoRow.help, autoHelp(state))
    const soundOn = state.audio && !state.muted && state.volume > 0
    this.soundSw.checked = soundOn
    this.soundSw.disabled = !state.audio
    this.range.disabled = !state.audio
    const v = Math.round(state.volume * 100)
    if (document.activeElement !== this.range) this.range.value = String(v)
    this.val.textContent = !state.audio ? '–' : state.muted ? 'Muted' : `${v}%`
    if (this.soundRow.help) setHelpText(this.soundRow.help, state.audio ? 'Saved on this device. N mutes or unmutes them. Music: Menu → Music.' : 'No sound in this browser.')
    this.perfSw.checked = state.perf
  }

  destroy(): void {
    this.hide()
    window.removeEventListener('resize', this.onResize)
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.onResize)
    this.el.remove()
  }
}

let styled = false

function injectPanelStyles(): void {
  if (styled) return
  styled = true
  const css = `
.bs {
  position: fixed; z-index: 6; box-sizing: border-box; overflow: auto; overscroll-behavior: contain;
  font-family: ${theme.font}; font-size: 14px; color: ${theme.text};
  background: ${rgba(theme.hud, 0.97)}; border: 1.5px solid ${cssHex(theme.boardEdge)}; border-radius: 12px;
  padding: 6px 12px 4px; box-shadow: 0 10px 28px ${rgba(0, 0.45)}; -webkit-tap-highlight-color: transparent; user-select: none;
}
.bs * { box-sizing: border-box; }
.bs-head { display: flex; align-items: center; justify-content: space-between; min-height: 34px; font-size: 15px; border-bottom: 1px solid ${rgba(theme.boardEdge, 0.7)}; }
.bs-x { font: bold 20px/1 ${theme.font}; color: ${theme.textMuted}; background: transparent; border: 0; border-radius: 8px; width: 34px; height: 34px; cursor: pointer; margin-right: -6px; }
.bs-x:hover { color: ${theme.text}; background: ${rgba(theme.grid, 0.8)}; }
.bs-x:focus-visible { outline: 2px solid ${cssHex(theme.player)}; }
.bs .mm-srow { min-height: 42px; }
.bs .mm-range { width: 150px; }
.bs .mm-val { min-width: 48px; }
.bs .mm-switch:disabled + * { opacity: .6; }
`
  document.head.appendChild(Object.assign(document.createElement('style'), { id: 'cc-battle-settings', textContent: css }))
}
