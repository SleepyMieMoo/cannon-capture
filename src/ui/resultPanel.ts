import { cssHex, theme } from '../config/theme'
import { injectMenuStyles } from '../menu/menuStyles'
import { h } from './dom'
import type { BragStat, ResultAction, ResultView } from './resultView'

const rgba = (c: number, a: number): string => `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`

export interface ResultPanelOpts {
  /** The panel's border colour (the winner's team colour, or grey for a draw). */
  stroke: number
  /** Screen px the battle HUD takes at the top: the panel centres in the space below it. */
  topInset: () => number
  onAction: (action: ResultAction) => void
  /** Play the entrance (the first time this round; a rebuild for rematch votes just appears). */
  animate?: boolean
}

const STAR = 'M12 1.6l3.1 6.9 7.5.8-5.6 5.1 1.6 7.4L12 18l-6.6 3.8 1.6-7.4L1.4 9.3l7.5-.8z'

/**
 * The end-of-round panel, as page elements over the board (below the HUD, so
 * Restart and Menu still work). Real buttons in a grid: they're always the same
 * width, their labels wrap instead of spilling, and they stack on narrow screens.
 */
export class ResultPanel {
  readonly el: HTMLDivElement
  private readonly panel: HTMLDivElement
  private readonly opts: ResultPanelOpts

  constructor(view: ResultView, opts: ResultPanelOpts) {
    injectMenuStyles()
    injectResultStyles()
    this.opts = opts
    const title = h('h2.rp-title', { id: 'rp-title' }, view.headline)
    const stars =
      view.stars === null
        ? null
        : h('div.rp-stars', { role: 'img', 'aria-label': `${view.stars} of 3 stars` })
    if (stars) for (let i = 0; i < 3; i++) stars.append(starSvg(i < view.stars!))
    const buttons = h('div.rp-btns')
    for (const b of view.buttons) {
      const btn = h(`button.mm-btn${b.primary ? '.primary' : ''}`, { type: 'button', dataset: { result: b.action } }, h('span', {}, b.label))
      btn.disabled = !!b.disabled
      btn.addEventListener('click', () => this.opts.onAction(b.action))
      buttons.append(btn)
    }
    this.panel = h(
      'div.rp-panel',
      { role: 'dialog', 'aria-labelledby': 'rp-title', dataset: { tone: view.tone } },
      title,
      stars,
      view.detail ? h('p.rp-detail', {}, view.detail) : null,
      view.brag?.length ? bragRow(view.brag) : null,
      view.extra ? h(`p.rp-extra${view.extra.gold ? '.gold' : ''}`, { 'aria-live': 'polite' }, view.extra.text) : null,
      buttons,
      view.keys ? h(`p.rp-keys${view.keysOnly ? '.keys' : ''}`, {}, view.keys) : null,
    )
    this.panel.style.borderColor = cssHex(opts.stroke)
    if (opts.animate && view.tone === 'win') this.panel.append(confetti())
    this.el = h(`div.rp${opts.animate ? '.enter' : ''}`, { dataset: { ui: 'result' } }, this.panel)
    // Presses on the panel are the panel's: the board under it never sees them.
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation())
    this.place()
    window.addEventListener('resize', this.onResize)
    document.body.append(this.el)
  }

  /** It's on the page and showing (the result watchdog rebuilds it otherwise). */
  isUp(): boolean {
    return this.el.isConnected && this.el.style.display !== 'none'
  }

  /** The button that does this, if the panel has one (focus survives a rebuild). */
  button(action: ResultAction): HTMLButtonElement | null {
    return this.el.querySelector(`[data-result="${action}"]`)
  }

  /** Which of its buttons has the keyboard focus, if any. */
  focused(): ResultAction | null {
    const a = document.activeElement
    return a instanceof HTMLElement && this.el.contains(a) ? ((a.dataset.result as ResultAction) ?? null) : null
  }

  private readonly onResize = (): void => this.place()

  private place(): void {
    this.el.style.paddingTop = `${Math.max(8, Math.round(this.opts.topInset()) + 8)}px`
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize)
    this.el.remove()
  }
}

/** The brag row: small labelled facts side by side (wrapping on narrow screens). */
function bragRow(stats: BragStat[]): HTMLElement {
  return h('dl.rp-brag', {}, ...stats.map((s) => h('div.rp-stat', { dataset: { key: s.key } }, h('dt', {}, s.label), h('dd', {}, s.value))))
}

/** Colours the confetti is cut from (the gold, its lighter shade, cream and caramel). */
const CONFETTI = [theme.player, theme.playerHot, 0xf3e6d8, 0xb49e8a]
const BITS = 12

/** A small burst of confetti: fixed spread (no randomness), drawn and moved by CSS only. */
function confetti(): HTMLDivElement {
  const box = h('div.rp-confetti', { 'aria-hidden': 'true' })
  for (let i = 0; i < BITS; i++) {
    // Spread over a fan above the panel's top, alternating sides, the outer bits further.
    const side = i % 2 === 0 ? -1 : 1
    const step = Math.floor(i / 2) / (BITS / 2)
    const x = side * (24 + step * 150 + ((i * 37) % 17))
    const y = -(30 + ((i * 53) % 46))
    const bit = h('i')
    bit.style.setProperty('--x', `${Math.round(x)}px`)
    bit.style.setProperty('--y', `${Math.round(y)}px`)
    bit.style.setProperty('--r', `${side * (180 + ((i * 61) % 360))}deg`)
    bit.style.setProperty('--d', `${80 + ((i * 29) % 160)}ms`)
    bit.style.setProperty('--c', cssHex(CONFETTI[i % CONFETTI.length]))
    box.append(bit)
  }
  return box
}

function starSvg(filled: boolean): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', filled ? 'on' : '')
  const path = document.createElementNS(ns, 'path')
  path.setAttribute('d', STAR)
  svg.append(path)
  return svg
}

let styled = false

function injectResultStyles(): void {
  if (styled) return
  styled = true
  const gold = cssHex(theme.player)
  const css = `
.rp {
  position: fixed; inset: 0; z-index: 3; box-sizing: border-box; overflow: hidden auto; overscroll-behavior: contain;
  display: flex; padding: 8px max(10px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left));
  background: ${rgba(theme.dim, 0.64)}; font-family: ${theme.font}; color: ${theme.text};
  -webkit-tap-highlight-color: transparent; user-select: none;
}
.rp * { box-sizing: border-box; }
.rp-panel {
  margin: auto; width: min(600px, 100%); text-align: center; container-type: inline-size;
  background: ${rgba(theme.panel, 0.98)}; border: 3px solid ${gold}; border-radius: 18px;
  padding: clamp(14px, 3.4vmin, 24px) clamp(12px, 3vmin, 22px) clamp(10px, 2.4vmin, 16px);
  box-shadow: 0 14px 40px ${rgba(0, 0.45)};
}
.rp-title { margin: 0; font-size: clamp(22px, 4.6vmin, 30px); line-height: 1.15; font-weight: bold; overflow-wrap: anywhere; }
.rp-stars { display: flex; justify-content: center; gap: 10px; margin: clamp(6px, 1.6vmin, 12px) 0 2px; }
.rp-stars svg { width: clamp(30px, 6vmin, 42px); height: auto; }
.rp-stars path { fill: ${cssHex(theme.grid)}; stroke: ${cssHex(theme.boardEdge)}; stroke-width: 1.2; stroke-linejoin: round; }
.rp-stars svg.on path { fill: ${gold}; stroke: ${cssHex(theme.playerHot)}; }
.rp-detail { margin: clamp(6px, 1.6vmin, 12px) 0 0; font-size: clamp(14px, 2.4vmin, 16px); line-height: 1.35; color: ${theme.textMuted}; white-space: pre-wrap; overflow-wrap: anywhere; }
.rp-brag {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin: clamp(10px, 2.4vmin, 16px) 0 0; padding: 0;
}
.rp-stat {
  min-width: 0; max-width: 100%; padding: 5px 12px 6px; border-radius: 10px;
  background: ${rgba(theme.dim, 0.5)}; border: 1px solid ${cssHex(theme.boardEdge)};
}
.rp-stat dt { margin: 0; font-size: 11px; line-height: 1.2; letter-spacing: .06em; text-transform: uppercase; color: ${theme.textMuted}; }
.rp-stat dd { margin: 1px 0 0; font-size: clamp(14px, 2.4vmin, 16px); line-height: 1.25; font-weight: bold; overflow-wrap: anywhere; }
.rp-stat[data-key="time"] dd { font-variant-numeric: tabular-nums; }
.rp-extra { margin: 10px 0 0; font-size: clamp(13px, 2.2vmin, 15px); line-height: 1.35; font-weight: bold; overflow-wrap: anywhere; }
.rp-extra.gold { color: ${gold}; }
.rp-btns {
  /* Side by side, equal widths sized to the longest label (wrapping only when there's no room). */
  display: grid; gap: 10px; margin: clamp(14px, 3.4vmin, 24px) auto 0;
  grid-auto-flow: column; grid-auto-columns: minmax(180px, 1fr); width: max-content; max-width: 100%;
}
/* Narrow: stacked, full width. */
@container (max-width: 400px) { .rp-btns { grid-auto-flow: row; grid-auto-columns: 1fr; width: 100%; } }
.rp-btns .mm-btn { width: 100%; min-width: 0; min-height: 48px; padding: 8px 14px; font-size: clamp(15px, 2.5vmin, 17px); line-height: 1.2; }
.rp-btns .mm-btn span { min-width: 0; overflow-wrap: anywhere; text-wrap: balance; }
.rp-btns .mm-btn:disabled { opacity: .45; }
.rp-keys { margin: 10px 0 0; font-size: 13px; line-height: 1.35; color: ${theme.textMuted}; white-space: pre-wrap; }
@media (hover: none) and (pointer: coarse) { .rp-keys.keys { display: none; } }
`
  document.head.appendChild(Object.assign(document.createElement('style'), { id: 'cc-result-panel', textContent: css }))
}
