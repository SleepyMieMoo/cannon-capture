import { cssHex, theme } from '../config/theme'

const rgba = (c: number, a: number): string => `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`

let injected = false

/**
 * Styles for the main menu and the in-battle menu (Dark Choco colours only).
 * Sizes use clamp() on the viewport, so the menu fits anything from a phone
 * in portrait to 1080p, and inside an embedded frame (Discord activity),
 * without the page ever scrolling. Long lists scroll inside their panel.
 */
export function injectMenuStyles(): void {
  if (injected) return
  injected = true
  const gold = cssHex(theme.player)
  const css = `
.mm {
  position: fixed; inset: 0; z-index: 5; box-sizing: border-box; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  padding: max(10px, var(--discord-safe-area-inset-top, env(safe-area-inset-top))) max(10px, var(--discord-safe-area-inset-right, env(safe-area-inset-right))) max(10px, var(--discord-safe-area-inset-bottom, env(safe-area-inset-bottom))) max(10px, var(--discord-safe-area-inset-left, env(safe-area-inset-left)));
  font-family: ${theme.font}; color: ${theme.text}; font-size: clamp(12px, 1.9vmin, 15px);
  background: radial-gradient(ellipse at center, ${rgba(theme.bg, 0.74)} 0%, ${rgba(theme.bg, 0.42)} 55%, ${rgba(theme.bg, 0.18)} 100%);
  -webkit-tap-highlight-color: transparent; user-select: none;
}
.mm *, .bm * { box-sizing: border-box; }
.mm-home { display: flex; flex-direction: column; align-items: center; gap: clamp(6px, 1.6vmin, 14px); width: min(560px, 100%); max-height: 100%; }
.mm-title { font-size: clamp(34px, 8.5vmin, 84px); font-weight: bold; letter-spacing: .01em; line-height: 1.05; text-align: center; text-shadow: 0 3px 0 ${cssHex(theme.dim)}, 0 0 28px ${rgba(theme.player, 0.18)}; }
.mm-title span { color: ${gold}; }
.mm-by { color: ${theme.textMuted}; font-size: clamp(12px, 2.1vmin, 17px); margin-top: -2px; }
.mm-tag { color: ${theme.textMuted}; font-size: clamp(11px, 1.8vmin, 14px); opacity: .85; }
.mm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(6px, 1.3vmin, 10px); width: 100%; margin-top: clamp(4px, 1.4vmin, 14px); }
.mm-grid .mm-btn.big { grid-column: 1 / -1; }
.mm-btn {
  font: inherit; font-weight: bold; color: ${theme.text}; background: ${rgba(theme.board, 0.94)};
  border: 2px solid ${cssHex(theme.boardEdge)}; border-radius: 14px; cursor: pointer;
  min-height: clamp(42px, 7.2vmin, 58px); padding: 6px 14px; font-size: clamp(13px, 2.2vmin, 17px);
  display: inline-flex; align-items: center; justify-content: center; gap: 10px; text-align: center;
  transition: background .12s, border-color .12s, transform .08s;
}
.mm-btn svg { width: 1.25em; height: 1.25em; flex: none; }
.mm-btn:hover { background: ${rgba(theme.grid, 0.97)}; border-color: ${gold}; }
.mm-btn:active { transform: translateY(1px); }
.mm-btn:focus-visible, .mm-seg:focus-visible, .mm-card:focus-visible, .mm-range:focus-visible, .mm-switch:focus-visible { outline: 3px solid ${gold}; outline-offset: 2px; }
.mm-btn.big { min-height: clamp(50px, 9vmin, 70px); font-size: clamp(16px, 2.9vmin, 23px); }
.mm-btn.primary { background: ${gold}; color: ${theme.ink}; border-color: ${gold}; }
.mm-btn.primary:hover { background: ${cssHex(theme.playerHot)}; }
.mm-btn:disabled { opacity: .5; cursor: default; }
.mm-btn:disabled:hover { background: ${rgba(theme.board, 0.94)}; border-color: ${cssHex(theme.boardEdge)}; }
.mm-soon { font: inherit; font-size: clamp(11px, 1.7vmin, 13px); color: ${theme.textMuted}; background: transparent; border: 1.5px dashed ${cssHex(theme.boardEdge)}; border-radius: 999px; padding: 5px 14px; display: inline-flex; gap: 8px; align-items: center; opacity: .8; cursor: default; }
.mm-soon b { color: ${theme.text}; }
.mm-foot { color: ${theme.textMuted}; font-size: clamp(10px, 1.5vmin, 12px); opacity: .75; text-align: center; }

.mm-screen {
  width: min(980px, 100%); max-height: 100%; display: flex; flex-direction: column;
  background: ${rgba(theme.board, 0.95)}; border: 2px solid ${cssHex(theme.boardEdge)}; border-radius: 18px;
  box-shadow: 0 14px 40px ${rgba(0, 0.45)};
}
.mm-head { display: flex; align-items: center; gap: 12px; padding: clamp(8px, 1.6vmin, 14px) clamp(10px, 2vmin, 18px); border-bottom: 2px solid ${cssHex(theme.boardEdge)}; flex: none; }
.mm-head h2 { margin: 0; font-size: clamp(17px, 3vmin, 26px); }
.mm-head .mm-sub { color: ${theme.textMuted}; font-size: clamp(11px, 1.7vmin, 13px); margin-left: auto; text-align: right; }
.mm-back { min-height: 38px; padding: 4px 12px; font-size: clamp(12px, 1.9vmin, 14px); border-radius: 10px; }
.mm-body { padding: clamp(10px, 1.8vmin, 18px); overflow: auto; flex: 1 1 auto; min-height: 0; overscroll-behavior: contain; }
.mm-h { font-weight: bold; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: ${theme.textMuted}; margin: 4px 0 8px; }
.mm-h + .mm-h, .mm-cards + .mm-h { margin-top: 14px; }
.mm-note { color: ${theme.textMuted}; line-height: 1.45; }
.mm-note a { color: ${gold}; }

.mm-play { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: clamp(10px, 2vmin, 20px); }
.mm-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(clamp(120px, 20vmin, 168px), 1fr)); gap: 8px; }
.mm-card {
  font: inherit; color: ${theme.text}; text-align: left; cursor: pointer; padding: 6px; border-radius: 12px;
  background: ${rgba(theme.panel, 0.9)}; border: 2px solid ${cssHex(theme.boardEdge)}; display: flex; flex-direction: column; gap: 4px; min-width: 0;
}
.mm-card:hover { border-color: ${gold}; }
.mm-card.on { border-color: ${gold}; box-shadow: inset 0 0 0 1px ${gold}; background: ${rgba(theme.grid, 0.6)}; }
.mm-card canvas { width: 100% !important; height: auto !important; border-radius: 7px; display: block; }
.mm-card .n { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mm-card .m { color: ${theme.textMuted}; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; justify-content: space-between; gap: 6px; }
.mm-card .st { color: ${gold}; letter-spacing: 1px; }
.mm-side { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.mm-segs { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.mm-seg { font: inherit; font-weight: bold; color: ${theme.text}; background: ${rgba(theme.panel, 0.9)}; border: 2px solid ${cssHex(theme.boardEdge)}; border-radius: 10px; min-height: 40px; cursor: pointer; }
.mm-seg:hover { border-color: ${gold}; }
.mm-seg[aria-pressed="true"] { background: ${gold}; color: ${theme.ink}; border-color: ${gold}; }
.mm-blurb { min-height: 3.2em; color: ${theme.textMuted}; line-height: 1.4; }
.mm-pick { background: ${rgba(theme.panel, 0.7)}; border-radius: 12px; padding: 10px 12px; border: 1px solid ${cssHex(theme.boardEdge)}; }
.mm-pick .n { font-weight: bold; font-size: 1.1em; }
.mm-bar { flex: none; display: flex; gap: 12px; align-items: stretch; padding: clamp(8px, 1.6vmin, 14px) clamp(10px, 1.8vmin, 18px); border-top: 2px solid ${cssHex(theme.boardEdge)}; }
.mm-bar .mm-pick { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.mm-bar .mm-pick .n, .mm-bar .mm-pick .mm-note { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mm-bar .mm-btn { flex: 0 0 auto; min-width: min(280px, 45%); }

.mm-set { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: clamp(12px, 2.4vmin, 24px); }
.mm-row { display: flex; align-items: center; gap: 12px; margin: 6px 0 10px; flex-wrap: wrap; }
.mm-row label { font-weight: bold; min-width: 70px; }
.mm-switch { appearance: none; -webkit-appearance: none; width: 46px; height: 26px; border-radius: 13px; background: ${cssHex(theme.grid)}; position: relative; cursor: pointer; margin: 0; flex: none; transition: background .12s; }
.mm-switch::after { content: ''; position: absolute; top: 4px; left: 4px; width: 18px; height: 18px; border-radius: 50%; background: ${cssHex(theme.neutral)}; transition: left .12s, background .12s; }
.mm-switch:checked { background: ${gold}; }
.mm-switch:checked::after { left: 24px; background: ${cssHex(theme.hud)}; }
.mm-friends { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: clamp(12px, 2.4vmin, 24px); }
.mm-input { font: inherit; font-size: 16px; color: ${theme.text}; background: ${rgba(theme.panel, 0.95)}; border: 2px solid ${cssHex(theme.boardEdge)}; border-radius: 10px; padding: 8px 10px; min-height: 42px; min-width: 0; width: 100%; box-sizing: border-box; }
.mm-input:focus { outline: none; border-color: ${gold}; }
.mm-code-in { text-transform: uppercase; letter-spacing: .3em; font-weight: bold; font-size: 20px; text-align: center; flex: 1; }
.mm-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.mm-row .mm-btn { flex: none; }
.mm-err { color: ${cssHex(theme.enemy)}; min-height: 1.2em; margin: 8px 0; }
.mm-rules { margin-top: 10px; font-size: 12px; }
.mm-bigcode { font-size: clamp(34px, 7vmin, 52px); font-weight: bold; letter-spacing: .25em; color: ${gold}; text-align: center; background: ${rgba(theme.panel, 0.8)}; border-radius: 12px; padding: 4px 0 4px .25em; user-select: all; }
.mm-link { font-size: 12px; min-height: 32px; color: ${theme.textMuted}; }
.mm-seat { background: ${rgba(theme.panel, 0.85)}; border: 2px solid ${cssHex(theme.boardEdge)}; border-radius: 12px; padding: 8px 10px; }
.mm-seat.you { border-color: ${gold}; }
.mm-seat.empty { border-style: dashed; opacity: .75; }
.mm-seat .n { font-weight: bold; }
.mm-seat .m { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: ${theme.textMuted}; }
.mm-seat .ok { color: ${gold}; }
.mm-card:disabled { cursor: default; }
.mm-card:disabled:not(.on) { opacity: .6; }
.mm-card:disabled:hover:not(.on) { border-color: ${cssHex(theme.boardEdge)}; }
.mm-soon svg { width: 1.3em; height: 1.3em; flex: none; }
.mm-soon.live { cursor: pointer; opacity: 1; border-style: solid; border-color: ${gold}; font-size: clamp(13px, 2.1vmin, 16px); padding: 7px 18px; color: ${theme.text}; }
.mm-soon.live:hover { background: ${rgba(theme.grid, 0.6)}; }
.mm-range { flex: 1; min-width: 120px; accent-color: ${gold}; height: 28px; }
.mm-val { min-width: 44px; text-align: right; font-variant-numeric: tabular-nums; }
.mm-credits { margin: 0; padding-left: 18px; line-height: 1.6; color: ${theme.textMuted}; }
.mm-credits b { color: ${theme.text}; }
.mm-credits a { color: ${gold}; }

.mm-how { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.mm-tip { background: ${rgba(theme.panel, 0.85)}; border: 1px solid ${cssHex(theme.boardEdge)}; border-radius: 12px; padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mm-tip svg { width: 100%; height: auto; max-height: 92px; display: block; }
.mm-tip b { font-size: 1.02em; }
.mm-tip span { color: ${theme.textMuted}; line-height: 1.4; font-size: .95em; }
.mm-keys { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 12px; color: ${theme.textMuted}; justify-content: center; }
.mm-keys kbd, .bm kbd { font: inherit; font-weight: bold; color: ${theme.text}; background: ${cssHex(theme.hud)}; border: 1.5px solid ${cssHex(theme.boardEdge)}; border-bottom-width: 3px; border-radius: 6px; padding: 0 6px; margin-right: 4px; }

@media (max-height: 540px) and (min-aspect-ratio: 4/3) {
  .mm-home { width: min(780px, 100%); gap: 4px; }
  .mm-grid { grid-template-columns: repeat(3, 1fr); }
  .mm-tag { display: none; }
  .mm-how { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .mm-tip svg { max-height: 50px; }
  .mm-tip { padding: 6px 8px; gap: 2px; }
  .mm-tip span { font-size: 11px; line-height: 1.3; }
  .mm-keys { margin-top: 6px; font-size: 11px; }
  .mm-head { padding-top: 6px; padding-bottom: 6px; }
}
@media (max-width: 480px) {
  .mm-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .mm-card { padding: 4px; }
  .mm-card .m { display: none; }
  .mm-card .n { font-size: 11px; }
  .mm-bar .mm-btn { min-width: 0; }
}
@media (max-width: 720px) {
  .mm-play, .mm-set { grid-template-columns: minmax(0, 1fr); }
  .mm-how { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mm-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mm-head .mm-sub { display: none; }
}
@media (max-width: 720px) and (max-height: 540px) {
  .mm-how { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .mm-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

.bm {
  position: fixed; transform-origin: 0 0; z-index: 7; display: flex; align-items: center; justify-content: center;
  background: ${rgba(theme.dim, 0.6)}; font-family: ${theme.font}; color: ${theme.text}; font-size: 15px;
}
.bm-panel { width: 400px; background: ${rgba(theme.panel, 0.97)}; border: 2px solid ${cssHex(theme.boardEdge)}; border-radius: 18px; padding: 20px 22px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 14px 40px ${rgba(0, 0.5)}; }
.bm-panel h2 { margin: 0; font-size: 26px; }
.bm-panel .s { color: ${theme.textMuted}; font-size: 13px; margin-top: -4px; margin-bottom: 4px; }
.bm .mm-btn { width: 100%; min-height: 48px; font-size: 17px; }
.bm .k { color: ${theme.textMuted}; font-size: 12px; text-align: center; margin-top: 2px; }
`
  document.head.appendChild(Object.assign(document.createElement('style'), { id: 'cc-menu', textContent: css }))
}
