import { CONTRAST, SKINS, SKIN_LABEL } from '../config/skins'
import { loadSkin, saveSkin } from './skinPref'
import { CONTRAST_COLOUR, TEAM_COLOUR, TEAM_COLOURS, vsAiColours, type TeamColourId } from '../config/teamColours'
import { applyTeamColours, cssHex } from '../config/theme'
import { loadColour, saveColour } from './colourPref'
import { BRAND } from '../config/brand'
import { MAP_SIZES } from '../levels/board'
import { drawThumb } from '../editor/thumb'
import { listMaps } from '../editor/maps'
import { loadProgress } from '../progress'
import { AI_LEVELS, type AiLevel, type LevelDef } from '../types'
import type { AudioSettings } from '../audio/audioSettings'
import { h } from '../ui/overlay'
import { howtoTips, ICONS, KEYS, skinPreview } from './art'
import { DIFFICULTY, loadMenuPrefs, pickMap, puzzleChoices, saveMenuPrefs, vsAiMaps, type MenuPrefs, type PuzzleChoice } from './menuModel'
import { injectMenuStyles } from './menuStyles'
import { friendsScreen, lobbyScreen, type MenuKit, type OnlineMenu } from './onlineMenu'
import { MenuNav, vsAiLevel, type MapChoice, type MenuScreen } from './routes'

/** What the menu asks the game to do. */
export interface MenuActions {
  playVsAi(level: LevelDef): void
  playPuzzle(p: PuzzleChoice): void
  levels(): void
  editor(): void
  myMaps(): void
  getAudio(): AudioSettings
  setAudio(s: AudioSettings): void
  /** Play a sample pop at the current volume (after a change). */
  previewSound(): void
  /** The performance overlay switch (optional so tests can leave it out). */
  perf?: { get(): boolean; set(on: boolean): void; onChange(fn: (on: boolean) => void): () => void }
  /** Online play with friends (left out inside Discord and in tests). */
  online?: OnlineMenu
}

const icon = (svg: string): HTMLSpanElement => h('span', { innerHTML: svg, style: 'display:inline-flex' })

function summary(level: LevelDef): string {
  const n = (side: string): number => level.cannons.filter((c) => c.side === side).length
  return `${MAP_SIZES[level.size ?? 'small'].label} board · ${n('player')} vs ${n('enemy')} · ${n('neutral')} neutral`
}

/**
 * The main menu: HTML over the title scene's animated board. Every screen
 * is real buttons (Tab / arrow keys / Enter / touch all work), Esc and the
 * Back button go up one screen, and it never needs the page to scroll.
 */
export class MainMenu {
  readonly root: HTMLDivElement
  readonly nav: MenuNav
  prefs: MenuPrefs
  /** The button that opened each screen, focused again when you come back. */
  private readonly opener = new Map<MenuScreen, string>()
  private readonly onKey = (e: KeyboardEvent): void => this.key(e)
  private readonly offPerf: () => void
  private teardown: (() => void)[] = []
  /** Redraw this screen's map thumbnails (they show your team colours). */
  private thumbs: (() => void)[] = []
  private readonly kit: MenuKit = {
    button: (id, label, onClick, opts) => this.button(id, label, onClick, opts),
    screenFrame: (title, sub, body, footer) => this.screenFrame(title, sub, body, footer),
    open: (screen, from) => this.open(screen, from),
    back: () => this.back(),
    onTeardown: (fn) => this.teardown.push(fn),
  }

  constructor(
    private readonly actions: MenuActions,
    start: MenuScreen = 'home',
  ) {
    injectMenuStyles()
    // The menu's pictures (How to play, previews) use your colours.
    applyTeamColours(vsAiColours(loadColour()))
    this.nav = new MenuNav(start)
    this.prefs = loadMenuPrefs()
    this.root = h('div.mm', { role: 'dialog', 'aria-label': BRAND.title })
    document.body.appendChild(this.root)
    window.addEventListener('keydown', this.onKey)
    // F3 / backtick can flip the overlay while Settings is open: keep the switch in step.
    this.offPerf =
      actions.perf?.onChange((on) => {
        const sw = this.root.querySelector<HTMLInputElement>('#mm-perf')
        if (sw) sw.checked = on
      }) ?? (() => {})
    this.render()
  }

  destroy(): void {
    this.runTeardown()
    this.offPerf()
    window.removeEventListener('keydown', this.onKey)
    this.root.remove()
  }

  get screen(): MenuScreen {
    return this.nav.screen
  }

  open(screen: MenuScreen, from?: string): void {
    if (from) this.opener.set(screen, from)
    this.nav.open(screen)
    this.render()
  }

  back(): boolean {
    const leaving = this.nav.screen
    if (leaving === 'lobby') this.actions.online?.leave()
    if (!this.nav.back()) return false
    this.render(this.opener.get(leaving))
    return true
  }

  private key(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.back()) e.preventDefault()
      return
    }
    const target = e.target as HTMLElement | null
    const inRange = target instanceof HTMLInputElement && target.type === 'range'
    const dir = e.key === 'ArrowDown' || (e.key === 'ArrowRight' && !inRange) ? 1 : e.key === 'ArrowUp' || (e.key === 'ArrowLeft' && !inRange) ? -1 : 0
    if (!dir) return
    const items = [...this.root.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href]')]
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = items[(i < 0 ? (dir > 0 ? 0 : items.length - 1) : (i + dir + items.length) % items.length)]
    next.focus()
    e.preventDefault()
  }

  private runTeardown(): void {
    for (const fn of this.teardown.splice(0)) fn()
    this.thumbs = []
  }

  private render(focusId?: string): void {
    this.runTeardown()
    const screen = this.nav.screen
    this.root.dataset.screen = screen
    const view =
      screen === 'home'
        ? this.home()
        : screen === 'play'
          ? this.play()
          : screen === 'puzzles'
            ? this.puzzles()
            : screen === 'settings'
              ? this.settings()
              : screen === 'friends' && this.actions.online
                ? friendsScreen(this.kit, this.actions.online)
                : screen === 'lobby' && this.actions.online
                  ? this.lobby(this.actions.online)
                  : this.howto()
    this.root.replaceChildren(view)
    const focus = (focusId && this.root.querySelector<HTMLElement>(`[data-id="${focusId}"]`)) || this.root.querySelector<HTMLElement>('[data-autofocus]') || this.root.querySelector<HTMLElement>('[data-id="back"]')
    focus?.focus({ preventScroll: true })
  }

  /** The room screen, drawn again whenever the room changes. */
  private lobby(online: OnlineMenu): HTMLElement {
    const room = online.room()
    if (room) {
      this.teardown.push(
        room.onChange(() => {
          if (this.nav.screen !== 'lobby') return
          const id = (document.activeElement as HTMLElement | null)?.dataset?.id
          this.render(id)
        }),
      )
    }
    return lobbyScreen(this.kit, online)
  }

  private button(id: string, label: string, onClick: () => void, opts: { icon?: string; cls?: string; autofocus?: boolean } = {}): HTMLButtonElement {
    const b = h(`button.mm-btn${opts.cls ? '.' + opts.cls : ''}`, { type: 'button', dataset: { id }, onclick: onClick })
    if (opts.icon) b.append(icon(opts.icon))
    b.append(label)
    if (opts.autofocus) b.dataset.autofocus = ''
    return b
  }

  private screenFrame(title: string, sub: string, body: (Node | null)[], footer?: HTMLElement): HTMLElement {
    const back = this.button('back', 'Back', () => this.back(), { icon: ICONS.back, cls: 'mm-back' })
    back.title = 'Back (Esc)'
    return h('div.mm-screen', {},
      h('div.mm-head', {}, back, h('h2', {}, title), h('div.mm-sub', {}, sub)),
      h('div.mm-body', {}, ...body),
      footer ?? null,
    )
  }

  // ------------------------------------------------------------ screens

  private home(): HTMLElement {
    const go = (screen: MenuScreen) => () => this.open(screen, screen)
    const soon = this.actions.online
      ? h('button.mm-soon.live', { type: 'button', title: 'Play online against a friend', dataset: { id: 'friends' }, onclick: go('friends') }, icon(ICONS.friends), h('b', {}, 'Play with friends'), '· Online 1v1')
      : h('button.mm-soon', { type: 'button', disabled: true, title: 'Coming soon', dataset: { id: 'friends' } }, icon(ICONS.friends), h('b', {}, 'Play with friends'), '· Coming soon')
    return h('div.mm-home', {},
      h('div.mm-title', {}, BRAND.title),
      h('div.mm-by', {}, BRAND.byline),
      h('div.mm-tag', {}, BRAND.tagline),
      h('div.mm-grid', {},
        this.button('play', 'Play vs AI', go('play'), { icon: ICONS.play, cls: 'big.primary', autofocus: true }),
        this.button('puzzles', 'Puzzles', go('puzzles'), { icon: ICONS.puzzle }),
        this.button('levels', BRAND.levelsLabel, () => this.actions.levels(), { icon: ICONS.levels }),
        this.button('editor', 'Map editor', () => this.actions.editor(), { icon: ICONS.editor }),
        this.button('maps', 'My maps', () => this.actions.myMaps(), { icon: ICONS.maps }),
        this.button('settings', 'Settings', go('settings'), { icon: ICONS.settings }),
        this.button('howto', 'How to play', go('howto'), { icon: ICONS.help }),
      ),
      soon,
      h('div.mm-foot', {}, 'Colours from ChocoNeko’s Dark Choco theme'),
    )
  }

  private play(): HTMLElement {
    const choices = vsAiMaps(listMaps())
    let map = pickMap(choices, this.prefs.mapId)
    let diff: AiLevel = this.prefs.difficulty
    const save = (): void => {
      this.prefs = { difficulty: diff, mapId: map.id }
      saveMenuPrefs(this.prefs)
    }
    const pickName = h('div.n', {}, map.name)
    const pickInfo = h('div.mm-note', {}, summary(map.level))
    const blurb = h('div.mm-blurb', {}, DIFFICULTY[diff].blurb)
    const cards: HTMLButtonElement[] = []
    const start = (): void => {
      save()
      this.actions.playVsAi(vsAiLevel(map, diff))
    }
    const card = (c: MapChoice): HTMLButtonElement => {
      const canvas = h('canvas')
      drawThumb(canvas, c.level, 168)
      this.thumbs.push(() => drawThumb(canvas, c.level, 168))
      const el = h('button.mm-card', { type: 'button', dataset: { id: 'map-' + c.id }, title: c.name, 'aria-pressed': String(c.id === map.id) },
        canvas,
        h('div.n', {}, c.name),
        h('div.m', {}, h('span', {}, MAP_SIZES[c.level.size ?? 'small'].label), h('span', {}, c.group === 'My maps' ? 'Yours' : '')),
      )
      if (c.id === map.id) {
        el.classList.add('on')
        el.dataset.autofocus = ''
      }
      el.addEventListener('click', () => {
        if (map.id === c.id && el.classList.contains('on') && el.dataset.clicked) return start()
        map = c
        for (const x of cards) {
          x.classList.toggle('on', x === el)
          x.setAttribute('aria-pressed', String(x === el))
          delete x.dataset.clicked
        }
        el.dataset.clicked = '1'
        pickName.textContent = c.name
        pickInfo.textContent = summary(c.level)
        save()
      })
      el.addEventListener('dblclick', start)
      cards.push(el)
      return el
    }
    const builtIn = choices.filter((c) => c.group === 'Built-in')
    const mine = choices.filter((c) => c.group === 'My maps')
    const segs = AI_LEVELS.map((d) => {
      const b = h('button.mm-seg', { type: 'button', dataset: { id: 'diff-' + d }, 'aria-pressed': String(d === diff), title: DIFFICULTY[d].blurb }, DIFFICULTY[d].label)
      b.addEventListener('click', () => {
        diff = d
        for (const s of segs) s.setAttribute('aria-pressed', String(s === b))
        blurb.textContent = DIFFICULTY[d].blurb
        save()
      })
      return b
    })
    return this.screenFrame('Play vs AI', 'Pick a map and how smart the AI plays', [
      h('div.mm-play', {},
        h('div', {},
          h('div.mm-h', {}, 'Map'),
          h('div.mm-cards', {}, ...builtIn.map(card)),
          h('div.mm-h', {}, 'My maps'),
          mine.length ? h('div.mm-cards', {}, ...mine.map(card)) : h('div.mm-note', {}, 'Battle maps you make in the editor show up here.'),
        ),
        h('div.mm-side', {},
          h('div.mm-h', {}, 'Difficulty'),
          h('div.mm-segs', {}, ...segs),
          blurb,
          h('div.mm-note', {}, 'Every level fires and turns like you do: difficulty is only how well the AI thinks.'),
          h('div.mm-h', { style: 'margin-top:14px' }, 'Your skin'),
          this.skinPicker(true),
          h('div.mm-h', { style: 'margin-top:10px' }, 'Your colour'),
          this.colourPicker(true),
        ),
      ),
    ],
    // Always on screen, even when the map list has to scroll (phones).
    h('div.mm-bar', {}, h('div.mm-pick', {}, pickName, pickInfo), this.button('start', 'Start battle', start, { icon: ICONS.play, cls: 'big.primary' })),
    )
  }

  private puzzles(): HTMLElement {
    const all = puzzleChoices(loadProgress(), listMaps())
    const card = (p: PuzzleChoice, i: number): HTMLButtonElement => {
      const canvas = h('canvas')
      drawThumb(canvas, p.level, 168)
      this.thumbs.push(() => drawThumb(canvas, p.level, 168))
      const stars = p.custom ? '' : '★'.repeat(p.stars) + '☆'.repeat(3 - p.stars)
      const el = h('button.mm-card', { type: 'button', dataset: { id: 'puzzle-' + p.id }, title: p.name },
        canvas,
        h('div.n', {}, p.name),
        h('div.m', {}, h('span', {}, p.label), h('span.st', { 'aria-label': `${p.stars} of 3 stars` }, stars)),
      )
      if (i === 0) el.dataset.autofocus = ''
      el.addEventListener('click', () => this.actions.playPuzzle(p))
      return el
    }
    const campaign = all.filter((p) => !p.custom)
    const mine = all.filter((p) => p.custom)
    return this.screenFrame('Puzzles', 'A few aims, no enemy: capture everything', [
      h('div.mm-cards', {}, ...campaign.map(card)),
      h('div.mm-h', {}, 'Your puzzle maps'),
      mine.length ? h('div.mm-cards', {}, ...mine.map((p, i) => card(p, campaign.length + i))) : h('div.mm-note', {}, 'Make one in the editor (set the map to Puzzle) and it shows up here.'),
    ])
  }

  /**
   * The skin picker: one button per skin, with a preview. `small` is the
   * compact row on the Play vs AI panel. `vs` shows the skin pink wears.
   */
  private skinPicker(small: boolean): HTMLElement {
    let skin = loadSkin()
    const vsText = (): string => `The AI wears ${SKIN_LABEL[CONTRAST[skin]]}.`
    const vs = h('div.mm-note', {}, vsText())
    const btns: HTMLButtonElement[] = SKINS.map((s) => {
      const b = h(small ? 'button.mm-skin.small' : 'button.mm-skin', { type: 'button', dataset: { id: (small ? 'skin-s-' : 'skin-') + s }, 'aria-pressed': String(s === skin), title: SKIN_LABEL[s] },
        h('span.pv', { innerHTML: skinPreview(s), dataset: { pvSkin: s } }),
        h('span.n', {}, SKIN_LABEL[s]),
      )
      b.addEventListener('click', () => {
        skin = s
        saveSkin(s)
        for (const x of btns) x.setAttribute('aria-pressed', String(x === b))
        vs.textContent = vsText()
        this.refreshPreviews()
      })
      return b
    })
    return h('div', {}, h(small ? 'div.mm-skins.small' : 'div.mm-skins', { role: 'group', 'aria-label': 'Cannon skin' }, ...btns), vs)
  }

  /**
   * The team colour picker: eight swatches, each a cannon in that colour and
   * your skin. `small` is the compact row on Play vs AI (names on hover and
   * in the line below). The line below says which colour the AI wears.
   */
  private colourPicker(small: boolean): HTMLElement {
    let colour = loadColour()
    const vs = h('div.mm-note.mm-vs', {})
    const dot = (c: TeamColourId): HTMLElement => h('i', { style: `background:${cssHex(TEAM_COLOUR[c].hex)}` })
    const vsText = (): void => {
      const ai = CONTRAST_COLOUR[colour]
      vs.replaceChildren(...(small ? [dot(colour), `${TEAM_COLOUR[colour].label}. `] : []), 'The AI wears ', dot(ai), `${TEAM_COLOUR[ai].label}.`)
    }
    vsText()
    const btns: HTMLButtonElement[] = TEAM_COLOURS.map((c) => {
      const b = h(small ? 'button.mm-skin.small' : 'button.mm-skin', { type: 'button', dataset: { id: (small ? 'colour-s-' : 'colour-') + c }, 'aria-pressed': String(c === colour), title: TEAM_COLOUR[c].label },
        h('span.pv', { innerHTML: skinPreview(loadSkin(), 'player', TEAM_COLOUR[c].hex), dataset: { pvColour: c } }),
        h('span.n', {}, TEAM_COLOUR[c].label),
      )
      b.addEventListener('click', () => {
        colour = c
        // The title's demo battle and the menu's pictures recolour at once.
        applyTeamColours(vsAiColours(c))
        saveColour(c)
        for (const x of btns) x.setAttribute('aria-pressed', String(x === b))
        vsText()
        this.refreshPreviews()
      })
      return b
    })
    return h('div', {}, h(small ? 'div.mm-skins.colours.small' : 'div.mm-skins.colours', { role: 'group', 'aria-label': 'Team colour' }, ...btns), vs)
  }

  /** Skin previews show your colour and colour swatches your skin: redraw both after either changes. */
  private refreshPreviews(): void {
    const skin = loadSkin()
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-pv-skin]')) el.innerHTML = skinPreview(el.dataset.pvSkin as typeof skin)
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-pv-colour]')) el.innerHTML = skinPreview(skin, 'player', TEAM_COLOUR[el.dataset.pvColour as TeamColourId].hex)
    for (const draw of this.thumbs) draw()
  }

  private settings(): HTMLElement {
    const audio = this.actions.getAudio()
    const val = h('span.mm-val', {}, `${Math.round(audio.volume * 100)}%`)
    const sw = h('input.mm-switch', { type: 'checkbox', role: 'switch', checked: !audio.muted, id: 'mm-sound', dataset: { id: 'sound', autofocus: '' } })
    const range = h('input.mm-range', { type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(audio.volume * 100)), id: 'mm-volume', dataset: { id: 'volume' }, 'aria-label': 'Volume' })
    sw.addEventListener('change', () => {
      const s = this.actions.getAudio()
      this.actions.setAudio({ ...s, muted: !sw.checked })
      if (sw.checked) this.actions.previewSound()
    })
    range.addEventListener('input', () => {
      const v = Number(range.value) / 100
      val.textContent = `${Math.round(v * 100)}%`
      this.actions.setAudio({ volume: v, muted: v <= 0 ? true : false })
      sw.checked = v > 0
    })
    range.addEventListener('change', () => this.actions.previewSound())
    const perf = this.actions.perf
    const perfSw = perf ? h('input.mm-switch', { type: 'checkbox', role: 'switch', checked: perf.get(), id: 'mm-perf', dataset: { id: 'perf' } }) : null
    perfSw?.addEventListener('change', () => perf?.set(perfSw.checked))
    const a = (href: string, text: string): HTMLAnchorElement => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text)
    return this.screenFrame('Settings', 'Saved on this device', [
      h('div.mm-set', {},
        h('div', {},
          h('div.mm-h', {}, 'Sound'),
          h('div.mm-row', {}, sw, h('label', { htmlFor: 'mm-sound' }, 'Sound effects')),
          h('div.mm-row', {}, h('label', { htmlFor: 'mm-volume' }, 'Volume'), range, val),
          h('div.mm-note', {}, 'Shots pop; captures and broken barriers pop deeper. N mutes or unmutes during a battle. The title screen stays silent.'),
          h('div.mm-h', { style: 'margin-top:16px' }, 'In battle'),
          h('div.mm-note', {}, 'Auto-target (your guns re-aim by themselves when a target is captured) is switched in the battle’s own Settings, or per cannon with M. It starts on at the start of every game.'),
          ...(perfSw
            ? [
                h('div.mm-h', { style: 'margin-top:16px' }, 'Performance'),
                h('div.mm-row', {}, perfSw, h('label', { htmlFor: 'mm-perf' }, 'Show performance')),
                h('div.mm-note', {}, 'A small corner panel with FPS and timings, with a Copy button for bug reports. Also F3 or ` (backtick), or add ?perf to the address.'),
              ]
            : []),
        ),
        h('div', {},
          h('div.mm-h', {}, 'Cannon skin'),
          this.skinPicker(false),
          h('div.mm-note', {}, 'Only the body’s shape: the barrel still shows the type, the ring still shows the owner. A captured cannon takes its new owner’s skin. Online, each player always wears their own.'),
          h('div.mm-h', { style: 'margin-top:16px' }, 'Team colour'),
          this.colourPicker(false),
          h('div.mm-note', {}, 'Your cannons, shots and capture colour. The rings don’t change: light is always yours, red always the enemy’s. Online, each player always wears their own; if your looks are too alike, small name tags appear on the cannons.'),
          h('div.mm-h', { style: 'margin-top:16px' }, 'Credits'),
          h('ul.mm-credits', {},
            h('li', {}, h('b', {}, 'Game: '), 'SleepyMie'),
            h('li', {}, h('b', {}, 'Colours: '), 'ChocoNeko’s Dark Choco theme'),
            h('li', {}, h('b', {}, 'Pop sound: '), a('https://pixabay.com/sound-effects/film-special-effects-pop-cartoon-328167/', '“Pop Cartoon”'), ' by ', a('https://pixabay.com/users/creatorshome-49707711/', 'CreatorsHome'), ' on Pixabay (', a('https://pixabay.com/service/license-summary/', 'Pixabay Content License'), ')'),
            h('li', {}, h('b', {}, 'Engine: '), 'Phaser 3'),
          ),
        ),
      ),
    ])
  }

  private howto(): HTMLElement {
    return this.screenFrame('How to play', 'Capture every cannon to win', [
      h('div.mm-how', {},
        ...howtoTips().map((t, i) => {
          const tip = h(t.wide ? 'div.mm-tip.wide' : 'div.mm-tip', {}, h('div', { innerHTML: t.art }), h('b', {}, t.title), h('span', {}, t.text))
          if (i === 0) tip.dataset.first = ''
          return tip
        }),
      ),
      h('div.mm-keys', {}, ...KEYS.map(([k, what]) => h('span', {}, h('kbd', {}, k), what))),
    ])
  }
}
