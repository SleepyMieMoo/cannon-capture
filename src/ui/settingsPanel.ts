import Phaser from 'phaser'
import { cssHex, theme } from '../config/theme'
import { GAME_WIDTH } from '../config/layout'
import { injectMenuStyles } from '../menu/menuStyles'
import { h } from './dom'
import { closeHelpTips, setHelpText } from './helpTip'
import { settingRow } from './settingRow'
import { copyText } from './copyText'
import { ICONS } from '../menu/art'
import type { MusicPlayer } from '../audio/music'
import { currentFx, onFxChange, saveFxChoice } from '../render/vfx/fxPrefs'
import type { FxQuality } from '../render/vfx/fxQuality'
import { loadMotionPref, onMotionChange, saveMotionPref, systemReduces, type MotionPref } from './motion'
import { loadTabPrefs } from '../menu/tabPrefs'
import { SKINS, SKIN_LABEL, type SkinId } from '../config/skins'
import { loadSkin, saveSkin } from '../menu/skinPref'
import { TEAM_COLOUR, TEAM_COLOURS } from '../config/teamColours'
import { loadColour, saveColour } from '../menu/colourPref'

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
  /** When tabbed out → Pause vs AI (the scene keeps its copy in step). */
  tabPause(on: boolean): void
  /** Copy debug info: the report text. */
  debugInfo(): string
}

/** What kind of round this is (for "from the next round / match" notes). */
export interface SettingsContext {
  online: boolean
  /** Another player is involved (online or the PvP test): their side's looks are theirs. */
  versus: boolean
}

/** The auto-target explanation for the state it is in. */
export function autoHelp(s: Pick<SettingsState, 'autoTarget' | 'puzzle'>): string {
  return s.puzzle
    ? 'Puzzles never auto-target: every aim there is yours to spend.'
    : s.autoTarget
      ? 'Your cannons pick a new target by themselves when theirs is captured, and cannons you capture aim at the nearest foe. To keep one cannon on manual, use the Auto pill in its hover menu (long-press on touch) or press M over it. Starts on every game.'
      : "Off for all your cannons: they keep the aim you gave them and never pick a target themselves (one whose target is captured holds its fire until you aim it). Each cannon's own toggle is kept for when this is back on. Starts on every game."
}

/** When a looks change shows: never mid-round (the board keeps its colours), from the next one. */
export function looksNote(ctx: SettingsContext): string {
  return ctx.online ? 'From the next match' : 'From the next round'
}

const rgba = (c: number, a: number): string => `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`
const icon = (svg: string): HTMLSpanElement => h('span.ic', { innerHTML: svg })

/**
 * The in-game Settings panel (top right, under the battle's top bar): every
 * setting the main menu has, so nobody needs to leave a battle for one.
 * Battle (auto-target), Sound, Music (on, song, Repeat, volume, pulse),
 * Display (effects, reduce motion, performance), When tabbed out, Your looks
 * (from the next round) and Copy debug info; one compact row each, the
 * explanations behind "?". Two columns when there is room. HTML on the page
 * at its real size (readable on phones), so presses on it never reach the board.
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
  private readonly copyNote: HTMLSpanElement
  private readonly offs: (() => void)[] = []
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
    ctx: SettingsContext = { online: false, versus: false },
    private readonly music: MusicPlayer | null = null,
  ) {
    injectMenuStyles()
    injectPanelStyles()
    this.autoSw = sw('bs-auto', 'Auto-target')
    this.soundSw = sw('bs-sound', 'Sound effects')
    this.perfSw = sw('bs-perf', 'Performance')
    this.range = h('input.mm-range', { type: 'range', min: '0', max: '100', step: '5', id: 'bs-volume', dataset: { id: 'bs-volume' }, 'aria-label': 'Volume' }) as HTMLInputElement
    this.val = h('span.mm-val')
    this.autoSub = h('span')
    this.copyNote = h('span', { 'aria-live': 'polite' })
    this.autoSw.addEventListener('change', () => this.act(() => this.actions.auto()))
    this.soundSw.addEventListener('change', () => this.act(() => this.actions.mute()))
    this.perfSw.addEventListener('change', () => this.act(() => this.actions.perf()))
    this.range.addEventListener('input', () => this.actions.volume(Number(this.range.value) / 100))
    this.range.addEventListener('change', () => this.act(() => {}))
    this.autoRow = settingRow({ id: 'bs-auto', label: 'Auto-target', for: 'bs-auto', sub: this.autoSub, help: autoHelp({ autoTarget: true, puzzle: false }), control: [this.autoSw] })
    this.soundRow = settingRow({ id: 'bs-sound', label: 'Sound effects', for: 'bs-sound', help: 'Shots pop; captures and broken barriers pop deeper. Saved on this device. N mutes or unmutes them.', control: [this.soundSw] })
    const close = h('button.bs-x', { type: 'button', 'aria-label': 'Close Settings', title: 'Close (Esc)', dataset: { id: 'bs-close' } }, '×')
    close.addEventListener('click', () => this.onClose())
    const copy = h('button.mm-btn.small', { type: 'button', dataset: { id: 'bs-debug' } }, icon(ICONS.copy), 'Copy')
    copy.addEventListener('click', () =>
      this.act(() => {
        void copyText(this.actions.debugInfo()).then((how) => {
          this.copyNote.textContent = how === 'manual' ? 'Copy blocked here' : 'Copied'
          window.setTimeout(() => (this.copyNote.textContent = ''), 2500)
        })
      }),
    )
    const head = (t: string): HTMLElement => h('div.bs-h', {}, t)
    this.el = h('div.bs', { role: 'dialog', 'aria-label': 'Settings' },
      h('div.bs-head', {}, h('b', {}, 'Settings'), h('span.bs-saved', {}, 'Saved on this device'), close),
      h('div.bs-body', {},
        h('section.bs-col', {},
          head('Battle'),
          this.autoRow,
          head('Sound'),
          this.soundRow,
          settingRow({ id: 'bs-volume', label: 'Volume', for: 'bs-volume', control: [this.range, this.val] }),
          ...this.musicRows(),
        ),
        h('section.bs-col', {},
          head('Display'),
          this.segRow('bs-fx', 'Effects', 'Battle effects: team glows under cannons, muzzle flashes, shot trails, sparks and capture bursts. Low keeps the glows and trims the rest; Off is the plain look. Changes at once.', FX_CHOICES, () => currentFx().quality, (id) => saveFxChoice(id as FxQuality), onFxChange),
          this.segRow('bs-motion', 'Reduce motion', `Stills shakes, sliding or popping panels and confetti. Auto follows your device’s own setting (${systemReduces() ? 'on' : 'off'} here). Changes at once.`, MOTION_CHOICES, () => loadMotionPref(), (id) => saveMotionPref(id as MotionPref), onMotionChange),
          settingRow({ id: 'bs-perf', label: 'Performance', for: 'bs-perf', sub: 'Also F3', help: 'FPS and timings in a small corner panel, with a Copy button for bug reports. Also F3 or ` (backtick).', control: [this.perfSw] }),
          head('When tabbed out'),
          ...this.tabRows(),
          head('Your looks'),
          ...this.looksRows(ctx),
          head('Bug reports'),
          settingRow({ id: 'bs-debug', label: 'Debug info', sub: this.copyNote, help: 'Copies the game version, browser, screen size, renderer and your settings, nothing personal, to paste into a bug report.', control: [copy] }),
        ),
      ),
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

  /** Music: on/off with the song and its controls (previous, next, Repeat), its own volume, and pulse. */
  private musicRows(): HTMLElement[] {
    const m = this.music
    if (!m) return []
    const onSw = sw('bs-music', 'Music')
    onSw.addEventListener('change', () => this.act(() => (onSw.checked ? m.play() : m.pause())))
    const song = h('span.bs-song')
    const btn = (id: string, label: string, svg: string, run: () => void): HTMLButtonElement => {
      const b = h('button.bs-ic', { type: 'button', title: label, 'aria-label': label, dataset: { id } }, icon(svg))
      b.addEventListener('click', () => this.act(run))
      return b
    }
    const repeat = btn('bs-repeat', 'Repeat this song', ICONS.repeat, () => m.setRepeat(!m.settings.repeat))
    const ctrls = h('div.bs-ctrl', {}, btn('bs-prev', 'Previous song', ICONS.prev, () => m.prev()), btn('bs-next', 'Next song', ICONS.next, () => m.next()), repeat)
    const range = h('input.mm-range', { type: 'range', min: '0', max: '100', step: '5', id: 'bs-music-volume', dataset: { id: 'bs-music-volume' }, 'aria-label': 'Music volume' }) as HTMLInputElement
    const val = h('span.mm-val')
    range.addEventListener('input', () => m.setVolume(Number(range.value) / 100))
    range.addEventListener('change', () => this.act(() => {}))
    const pulse = sw('bs-pulse', 'Pulse to the music')
    pulse.addEventListener('change', () => this.act(() => m.setPulse(pulse.checked)))
    const update = (): void => {
      onSw.checked = m.playing
      song.textContent = m.track.short
      song.title = `Now: ${m.track.title}`
      repeat.setAttribute('aria-pressed', String(m.settings.repeat))
      repeat.title = m.settings.repeat ? 'Repeat on: this song keeps playing' : 'Repeat off: every song plays in turn'
      pulse.checked = m.settings.pulse
      const v = Math.round(m.settings.volume * 100)
      if (document.activeElement !== range) range.value = String(v)
      val.textContent = `${v}%`
    }
    update()
    this.offs.push(m.onChange(update))
    return [
      h('div.bs-h', {}, 'Music'),
      settingRow({ id: 'bs-music', label: 'Music', for: 'bs-music', sub: song, help: 'The jukebox: songs play in turn; Repeat (↻) keeps this one going. Its own volume, apart from sound effects. The star for the starting song is in Menu → Music.', control: [ctrls, onSw] }),
      settingRow({ id: 'bs-music-volume', label: 'Music volume', for: 'bs-music-volume', control: [range, val] }),
      settingRow({ id: 'bs-pulse', label: 'Pulse to the music', for: 'bs-pulse', help: 'Small UI pulses on the music’s beat (the cannon bar, title glows). Off under Reduce motion.', control: [pulse] }),
    ]
  }

  /** When tabbed out: keep the music going, and pause vs AI. */
  private tabRows(): HTMLElement[] {
    const rows: HTMLElement[] = []
    const m = this.music
    if (m) {
      const keep = sw('bs-tab-music', 'Keep music playing')
      keep.checked = m.settings.keepHidden
      keep.addEventListener('change', () => this.act(() => m.setKeepHidden(keep.checked)))
      this.offs.push(m.onChange(() => (keep.checked = m.settings.keepHidden)))
      rows.push(settingRow({ id: 'bs-tab-music', label: 'Keep music playing', for: 'bs-tab-music', help: 'Music carries on while the game is in another tab or window. Sound effects are always silent in the background.', control: [keep] }))
    }
    const pause = sw('bs-tab-pause', 'Pause vs AI')
    pause.checked = loadTabPrefs().pauseVsAi
    pause.addEventListener('change', () => this.act(() => this.actions.tabPause(pause.checked)))
    rows.push(settingRow({ id: 'bs-tab-pause', label: 'Pause vs AI', for: 'bs-tab-pause', help: 'On: against the AI (and in puzzles and levels) the round pauses when you switch away. Off: it keeps going, and up to a minute is played back silently when you return. Online matches always keep going.', control: [pause] }))
    return rows
  }

  /** Cannon skin and team colour: saved now, worn from the next round (the board keeps its look mid-round). */
  private looksRows(ctx: SettingsContext): HTMLElement[] {
    const note = looksNote(ctx)
    const skin = h('select.bs-select', { id: 'bs-skin', dataset: { id: 'bs-skin' }, 'aria-label': 'Cannon skin' }, ...SKINS.map((id) => h('option', { value: id }, SKIN_LABEL[id]))) as HTMLSelectElement
    skin.value = loadSkin()
    skin.addEventListener('change', () => this.act(() => saveSkin(skin.value as SkinId)))
    const sw0 = TEAM_COLOURS.map((id) => {
      const b = h('button.bs-sw', { type: 'button', title: TEAM_COLOUR[id].label, 'aria-label': TEAM_COLOUR[id].label, dataset: { id: 'bs-colour-' + id }, style: `--c:${cssHex(TEAM_COLOUR[id].hex)}` })
      b.addEventListener('click', () =>
        this.act(() => {
          saveColour(id)
          for (const x of sw0) x.setAttribute('aria-pressed', String(x === b))
        }),
      )
      return b
    })
    const mine = loadColour()
    sw0.forEach((b, i) => b.setAttribute('aria-pressed', String(TEAM_COLOURS[i] === mine)))
    const looksHelp = `${note}: this round keeps its look.${ctx.versus ? ' Online, each player always wears their own; if both look alike, small name tags appear.' : ' The AI wears a contrasting skin and colour.'} Also in Profile.`
    return [
      settingRow({ id: 'bs-skin', label: 'Cannon skin', for: 'bs-skin', sub: note, help: looksHelp, control: [skin] }),
      settingRow({ id: 'bs-colour', label: 'Team colour', sub: note, help: looksHelp, layout: 'block', control: [h('div.bs-sws', { role: 'group', 'aria-label': 'Team colour' }, ...sw0)] }),
    ]
  }

  /** A row of segmented choices (effects, reduce motion), kept in step by its own change event. */
  private segRow(id: string, label: string, help: string, choices: readonly { id: string; label: string }[], get: () => string, set: (id: string) => void, onChange: (fn: () => void) => () => void): HTMLElement {
    const segs = choices.map((c) => {
      const b = h('button.mm-seg', { type: 'button', dataset: { id: `${id}-${c.id}` } }, c.label)
      b.addEventListener('click', () => this.act(() => set(c.id)))
      return b
    })
    const update = (): void => {
      const cur = get()
      segs.forEach((b, i) => b.setAttribute('aria-pressed', String(choices[i].id === cur)))
    }
    update()
    this.offs.push(onChange(update))
    return settingRow({ id, label, help, layout: 'wide', control: [h('div.mm-segs.bs-segs', { role: 'group', 'aria-label': label }, ...segs)] })
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
    // Two columns when there is room for them, else one.
    const w = Math.min(vw >= 720 ? 640 : 360, vw - 16)
    this.el.style.width = `${w}px`
    this.el.classList.toggle('two', w >= 600)
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
    if (this.soundRow.help) setHelpText(this.soundRow.help, state.audio ? 'Shots pop; captures and broken barriers pop deeper. Saved on this device. N mutes or unmutes them.' : 'No sound in this browser.')
    this.perfSw.checked = state.perf
  }

  destroy(): void {
    this.hide()
    for (const off of this.offs.splice(0)) off()
    window.removeEventListener('resize', this.onResize)
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.onResize)
    this.el.remove()
  }
}

const FX_CHOICES = [
  { id: 'high', label: 'High' },
  { id: 'low', label: 'Low' },
  { id: 'off', label: 'Off' },
] as const
const MOTION_CHOICES = [
  { id: 'auto', label: 'Auto' },
  { id: 'on', label: 'On' },
  { id: 'off', label: 'Off' },
] as const

function sw(id: string, label: string): HTMLInputElement {
  return h('input.mm-switch', { type: 'checkbox', role: 'switch', id, 'aria-label': label, dataset: { id } }) as HTMLInputElement
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
  padding: 0 12px 6px; box-shadow: 0 10px 28px ${rgba(0, 0.45)}; -webkit-tap-highlight-color: transparent; user-select: none;
}
.bs * { box-sizing: border-box; }
.bs-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 8px; min-height: 38px; font-size: 15px; background: ${rgba(theme.hud, 0.99)}; border-bottom: 1px solid ${rgba(theme.boardEdge, 0.7)}; }
.bs-saved { flex: 1; min-width: 0; font-size: 12px; color: ${theme.textMuted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bs-x { flex: none; font: bold 20px/1 ${theme.font}; color: ${theme.textMuted}; background: transparent; border: 0; border-radius: 8px; width: 34px; height: 34px; cursor: pointer; margin-right: -6px; }
.bs-x:hover { color: ${theme.text}; background: ${rgba(theme.grid, 0.8)}; }
.bs-x:focus-visible { outline: 2px solid ${cssHex(theme.player)}; }
.bs-body { display: grid; grid-template-columns: minmax(0, 1fr); column-gap: 18px; }
.bs.two .bs-body { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.bs-col { min-width: 0; }
.bs-h { margin: 8px 0 0; font-size: 11px; font-weight: bold; letter-spacing: .08em; text-transform: uppercase; color: ${theme.textMuted}; }
.bs .mm-srow { min-height: 38px; padding-top: 3px; padding-bottom: 3px; }
.bs .mm-range { width: 120px; min-width: 0; flex: 1 1 90px; }
.bs .mm-val { min-width: 44px; }
.bs .mm-switch:disabled + * { opacity: .6; }
.bs-segs { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; min-width: 168px; }
.bs-segs .mm-seg { min-height: 32px; padding: 2px 6px; font-size: 13px; }
.bs-ctrl { display: flex; gap: 4px; margin-right: 6px; }
.bs-ic { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border-radius: 50%; cursor: pointer; color: ${theme.text}; background: ${rgba(theme.board, 0.94)}; border: 1.5px solid ${cssHex(theme.boardEdge)}; }
.bs-ic .ic { width: 15px; height: 15px; display: grid; }
.bs-ic:hover { border-color: ${cssHex(theme.player)}; }
.bs-ic[aria-pressed="true"] { color: ${cssHex(theme.player)}; border-color: ${cssHex(theme.player)}; }
.bs-ic:focus-visible, .bs-sw:focus-visible, .bs-select:focus-visible { outline: 2px solid ${cssHex(theme.player)}; outline-offset: 2px; }
.bs-song { display: block; max-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bs-select { font: inherit; font-size: 14px; color: ${theme.text}; background: ${rgba(theme.board, 0.94)}; border: 1.5px solid ${cssHex(theme.boardEdge)}; border-radius: 8px; padding: 4px 8px; min-height: 32px; }
.bs-sws { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 0 4px; }
.bs-sw { width: 26px; height: 26px; padding: 0; border-radius: 50%; cursor: pointer; background: var(--c); border: 2px solid ${rgba(theme.hud, 1)}; box-shadow: 0 0 0 1.5px ${cssHex(theme.boardEdge)}; }
.bs-sw[aria-pressed="true"] { box-shadow: 0 0 0 2.5px ${theme.text}; }
.bs .mm-btn.small { min-height: 32px; padding: 4px 10px; font-size: 13px; gap: 6px; }
.bs .mm-btn.small .ic { width: 14px; height: 14px; display: inline-grid; }
`
  document.head.appendChild(Object.assign(document.createElement('style'), { id: 'cc-battle-settings', textContent: css }))
}
