import { currentFx, onFxChange, saveFxChoice } from '../render/vfx/fxPrefs'
import type { FxQuality } from '../render/vfx/fxQuality'
import { CONTRAST, SKINS, SKIN_LABEL, type SkinId } from '../config/skins'
import { loadSkin, saveSkin } from './skinPref'
import { CONTRAST_COLOUR, TEAM_COLOUR, TEAM_COLOURS, vsAiColours, type TeamColourId } from '../config/teamColours'
import { applyTeamColours, cssHex, sideColor } from '../config/theme'
import { BOTS, botAvatarSvg } from '../ui/bots'
import { loadColour, saveColour } from './colourPref'
import { BRAND } from '../config/brand'
import { MAP_SIZES } from '../levels/board'
import { beatableOnImpossible } from '../levels'
import { badgeCount, hasBadge, loadBadges, type Badges } from './badges'
import { badgeName } from '../ui/resultView'
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
import { copyText } from '../ui/copyText'
import { LINKS } from './credits'
import { versionLabel } from '../version'
import { dayLabel, KIND_LABEL, WHATS_NEW } from './whatsNew'
import { KEPT_KEYS, PREF_KEYS } from './prefs'
import type { MusicPlayer } from '../audio/music'
import { MUSIC_ARTIST, TRACKS } from '../audio/musicTracks'
import { jukeboxPanel } from '../ui/jukebox'
import { loadTabPrefs, saveTabPrefs } from './tabPrefs'
import { settingRow } from '../ui/settingRow'
import { loadMotionPref, onMotionChange, saveMotionPref, systemReduces, type MotionPref } from '../ui/motion'
import { closeHelpTips, setHelpText } from '../ui/helpTip'

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
  /** Profile: the online name (the same one the room screen saves). */
  name?: { get(): string; set(name: string): void }
  /** Profile → Reset all preferences, after the confirm. */
  resetPrefs?(): void
  /** Copy debug info: the report text (version, browser, screen, settings; nothing personal). */
  debugInfo?(): string
  /** The jukebox (left out in tests: no music there). */
  music?: MusicPlayer
}

const link = (href: string, text: string): HTMLAnchorElement => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text)

/** The big Profile preview: your cannon (skin + colour), or the AI's contrast to it. */
function mePreview(ai: boolean, skin: SkinId): string {
  const colour = loadColour()
  return ai ? skinPreview(CONTRAST[skin], 'enemy', TEAM_COLOUR[CONTRAST_COLOUR[colour]].hex) : skinPreview(skin, 'player', TEAM_COLOUR[colour].hex)
}

const icon = (svg: string): HTMLSpanElement => h('span', { innerHTML: svg, style: 'display:inline-flex' })

/** The tag on built-in maps the dev has beaten on Impossible by hand (src/data/mapInfo.json). */
export const VERIFIED_TIP = 'Beatable on Impossible: verified by hand by the dev. Hard, but fair.'
const SHIELD_CHECK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 1.2 13.4 3v4.4c0 3.3-2.3 6-5.4 7.4C4.9 13.4 2.6 10.7 2.6 7.4V3Z" fill="currentColor" opacity=".22" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m5.3 8.1 1.9 1.9 3.6-3.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'

/** A map card's four win badges, one per bot: its tiny face, lit once you've beaten it there. */
function badgeRow(badges: Badges, mapId: string): HTMLElement {
  const got = AI_LEVELS.filter((d) => hasBadge(badges, mapId, d))
  const row = h('div.mm-badges', { role: 'img', 'aria-label': got.length ? `Badges: beaten ${got.map((d) => DIFFICULTY[d].label).join(', ')}` : 'Badges: none yet' })
  for (const d of AI_LEVELS) {
    const name = badgeName(BOTS[d].name, DIFFICULTY[d].label)
    const on = got.includes(d)
    row.append(h(`span.mm-badge${on ? '.on' : ''}`, { title: on ? name : `${name}: not yet`, dataset: { badge: d }, innerHTML: botAvatarSvg(d, sideColor('enemy'), 16) }))
  }
  return row
}

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
    closeHelpTips()
    for (const fn of this.teardown.splice(0)) fn()
    this.thumbs = []
  }

  /** The page on screen now (a new one animates in). */
  private shownScreen = ''

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
              : screen === 'profile'
                ? this.profile()
                : screen === 'credits'
                  ? this.credits()
                  : screen === 'whatsnew'
                    ? this.whatsNew()
                    : screen === 'jukebox'
                      ? this.jukebox()
              : screen === 'friends' && this.actions.online
                ? friendsScreen(this.kit, this.actions.online)
                : screen === 'lobby' && this.actions.online
                  ? this.lobby(this.actions.online)
                  : this.howto()
    // A new page rises in (a redraw of the same page, like the lobby on a room change, doesn't).
    if (screen !== this.shownScreen) view.classList.add('cc-enter')
    this.shownScreen = screen
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
        this.button('settings', 'Settings', go('settings'), { icon: ICONS.settings, cls: 'third' }),
        this.button('howto', 'How to play', go('howto'), { icon: ICONS.help, cls: 'third' }),
        this.button('credits', 'Credits', go('credits'), { icon: ICONS.credits, cls: 'third' }),
      ),
      soon,
      h('div.mm-foot', {}, this.versionButton()),
      // The corners: Jukebox top left, Profile top right (after the grid, so Tab starts at Play).
      this.jukeboxCorner(),
      h('button.mm-corner.right', { type: 'button', title: 'Profile: your name, looks and difficulty', 'aria-label': 'Profile', dataset: { id: 'profile' }, onclick: go('profile') },
        h('span.ic', { innerHTML: ICONS.profile }),
        h('span.txt', {}, 'Profile'),
      ),
    )
  }

  /** Top-left Jukebox button: the song playing, with a little equaliser while it plays. */
  private jukeboxCorner(): HTMLButtonElement {
    const music = this.actions.music
    const np = h('span.np')
    const eq = h('span.jb-eq', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))
    const b = h('button.mm-corner.left', { type: 'button', dataset: { id: 'jukebox' }, onclick: () => this.open('jukebox', 'jukebox') },
      h('span.ic', { innerHTML: ICONS.music }),
      h('span.txt', {}, 'Jukebox', np),
      eq,
    )
    const update = (): void => {
      const playing = music?.status === 'playing'
      b.classList.toggle('on', playing)
      np.textContent = music ? (music.playing ? music.track.short : 'Music off') : ''
      const label = music ? `Jukebox: ${music.playing ? 'playing ' + music.track.title : 'music off'}` : 'Jukebox'
      b.title = label
      b.setAttribute('aria-label', label)
    }
    update()
    if (music) this.teardown.push(music.onChange(update))
    return b
  }

  private jukebox(): HTMLElement {
    const music = this.actions.music
    const body = music ? jukeboxPanel(music) : null
    if (body) this.teardown.push(body.destroy)
    const frame = this.screenFrame('Jukebox', 'Music, saved on this device', [
      body?.el ?? h('div.mm-note', {}, 'Music isn’t available here.'),
    ])
    frame.classList.add('narrow')
    return frame
  }

  private play(): HTMLElement {
    const choices = vsAiMaps(listMaps())
    const badges = loadBadges()
    let map = pickMap(choices, this.prefs.mapId)
    let diff: AiLevel = this.prefs.difficulty
    const save = (): void => {
      this.prefs = { difficulty: diff, mapId: map.id }
      saveMenuPrefs(this.prefs)
    }
    const pickName = h('div.n', {}, map.name)
    const info = (c: MapChoice): string => summary(c.level) + (c.group === 'Built-in' && beatableOnImpossible(c.id) ? ' · beatable on Impossible' : '')
    const pickInfo = h('div.mm-note', {}, info(map))
    // The bot you'll face: its face and name beside what the level means.
    const botFace = h('div.mm-botface')
    const botName = h('b', {})
    const botText = h('span', {})
    const showBot = (d: AiLevel): void => {
      botFace.innerHTML = botAvatarSvg(d, sideColor('enemy'), 44)
      botName.textContent = BOTS[d].name
      botFace.title = `${BOTS[d].name}: ${BOTS[d].vibe}`
      botText.textContent = DIFFICULTY[d].blurb
    }
    showBot(diff)
    const blurb = h('div.mm-blurb.mm-bot', {}, botFace, h('div', {}, botName, botText))
    const cards: HTMLButtonElement[] = []
    const start = (): void => {
      save()
      this.actions.playVsAi(vsAiLevel(map, diff))
    }
    const card = (c: MapChoice): HTMLButtonElement => {
      const canvas = h('canvas')
      drawThumb(canvas, c.level, 168)
      this.thumbs.push(() => drawThumb(canvas, c.level, 168))
      const verified = c.group === 'Built-in' && beatableOnImpossible(c.id)
      const thumb = h('div.mm-thumb', {}, canvas)
      if (verified) thumb.append(h('span.mm-verified', { title: VERIFIED_TIP, innerHTML: SHIELD_CHECK + '<span>Impossible</span>' }))
      const el = h('button.mm-card', { type: 'button', dataset: { id: 'map-' + c.id }, title: verified ? `${c.name}\n${VERIFIED_TIP}` : c.name, 'aria-pressed': String(c.id === map.id) },
        thumb,
        h('div.n', {}, c.name),
        h('div.m', {}, h('span', {}, MAP_SIZES[c.level.size ?? 'small'].label), h('span', {}, c.group === 'My maps' ? 'Yours' : '')),
        badgeRow(badges, c.id),
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
        pickInfo.textContent = info(c)
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
        showBot(d)
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
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-pv-me]')) el.innerHTML = mePreview(el.dataset.pvMe === 'ai', skin)
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
    return this.screenFrame('Settings', 'Saved on this device', [
      h('div.mm-set', {},
        h('div', {},
          h('div.mm-h', {}, 'Sound'),
          settingRow({ id: 'sound', label: 'Sound effects', for: 'mm-sound', help: 'Shots pop; captures and broken barriers pop deeper. N mutes or unmutes them during a battle.', control: [sw] }),
          settingRow({ id: 'volume', label: 'Volume', for: 'mm-volume', control: [range, val] }),
          ...this.musicSettings(),
          h('div.mm-h', {}, 'In battle'),
          settingRow({
            id: 'auto',
            label: 'Auto-target',
            help: 'Your guns re-aim by themselves when their target is captured. Switch it in the battle’s own Settings, or per cannon with M. It’s on at the start of every game.',
            control: [h('span.mm-srow-x', {}, 'In the battle’s Settings')],
          }),
          ...(perfSw
            ? [
                h('div.mm-h', {}, 'Performance'),
                settingRow({ id: 'perf', label: 'Show performance', for: 'mm-perf', help: 'A small corner panel with FPS and timings, with a Copy button for bug reports. Also F3 or ` (backtick), or add ?perf to the address.', control: [perfSw] }),
              ]
            : []),
        ),
        h('div', {},
          ...this.tabbedSettings(),
          ...this.motionSettings(),
          h('div.mm-h', {}, 'Your looks and name'),
          settingRow({ id: 'profile', label: 'Profile', help: 'Cannon skin, team colour, online name and the Play vs AI difficulty are in Profile.', control: [this.button('to-profile', 'Open Profile', () => this.open('profile', 'to-profile'), { icon: ICONS.profile, cls: 'small' })] }),
          h('div.mm-h', {}, 'Bug reports'),
          settingRow({ id: 'debug', label: 'Debug info', help: 'Copies the game version, browser, screen size, renderer and these settings, nothing personal, to paste into a bug report.', control: [this.copyDebugButton('debug-settings')] }),
          h('div.mm-h', {}, 'About'),
          settingRow({ id: 'about', label: 'Version', sub: this.versionButton(), control: [this.button('to-credits', 'Credits', () => this.open('credits', 'to-credits'), { icon: ICONS.credits, cls: 'small' })] }),
        ),
      ),
    ])
  }

  /** Settings → When tabbed out: music, and whether a round against the AI pauses. */
  private tabbedSettings(): HTMLElement[] {
    const music = this.actions.music
    const musicSw = h('input.mm-switch', { type: 'checkbox', role: 'switch', id: 'mm-tab-music', dataset: { id: 'tab-music' }, checked: music?.settings.keepHidden ?? true }) as HTMLInputElement
    if (!music) musicSw.disabled = true
    musicSw.addEventListener('change', () => music?.setKeepHidden(musicSw.checked))
    const pauseSw = h('input.mm-switch', { type: 'checkbox', role: 'switch', id: 'mm-tab-pause', dataset: { id: 'tab-pause' }, checked: loadTabPrefs().pauseVsAi }) as HTMLInputElement
    pauseSw.addEventListener('change', () => saveTabPrefs({ pauseVsAi: pauseSw.checked }))
    if (music) this.teardown.push(music.onChange(() => (musicSw.checked = music.settings.keepHidden)))
    return [
      h('div.mm-h', {}, 'When tabbed out'),
      settingRow({ id: 'tab-music', label: 'Keep music playing', for: 'mm-tab-music', help: 'Music carries on while the game is in another tab or window. Sound effects are always silent while the game is in the background.', control: [musicSw] }),
      settingRow({
        id: 'tab-pause',
        label: 'Pause vs AI',
        for: 'mm-tab-pause',
        help: 'On: against the AI (and in puzzles and levels) the round pauses when you switch away, with Resume when you’re back. Off: it keeps going, and up to a minute is played back silently when you return. Online matches always keep going.',
        control: [pauseSw],
      }),
    ]
  }

  /** Settings → Display: Reduce motion (Auto follows the device's own setting). */
  private motionSettings(): HTMLElement[] {
    const choices: { id: MotionPref; label: string }[] = [
      { id: 'auto', label: 'Auto' },
      { id: 'on', label: 'On' },
      { id: 'off', label: 'Off' },
    ]
    const segs = choices.map((c) =>
      h('button.mm-seg', { type: 'button', dataset: { id: 'motion-' + c.id }, onclick: () => saveMotionPref(c.id) }, c.label),
    )
    const helpText = (): string =>
      `Stills the menus and battle screens: no sliding or popping panels, floating title, button bounces or win confetti. Auto follows your device’s reduce-motion setting (${systemReduces() ? 'on' : 'off'} on this device).`
    const row = settingRow({ id: 'motion', label: 'Reduce motion', help: helpText(), layout: 'wide', control: [h('div.mm-segs', { role: 'group', 'aria-label': 'Reduce motion' }, ...segs)] })
    const update = (): void => {
      const pref = loadMotionPref()
      segs.forEach((b, i) => b.setAttribute('aria-pressed', String(choices[i].id === pref)))
      if (row.help) setHelpText(row.help, helpText())
    }
    update()
    this.teardown.push(onMotionChange(update))
    return [h('div.mm-h', {}, 'Display'), row, this.effectsSetting()]
  }

  /** Settings → Display → Effects quality: High, Low or Off (chosen for the device until you pick). */
  private effectsSetting(): HTMLElement {
    const choices: { id: FxQuality; label: string }[] = [
      { id: 'high', label: 'High' },
      { id: 'low', label: 'Low' },
      { id: 'off', label: 'Off' },
    ]
    const segs = choices.map((c) =>
      h('button.mm-seg', { type: 'button', dataset: { id: 'fx-' + c.id }, onclick: () => saveFxChoice(c.id) }, c.label),
    )
    const helpText = (): string => {
      const fx = currentFx()
      const now = fx.auto ? ` Until you pick one it’s chosen for this device (${fx.quality === 'high' ? 'High' : 'Low'} now).` : ''
      return `Battle effects: team glows under cannons, muzzle flashes, shot trails, sparks and capture bursts. Low keeps the glows and trims the rest; Off is the plain look. Reduce motion stills shakes and moving effects.${now}`
    }
    const row = settingRow({ id: 'fx', label: 'Effects quality', help: helpText(), layout: 'wide', control: [h('div.mm-segs', { role: 'group', 'aria-label': 'Effects quality' }, ...segs)] })
    const update = (): void => {
      const q = currentFx().quality
      segs.forEach((b, i) => b.setAttribute('aria-pressed', String(choices[i].id === q)))
      if (row.help) setHelpText(row.help, helpText())
    }
    update()
    this.teardown.push(onFxChange(update))
    return row
  }

  /** Settings → Music: on/off, its own volume, and the way to the jukebox. */
  private musicSettings(): HTMLElement[] {
    const music = this.actions.music
    if (!music) return []
    const sw = h('input.mm-switch', { type: 'checkbox', role: 'switch', id: 'mm-music', dataset: { id: 'music' } }) as HTMLInputElement
    const val = h('span.mm-val')
    const range = h('input.mm-range', { type: 'range', min: '0', max: '100', step: '5', id: 'mm-music-volume', dataset: { id: 'music-volume' }, 'aria-label': 'Music volume' }) as HTMLInputElement
    const song = h('span', { dataset: { id: 'now-playing' } })
    sw.addEventListener('change', () => (sw.checked ? music.play() : music.pause()))
    const pulse = h('input.mm-switch', { type: 'checkbox', role: 'switch', id: 'mm-pulse', dataset: { id: 'pulse' } }) as HTMLInputElement
    pulse.addEventListener('change', () => music.setPulse(pulse.checked))
    range.addEventListener('input', () => music.setVolume(Number(range.value) / 100))
    const helpText = (): string => {
      const def = TRACKS.find((t) => t.id === music.settings.track)
      return `Pick a song, and star the one the game starts with (now: ${def?.short ?? music.track.short}). Music has its own volume, apart from sound effects.`
    }
    const jukebox = settingRow({ id: 'jukebox', label: 'Jukebox', sub: song, help: helpText(), control: [this.button('to-jukebox', 'Open jukebox', () => this.open('jukebox', 'to-jukebox'), { icon: ICONS.music, cls: 'small' })] })
    const update = (): void => {
      sw.checked = music.playing
      pulse.checked = music.settings.pulse
      const v = Math.round(music.settings.volume * 100)
      if (document.activeElement !== range) range.value = String(v)
      val.textContent = `${v}%`
      song.textContent = `Now: ${music.track.title}`
      song.title = `Now: ${music.track.title}`
      if (jukebox.help) setHelpText(jukebox.help, helpText())
    }
    update()
    this.teardown.push(music.onChange(update))
    return [
      h('div.mm-h', {}, 'Music'),
      settingRow({ id: 'music', label: 'Music', for: 'mm-music', control: [sw] }),
      settingRow({ id: 'music-volume', label: 'Volume', for: 'mm-music-volume', control: [range, val] }),
      settingRow({
        id: 'pulse',
        label: 'Pulse to the music',
        for: 'mm-pulse',
        help: 'Small things like the jukebox bars and the title glow pulse on the beat while music plays. Never anything in play. Off when music is off or Reduce motion is on.',
        control: [pulse],
      }),
      jukebox,
    ]
  }

  /** "v0.1.0 · abc1234 · What's new": subtle, under the menu and on Profile and Credits. */
  private versionButton(id = 'version'): HTMLButtonElement {
    return h('button.mm-ver', { type: 'button', dataset: { id }, title: 'What’s new in this version', onclick: () => this.open('whatsnew', id) }, versionLabel(), h('span', {}, ' · What’s new'))
  }

  /** Copy debug info, with a toast (or the text shown selected when the clipboard is blocked). */
  private copyDebugButton(id: string): HTMLButtonElement {
    const b = this.button(id, 'Copy debug info', () => {
      const text = this.actions.debugInfo?.() ?? ''
      void copyText(text).then((how) => {
        if (how === 'manual') {
          this.manualCopy(text)
          this.toast('Copy blocked here: the info is selected, press Ctrl+C (or long-press, Copy).')
        } else this.toast('Debug info copied: paste it into your bug report.')
      })
    }, { icon: ICONS.copy, cls: 'small' })
    if (!this.actions.debugInfo) b.disabled = true
    return b
  }

  private manualCopy(text: string): void {
    const box = h('textarea.mm-copybox', { readOnly: true, rows: 6, 'aria-label': 'Debug info' }) as HTMLTextAreaElement
    box.value = text
    this.root.querySelector('.mm-copybox')?.remove()
    ;(this.root.querySelector('.mm-body') ?? this.root).append(box)
    box.focus()
    box.select()
  }

  private toastTimer = 0

  private toast(text: string): void {
    this.root.querySelector('.mm-toast')?.remove()
    const t = h('div.mm-toast', { role: 'status' }, text)
    this.root.append(t)
    window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => t.remove(), 2600)
  }

  /** The small "v… · What's new" line at the end of a screen. */
  private versionFoot(): HTMLElement {
    return h('div.mm-verfoot', {}, this.versionButton())
  }

  private profile(): HTMLElement {
    const name = this.actions.name
    const nameIn = h('input.mm-input', { id: 'mm-pname', type: 'text', maxLength: 16, placeholder: 'Your name (optional)', value: name?.get() ?? '', autocomplete: 'nickname', dataset: { id: 'pname' } }) as HTMLInputElement
    const saved = h('span.mm-saved', { 'aria-live': 'polite' })
    nameIn.addEventListener('change', () => {
      name?.set(nameIn.value)
      nameIn.value = name?.get() ?? nameIn.value
      saved.textContent = 'Saved'
      window.setTimeout(() => (saved.textContent = ''), 1500)
    })
    if (!name) nameIn.disabled = true
    // Difficulty: the one Play vs AI starts on (it remembers your last pick there too).
    const diffHelp = (d: AiLevel): string => `${DIFFICULTY[d].label}: ${DIFFICULTY[d].blurb} Every level fires and turns like you do: difficulty is only how well the AI thinks.`
    const segs = AI_LEVELS.map((d) => {
      const b = h('button.mm-seg', { type: 'button', dataset: { id: 'pdiff-' + d }, 'aria-pressed': String(d === this.prefs.difficulty), title: DIFFICULTY[d].blurb }, DIFFICULTY[d].label)
      b.addEventListener('click', () => {
        this.prefs = { ...this.prefs, difficulty: d }
        saveMenuPrefs(this.prefs)
        for (const x of segs) x.setAttribute('aria-pressed', String(x === b))
        if (diffRow.help) setHelpText(diffRow.help, diffHelp(d))
      })
      return b
    })
    const diffRow = settingRow({ id: 'difficulty', label: 'Difficulty', help: diffHelp(this.prefs.difficulty), layout: 'wide', control: [h('div.mm-segs', { role: 'group', 'aria-label': 'Play vs AI difficulty' }, ...segs)] })
    // Reset, with a confirm step in place (no browser dialog: Discord's frame blocks those).
    const resetArea = h('div.mm-reset')
    const resetRow = settingRow({
      id: 'reset',
      label: 'All preferences',
      help: `Reset puts back the defaults: ${PREF_KEYS.map((k) => k.what).join(', ')}. Kept: ${KEPT_KEYS.map((k) => k.what).join(', ')}. You confirm first.`,
      control: [resetArea],
    })
    const showAsk = (): void => {
      resetRow.classList.remove('block')
      resetArea.replaceChildren(this.button('reset', 'Reset…', showConfirm, { icon: ICONS.reset, cls: 'small' }))
      resetArea.querySelector('button')!.setAttribute('aria-label', 'Reset all preferences')
    }
    const showConfirm = (): void => {
      const yes = this.button('reset-yes', 'Reset', () => {
        this.actions.resetPrefs?.()
        this.prefs = loadMenuPrefs()
        applyTeamColours(vsAiColours(loadColour()))
        this.render('reset')
        this.toast('Preferences reset to the defaults.')
      }, { cls: 'small.danger' })
      const no = this.button('reset-no', 'Cancel', () => {
        showAsk()
        resetArea.querySelector<HTMLElement>('[data-id="reset"]')?.focus()
      }, { cls: 'small' })
      resetRow.classList.add('block')
      resetArea.replaceChildren(
        h('div.mm-confirm', { role: 'alertdialog', 'aria-label': 'Reset all preferences?' },
          h('b', {}, 'Reset all preferences?'),
          h('div.mm-note', {}, `Back to the defaults: ${PREF_KEYS.map((k) => k.what).join(', ')}. Kept: ${KEPT_KEYS.map((k) => k.what).join(', ')}.`),
          h('div.mm-row', {}, yes, no),
        ),
      )
      no.focus()
    }
    showAsk()
    if (!this.actions.resetPrefs) resetArea.querySelector<HTMLButtonElement>('button')!.disabled = true
    return this.screenFrame('Profile', 'You, on this device', [
      h('div.mm-set', {},
        h('div', {},
          h('div.mm-me', { 'aria-label': 'Preview: your cannon against the AI’s' },
            h('div', {}, h('span.pv', { innerHTML: mePreview(false, loadSkin()), dataset: { pvMe: 'you' } }), h('small', {}, 'You')),
            h('span.vs', {}, 'vs'),
            h('div', {}, h('span.pv.ai', { innerHTML: mePreview(true, loadSkin()), dataset: { pvMe: 'ai' } }), h('small', {}, 'The AI')),
          ),
          h('div.mm-h', {}, 'You'),
          settingRow({
            id: 'pname',
            label: 'Online name',
            for: 'mm-pname',
            help: this.actions.online ? 'Shown to the other player and spectators in Play with friends. The room screen uses the same name.' : 'Used in Play with friends (in a browser; online play isn’t available here yet).',
            layout: 'wide',
            control: [nameIn, saved],
          }),
          diffRow,
          this.badgeTotalRow(),
          resetRow,
        ),
        h('div', {},
          h('div.mm-h', {}, 'Your looks'),
          settingRow({ id: 'skin', label: 'Cannon skin', layout: 'block', help: 'Only the body’s shape: the barrel still shows the type, the ring still shows the owner. A captured cannon takes its new owner’s skin. Online, each player always wears their own.', control: [this.skinPicker(false)] }),
          settingRow({ id: 'colour', label: 'Team colour', layout: 'block', help: 'Your cannons, shots and capture colour. The rings don’t change: light is always yours, red always the enemy’s. Online, each player always wears their own; if your looks are too alike, small name tags appear on the cannons.', control: [this.colourPicker(false)] }),
        ),
      ),
      this.versionFoot(),
    ])
  }

  /** Profile: "7/20" win badges over the maps Play vs AI lists now (built-in and yours). */
  private badgeTotalRow(): HTMLElement {
    const ids = vsAiMaps(listMaps()).map((c) => c.id)
    const n = badgeCount(loadBadges(), ids)
    return settingRow({
      id: 'badges',
      label: 'Win badges',
      help: 'One badge per bot on each Play vs AI map (yours too): beat Dumpling, Pip, Rivet and Vex there to light them up on the map card. Reset all preferences clears them.',
      layout: 'wide',
      control: [h('span.mm-badgetotal', { dataset: { id: 'badge-total' } }, h('b', {}, String(n)), ` / ${ids.length * AI_LEVELS.length}`)],
    })
  }

  private credits(): HTMLElement {
    const row = (what: string, ...who: (Node | string)[]): HTMLElement => h('div.mm-cred-row', {}, h('dt', {}, what), h('dd', {}, ...who))
    return this.screenFrame('Credits', 'Who and what made this game', [
      h('dl.mm-cred', {},
        row('Game', 'by ', h('b', {}, 'SleepyMie'), ' · ', link(LINKS.sleepyMie, 'sleepymiemoo.github.io')),
        row('Colours', 'Inspired by ', link(LINKS.choconeko, 'ChocoNeko’s Dark Choco theme')),
        row('Music', ...TRACKS.flatMap((t, i) => [i ? h('br') : '', link(t.page, `“${t.title}”`)]), h('br'), 'by ', link(MUSIC_ARTIST.page, MUSIC_ARTIST.name), ' on Pixabay, under the ', link(LINKS.pixabayLicense, 'Pixabay Content License'), '. Trimmed at both ends so they loop; please get the originals from Pixabay.'),
        row('Pop sound', link(LINKS.pop, '“Pop Cartoon”'), ' by ', link(LINKS.creatorsHome, 'CreatorsHome'), ' on Pixabay, under the ', link(LINKS.pixabayLicense, 'Pixabay Content License'), '. Trimmed for the game; please get the original from Pixabay.'),
        row('Engine', link(LINKS.phaser, 'Phaser 3')),
        row('Online server', link(LINKS.workers, 'Cloudflare Workers'), ' with Durable Objects'),
        row('Made with', link(LINKS.typescript, 'TypeScript'), ' and ', link(LINKS.vite, 'Vite')),
        row('Font', 'Verdana (or your device’s closest match). No web fonts are downloaded.'),
        row('Special thanks', 'Playtesters, for every round and every bug report'),
      ),
      this.versionFoot(),
    ])
  }

  private whatsNew(): HTMLElement {
    return this.screenFrame('What’s new', versionLabel(), [
      h('div.mm-news', {},
        ...WHATS_NEW.map((day) =>
          h('section', {},
            h('div.mm-h', {}, dayLabel(day.date)),
            h('ul', {}, ...day.entries.map((e) => h('li', {}, h(`span.mm-kind.${e.kind}`, {}, KIND_LABEL[e.kind]), h('div', {}, h('b', {}, e.title), h('span', {}, e.text))))),
          ),
        ),
      ),
    ],
    h('div.mm-bar', {}, h('div.mm-pick', {}, h('div.n', {}, versionLabel()), h('div.mm-note', {}, 'Found a bug? Copy this, then paste it into your report.')), this.copyDebugButton('debug')),
    )
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
