import { cssHex, theme } from '../config/theme'
import { h } from './dom'
import { placeTip, TipRules } from './tipLogic'

/**
 * The small round "?" after a setting's label: the setting's explanation, in
 * a tooltip. Hover or keyboard focus shows it on a desktop; a click or tap
 * toggles it (phones, Discord); a press anywhere else or Esc closes it. Only
 * one is open at a time. While open, the tip sits on the page itself
 * (position: fixed on <body>), so nothing under it moves and no panel's
 * scaling or scrolling clips it; it stays inside the window (the Discord
 * frame), below the button or above when there is more room there.
 */
interface Tip {
  btn: HTMLButtonElement
  box: HTMLDivElement
  /** Where the tip waits while closed (inside the row, hidden). */
  home: HTMLElement
}

const rgba = (c: number, a: number): string => `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`

const rules = new TipRules<Tip>(show, hide)
const tips = new WeakMap<HTMLElement, Tip>()
let seq = 0
let wired = false
let leaveTimer = 0

function show(t: Tip): void {
  document.body.append(t.box)
  t.box.hidden = false
  t.box.style.visibility = 'hidden'
  t.btn.setAttribute('aria-expanded', 'true')
  position(t)
  t.box.style.visibility = ''
}

function hide(t: Tip): void {
  t.box.hidden = true
  t.btn.setAttribute('aria-expanded', 'false')
  t.box.classList.remove('above')
  t.home.append(t.box)
}

function position(t: Tip): void {
  if (!t.btn.isConnected) return rules.close()
  const r = t.btn.getBoundingClientRect()
  const view = { w: window.innerWidth || document.documentElement.clientWidth, h: window.innerHeight || document.documentElement.clientHeight }
  // Scrolled out of sight (a long list on a phone): close rather than float over something else.
  if (r.bottom < 0 || r.top > view.h) return rules.close()
  const p = placeTip({ x: r.left, y: r.top, w: r.width, h: r.height }, { w: t.box.offsetWidth, h: t.box.offsetHeight }, view)
  t.box.style.left = `${Math.round(p.x)}px`
  t.box.style.top = `${Math.round(p.y)}px`
  t.box.style.setProperty('--ax', `${Math.round(p.arrowX)}px`)
  t.box.classList.toggle('above', p.side === 'above')
}

function wire(): void {
  if (wired) return
  wired = true
  injectTipStyles()
  document.addEventListener(
    'pointerdown',
    (e) => {
      const t = rules.current
      if (!t) return
      const n = e.target as Node
      if (t.btn.contains(n) || t.box.contains(n)) return
      rules.outside()
    },
    true,
  )
  // Esc closes the tip and nothing else (not the menu screen, not the battle's Settings).
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && rules.escape()) {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    },
    true,
  )
  window.addEventListener('resize', () => rules.current && position(rules.current))
  document.addEventListener('scroll', () => rules.current && position(rules.current), true)
}

const hovers = (e: PointerEvent): boolean => e.pointerType === 'mouse' || e.pointerType === 'pen'

/**
 * A "?" button with `text` as its tooltip. `label` names the setting for
 * screen readers ("About Sound effects"). Returns the wrapper to put right
 * after the label; change the text later with setHelpText().
 */
export function helpTip(text: string, label: string): HTMLSpanElement {
  wire()
  const id = `ht-${++seq}`
  const box = h('div.ht-tip', { id, role: 'tooltip', hidden: true }, text)
  const btn = h('button.ht-btn', { type: 'button', 'aria-label': `About ${label}`, 'aria-describedby': id, 'aria-expanded': 'false', dataset: { help: label } }, '?')
  const home = h('span.ht', {}, btn, box)
  const t: Tip = { btn, box, home }
  tips.set(home, t)
  tips.set(btn, t)
  let pressing = false
  const cancelLeave = (): void => window.clearTimeout(leaveTimer)
  const leave = (): void => {
    cancelLeave()
    // A moment to move onto the tip itself (to read or select it).
    leaveTimer = window.setTimeout(() => rules.hoverOut(t), 140)
  }
  btn.addEventListener('pointerenter', (e) => {
    if (!hovers(e)) return
    cancelLeave()
    rules.hoverIn(t)
  })
  btn.addEventListener('pointerleave', (e) => hovers(e) && leave())
  box.addEventListener('pointerenter', (e) => {
    if (!hovers(e)) return
    cancelLeave()
    if (rules.isOpen(t)) rules.hoverIn(t)
  })
  box.addEventListener('pointerleave', (e) => hovers(e) && leave())
  // A tap focuses the button too: that is the tap (click), not keyboard focus.
  btn.addEventListener('pointerdown', () => (pressing = true))
  btn.addEventListener('focus', () => {
    if (!pressing) rules.focus(t)
    pressing = false
  })
  btn.addEventListener('blur', () => {
    pressing = false
    rules.blur(t)
  })
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    pressing = false
    rules.press(t)
  })
  return home
}

/** Change a tip's text (it updates in place if it is open). */
export function setHelpText(tip: HTMLElement, text: string): void {
  const t = tips.get(tip)
  if (!t || t.box.textContent === text) return
  t.box.textContent = text
  if (rules.isOpen(t)) position(t)
}

/** Close any open tip (a screen or panel going away). */
export function closeHelpTips(): void {
  rules.close()
}

/** The open tip's text, for tests and debugging. */
export function openHelpText(): string | null {
  return rules.current?.box.textContent ?? null
}

let styled = false

function injectTipStyles(): void {
  if (styled) return
  styled = true
  const gold = cssHex(theme.player)
  const css = `
.ht { display: inline-flex; flex: none; vertical-align: middle; }
.ht-btn {
  position: relative; flex: none; width: 20px; height: 20px; padding: 0; margin: 0; border-radius: 50%;
  display: inline-grid; place-items: center; cursor: help;
  font: bold 12px/1 ${theme.font}; color: ${theme.textMuted}; background: ${rgba(theme.hud, 0.6)};
  border: 1.5px solid ${cssHex(theme.boardEdge)}; transition: background .12s, color .12s, border-color .12s;
}
/* A bigger target for fingers than the dot itself. */
.ht-btn::after { content: ''; position: absolute; inset: -10px; border-radius: 50%; }
.ht-btn:hover, .ht-btn[aria-expanded="true"] { color: ${theme.ink}; background: ${gold}; border-color: ${gold}; }
.ht-btn:focus-visible { outline: 2px solid ${gold}; outline-offset: 2px; }
.ht-tip {
  position: fixed; left: 0; top: 0; z-index: 30; box-sizing: border-box;
  width: max-content; max-width: min(300px, calc(100vw - 16px));
  font: normal 13px/1.45 ${theme.font}; letter-spacing: normal; text-transform: none; text-align: left; white-space: normal;
  color: ${theme.text}; background: ${rgba(theme.panel, 0.98)}; border: 1.5px solid ${rgba(theme.player, 0.55)};
  border-radius: 10px; padding: 8px 11px; box-shadow: 0 8px 22px ${rgba(0, 0.5)};
  user-select: text; -webkit-user-select: text; animation: ht-in .1s ease-out;
}
.ht-tip[hidden] { display: none; }
.ht-tip::before {
  content: ''; position: absolute; left: calc(var(--ax, 50%) - 6px); top: -7px; width: 10px; height: 10px;
  background: inherit; border: inherit; border-right: 0; border-bottom: 0; transform: rotate(45deg); border-radius: 2px 0 0 0;
}
.ht-tip.above::before { top: auto; bottom: -7px; transform: rotate(225deg); }
@keyframes ht-in { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .ht-tip { animation: none; } }
`
  document.head.appendChild(Object.assign(document.createElement('style'), { id: 'cc-help-tip', textContent: css }))
}
