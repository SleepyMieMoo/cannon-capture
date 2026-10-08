import { cssHex, theme } from '../config/theme'

const rgba = (c: number, a: number): string => `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`

/** Things that press: they lift and glow on hover, squish on press, and ring in on keyboard focus. */
const PRESSABLE = '.mm-btn, .mm-corner, .bh-btn, .mm-seg, .mm-card, .mm-skin'

/** Settings and menu lists: rows rise in one after another when a page opens (the first few only). */
function stagger(sel: string, first: number, step: number, count: number): string {
  let css = ''
  for (let i = 1; i <= count; i++) css += `${sel}:nth-child(${i}) { animation-delay: ${first + (i - 1) * step}ms; }\n`
  return css
}

let injected = false

/**
 * The UI's movement, in one place. Transforms and opacity only (no layout
 * work), short (150-300 ms) and never in the way: everything is clickable at
 * once. Selectors start with "html" so these win over each module's own
 * styles whatever order they load in. Reduce motion (html.cc-calm) stills it all.
 */
export function injectMotionStyles(): void {
  if (injected || typeof document === 'undefined') return
  injected = true
  const gold = cssHex(theme.player)
  const css = `
:root { --cc-out: cubic-bezier(.2, .8, .3, 1); --cc-back: cubic-bezier(.34, 1.56, .64, 1); }

/* ---- buttons ---- */
html :is(.mm-btn, .bh-btn, .mm-seg, .mm-card, .mm-skin) { position: relative; }
html :is(${PRESSABLE}) { transition: background-color .15s, border-color .15s, color .15s, opacity .15s, transform .22s var(--cc-back); }
html :is(${PRESSABLE})::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  box-shadow: 0 2px 12px ${rgba(theme.player, 0.22)}; opacity: 0; transition: opacity .2s var(--cc-out);
}
@media (hover: hover) {
  html :is(.mm-btn, .mm-corner, .bh-btn, .mm-card):not(:disabled):hover { transform: translateY(-1px); }
  html :is(${PRESSABLE}):not(:disabled):hover::after { opacity: 1; }
}
html :is(${PRESSABLE}):not(:disabled):active { transform: translateY(0) scale(.97); transition-duration: .07s; }
html :is(${PRESSABLE}):focus-visible { outline: 3px solid transparent; }
html :is(${PRESSABLE}):focus-visible::after { opacity: 1; box-shadow: 0 0 0 2px ${cssHex(theme.hud)}, 0 0 0 5px ${gold}, 0 2px 12px ${rgba(theme.player, 0.22)}; animation: cc-ring .3s var(--cc-back); }
@keyframes cc-ring { from { opacity: 0; } 50% { opacity: .6; } }

/* Switches slide with a little overshoot. */
html .mm-switch::after { transition: transform .24s var(--cc-back), background-color .15s; }
html .mm-switch:checked::after { left: 4px; transform: translateX(20px); }
html .mm-switch:active::after { scale: 1.12; }

/* ---- pages and panels ---- */
@keyframes cc-in { from { opacity: 0; translate: 0 6px; scale: .99; } }
@keyframes cc-rise { from { opacity: 0; translate: 0 4px; } }
@keyframes cc-fade { from { opacity: 0; } }
@keyframes cc-fade-out { to { opacity: 0; } }
@keyframes cc-pop { from { opacity: 0; scale: .96; } 65% { opacity: 1; scale: 1.01; } to { scale: 1; } }
@keyframes cc-pop-out { to { opacity: 0; scale: .98; } }
@keyframes cc-drop { from { opacity: 0; scale: .98; translate: 0 -4px; } }
html .mm-screen.cc-enter { animation: cc-in .26s var(--cc-back) both; }
html .mm-home.cc-enter > :not(.mm-grid) { animation: cc-rise .3s var(--cc-out) both; }
${stagger('html .mm-home.cc-enter > :not(.mm-grid)', 0, 35, 6)}
html .mm-home.cc-enter .mm-grid > * { animation: cc-rise .28s var(--cc-back) both; }
${stagger('html .mm-home.cc-enter .mm-grid > *', 70, 22, 10)}
html .mm-screen.cc-enter .mm-body :is(.mm-srow, .mm-h, .mm-card) { animation: cc-rise .24s var(--cc-out) both; }
${stagger('html .mm-screen.cc-enter .mm-body :is(.mm-srow, .mm-h, .mm-card)', 30, 16, 12)}
html .bm-panel { animation: cc-pop .26s var(--cc-out) both; }
html .bm { animation: cc-fade .18s ease-out both; }
html .bm.closing { animation: cc-fade-out .14s ease-in both; pointer-events: none; }
html .bm.closing .bm-panel { animation: cc-pop-out .14s ease-in both; }
html .bs { animation: cc-drop .2s var(--cc-out) both; transform-origin: top right; }
html .bh-confirm { animation: cc-drop .2s var(--cc-back) both; }
html .mm-toast { animation: cc-toast .26s var(--cc-back) both; }
@keyframes cc-toast { from { opacity: 0; translate: 0 8px; scale: .98; } }

/* Help tips fade and grow from their ? button. */
html .ht-tip { animation: cc-tip .18s var(--cc-back) both; transform-origin: 50% 0; }
html .ht-tip.above { animation-name: cc-tip-up; transform-origin: 50% 100%; }
@keyframes cc-tip { from { opacity: 0; scale: .96; translate: 0 -3px; } }
@keyframes cc-tip-up { from { opacity: 0; scale: .96; translate: 0 3px; } }

/* ---- the main menu ---- */
html .mm-home .mm-title { position: relative; isolation: isolate; animation: cc-float 7s ease-in-out infinite; }
html .mm-home.cc-enter .mm-title { animation: cc-rise .3s var(--cc-out) both, cc-float 7s ease-in-out .3s infinite; }
html .mm-home .mm-title::after {
  content: ''; position: absolute; inset: -18% -8%; z-index: -1; pointer-events: none;
  background: radial-gradient(closest-side, ${rgba(theme.player, 0.1)}, transparent); opacity: .5;
  animation: cc-glow 5s ease-in-out infinite alternate;
}
@keyframes cc-float { 0%, 100% { translate: 0 0; } 50% { translate: 0 -2px; } }
@keyframes cc-glow { to { opacity: 1; scale: 1.03; } }
html .mm-home [data-id="play"]::after { box-shadow: 0 0 18px 1px ${rgba(theme.player, 0.35)}; animation: cc-breathe 3.2s ease-in-out infinite; }
html .mm-home [data-id="play"]:is(:hover, :focus-visible)::after { animation: none; opacity: 1; }
@keyframes cc-breathe { 0%, 100% { opacity: 0; } 50% { opacity: .5; } }
html .jb-eq i:nth-child(1) { animation-duration: .9s; }
html .jb-eq i:nth-child(2) { animation-duration: 1.15s; }
html .jb-eq i:nth-child(3) { animation-duration: .75s; }

/* ---- the battle top bar ---- */
html .bh-ping { transition: color .5s ease; }
html .bh-seg { position: relative; }
html .bh-glint { position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .75) 50%, transparent); opacity: 0; pointer-events: none; }
html .bh-seg .bh-n { display: inline-block; }

/* ---- the result panel ---- */
html .rp.enter { animation: cc-fade .22s ease-out both; }
html .rp.enter .rp-panel { animation: cc-pop .28s var(--cc-back) both; }
html .rp.enter .rp-title { animation: cc-rise .26s var(--cc-out) .08s both; }
html .rp.enter .rp-stars svg { animation: cc-star .42s var(--cc-back) both; }
${stagger('html .rp.enter .rp-stars svg', 180, 110, 3)}
@keyframes cc-star { from { opacity: 0; scale: .4; rotate: -25deg; } 70% { opacity: 1; scale: 1.1; } to { scale: 1; rotate: 0deg; } }
html .rp.enter :is(.rp-detail, .rp-extra) { animation: cc-rise .24s var(--cc-out) .12s both; }
html .rp.enter .rp-btns > * { animation: cc-rise .26s var(--cc-back) both; }
html .rp.enter .rp-btns > :nth-child(1) { animation-delay: .16s; }
html .rp.enter .rp-btns > :nth-child(2) { animation-delay: .21s; }
html .rp.enter .rp-keys { animation: cc-fade .3s ease-out .28s both; }
/* A loss: the panel drops in a little heavy, and the headline sags then rights itself. */
html .rp.enter .rp-panel[data-tone="lose"] { animation: cc-droop .5s var(--cc-out) both; }
html .rp.enter .rp-panel[data-tone="lose"] .rp-title { animation: cc-sag .7s ease-in-out .12s both; }
@keyframes cc-droop { from { opacity: 0; translate: 0 -8px; } 55% { opacity: 1; translate: 0 3px; } 75% { translate: -1.5px 1px; } 88% { translate: 1px 0; } to { translate: 0 0; } }
@keyframes cc-sag { from { opacity: 0; } 35% { opacity: 1; translate: 0 2px; rotate: -1deg; } 70% { translate: 0 1px; rotate: .4deg; } to { translate: 0 0; rotate: 0deg; } }
/* A win: a small burst of confetti from the top of the panel. */
html .rp-panel { position: relative; }
html .rp-confetti { position: absolute; left: 50%; top: 10px; width: 0; height: 0; pointer-events: none; }
html .rp-confetti i {
  position: absolute; left: 0; top: 0; width: 5px; height: 8px; border-radius: 1.5px; background: var(--c);
  opacity: 0; animation: cc-confetti 1.1s cubic-bezier(.15, .7, .4, 1) var(--d) both;
}
html .rp-confetti i:nth-child(3n) { width: 6px; height: 6px; border-radius: 50%; }
@keyframes cc-confetti {
  0% { opacity: 0; translate: 0 0; rotate: 0deg; scale: .6; }
  10% { opacity: 1; }
  45% { translate: var(--x) var(--y); scale: 1; }
  100% { opacity: 0; translate: calc(var(--x) * 1.2) calc(var(--y) + 80px); rotate: var(--r); scale: .9; }
}

/* ---- small touches ---- */
html .mm-btn svg, html .mm-corner svg { transition: translate .2s var(--cc-back), scale .2s var(--cc-back), rotate .25s var(--cc-back); }
@media (hover: hover) {
  html .mm-btn:not(:disabled):hover svg { scale: 1.1; }
  html .mm-back:hover svg { scale: 1; translate: -2px 0; }
  html .mm-corner:hover .ic svg { rotate: -8deg; }
  html .ht-btn { transition: rotate .2s var(--cc-back), background-color .15s, color .15s, border-color .15s; }
  html .ht-btn:hover { rotate: -10deg; }
}
/* Picking something: it gives a small tick as it lights up. */
@keyframes cc-tick { from { scale: .94; } 60% { scale: 1.03; } to { scale: 1; } }
html :is(.mm-seg, .mm-skin)[aria-pressed="true"], html .mm-card.on, html .bh-btn[aria-pressed="true"] { animation: cc-tick .22s var(--cc-back); }
html .rp-btns .mm-btn.primary:not(:disabled):hover { transform: translateY(-1px) scale(1.01); }

/* ---- reduce motion: everything still, nothing moves ---- */
html.cc-calm *, html.cc-calm *::before, html.cc-calm *::after {
  animation-duration: 1ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important;
  transition-duration: 1ms !important; transition-delay: 0s !important; scroll-behavior: auto !important;
}
html.cc-calm :is(${PRESSABLE}):is(:hover, :active) { transform: none !important; }
html.cc-calm .rp-confetti { display: none !important; }
html.cc-calm :is(.mm-btn, .mm-corner) svg, html.cc-calm .ht-btn, html.cc-calm .rp-btns .mm-btn { scale: none !important; translate: none !important; rotate: none !important; }
html.cc-calm .jb-eq i { animation: none !important; transform: scaleY(.7); }
`
  document.head.appendChild(Object.assign(document.createElement('style'), { id: 'cc-motion', textContent: css }))
}
