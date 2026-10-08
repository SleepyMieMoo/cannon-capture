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
/* Six columns: Play spans all, then rows of two, then a row of three smaller buttons. */
.mm-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: clamp(6px, 1.3vmin, 10px); width: 100%; margin-top: clamp(4px, 1.4vmin, 14px); }
.mm-grid .mm-btn { grid-column: span 3; min-width: 0; }
.mm-grid .mm-btn.big { grid-column: 1 / -1; }
.mm-grid .mm-btn.third { grid-column: span 2; font-size: clamp(12px, 1.95vmin, 15px); padding: 6px 8px; gap: 8px; }
@media (max-width: 420px) {
  .mm-grid .mm-btn.third { flex-direction: column; gap: 3px; padding: 6px 4px; line-height: 1.15; }
}
/* The home screen's corner buttons: Jukebox (top left) and Profile (top right). */
.mm-corner {
  position: absolute; top: max(10px, var(--discord-safe-area-inset-top, env(safe-area-inset-top))); z-index: 2;
  font: inherit; font-weight: bold; color: ${theme.text}; background: ${rgba(theme.board, 0.9)};
  border: 2px solid ${cssHex(theme.boardEdge)}; border-radius: 999px; cursor: pointer;
  min-height: 44px; min-width: 44px; padding: 4px 14px 4px 10px; display: inline-flex; align-items: center; gap: 8px;
  font-size: clamp(12px, 1.9vmin, 15px); max-width: min(46vw, 300px); transition: background .12s, border-color .12s;
}
.mm-corner.left { left: max(10px, var(--discord-safe-area-inset-left, env(safe-area-inset-left))); }
.mm-corner.right { right: max(10px, var(--discord-safe-area-inset-right, env(safe-area-inset-right))); }
.mm-corner:hover { background: ${rgba(theme.grid, 0.97)}; border-color: ${gold}; }
.mm-corner:focus-visible { outline: 3px solid ${gold}; outline-offset: 2px; }
.mm-corner svg { width: 1.35em; height: 1.35em; flex: none; display: block; }
.mm-corner .ic { display: inline-flex; color: ${gold}; }
.mm-corner .txt { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; line-height: 1.15; }
.mm-corner .np { color: ${theme.textMuted}; font-weight: normal; font-size: .82em; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mm-corner .jb-eq { display: none; }
.mm-corner.on .jb-eq { display: inline-flex; }
@media (max-width: 640px) { .mm-corner .np { display: none; } }
@media (max-width: 460px) {
  .mm-corner { padding: 4px; justify-content: center; }
  .mm-corner .txt { display: none; }
}

/* Jukebox panel (main menu page and the in-battle Menu). */
.jb { display: flex; flex-direction: column; gap: 10px; max-width: 520px; margin-inline: auto; width: 100%; text-align: left; }
.jb .ic { display: inline-flex; }
.jb .ic svg { width: 100%; height: 100%; display: block; }
.jb-now { display: flex; align-items: center; gap: 12px; background: ${rgba(theme.panel, 0.85)}; border: 1px solid ${cssHex(theme.boardEdge)}; border-radius: 14px; padding: 10px 12px; }
.jb-disc { position: relative; flex: none; width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; background: ${cssHex(theme.hud)}; border: 2px solid ${cssHex(theme.boardEdge)}; color: ${gold}; }
.jb-disc > .ic { width: 26px; height: 26px; }
.jb-disc .jb-eq { position: absolute; right: -4px; bottom: -4px; background: ${cssHex(theme.hud)}; border: 1.5px solid ${cssHex(theme.boardEdge)}; border-radius: 8px; padding: 3px 4px; visibility: hidden; }
.jb.on .jb-disc .jb-eq { visibility: visible; }
.jb.on .jb-disc { border-color: ${gold}; }
.jb-meta { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.jb-label { font-size: 11px; font-weight: bold; letter-spacing: .06em; text-transform: uppercase; color: ${theme.textMuted}; }
.jb-title { font-weight: bold; font-size: 1.12em; line-height: 1.25; overflow-wrap: anywhere; }
.jb-artist { color: ${theme.textMuted}; font-size: .92em; }
.jb-eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 12px; }
.jb-eq i { display: block; width: 3px; height: 100%; background: ${gold}; border-radius: 1px; transform-origin: bottom; animation: jb-eq 0.9s ease-in-out infinite; }
.jb-eq i:nth-child(2) { animation-delay: -.3s; }
.jb-eq i:nth-child(3) { animation-delay: -.6s; }
@keyframes jb-eq { 0%, 100% { transform: scaleY(.3); } 50% { transform: scaleY(1); } }
@media (prefers-reduced-motion: reduce) { .jb-eq i { animation: none; transform: scaleY(.7); } }
.jb-ctrl { display: flex; justify-content: center; align-items: center; gap: 12px; }
.jb-btn { font: inherit; color: ${theme.text}; background: ${rgba(theme.board, 0.94)}; border: 2px solid ${cssHex(theme.boardEdge)}; border-radius: 50%; width: 46px; height: 46px; padding: 0; display: grid; place-items: center; cursor: pointer; transition: background .12s, border-color .12s, transform .08s; }
.jb-btn .ic { width: 20px; height: 20px; }
.jb-btn.main { width: 58px; height: 58px; background: ${gold}; border-color: ${gold}; color: ${theme.ink}; }
.jb-btn.main .ic { width: 24px; height: 24px; }
.jb-btn:hover { border-color: ${gold}; background: ${rgba(theme.grid, 0.97)}; }
.jb-btn.main:hover { background: ${cssHex(theme.playerHot)}; }
.jb-btn:active { transform: translateY(1px); }
.jb-btn:focus-visible, .jb-track:focus-visible, .jb-def:focus-visible { outline: 3px solid ${gold}; outline-offset: 2px; }
.jb-status { text-align: center; color: ${theme.textMuted}; font-size: .92em; min-height: 1.3em; }
.jb-status[data-status="locked"], .jb-status[data-status="missing"] { color: ${gold}; font-weight: bold; }
.jb .mm-h { margin: 2px 0 0; }
.jb-list { display: flex; flex-direction: column; gap: 6px; }
.jb-row { display: flex; gap: 6px; }
.jb-track { flex: 1; min-width: 0; font: inherit; color: ${theme.text}; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 10px; background: ${rgba(theme.panel, 0.9)}; border: 2px solid ${cssHex(theme.boardEdge)}; border-radius: 12px; padding: 6px 10px; min-height: 46px; }
.jb-track:hover { border-color: ${gold}; }
.jb-track[aria-pressed="true"] { border-color: ${gold}; box-shadow: inset 0 0 0 1px ${gold}; background: ${rgba(theme.grid, 0.6)}; }
.jb-track.missing { opacity: .6; }
.jb-num { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: bold; background: ${cssHex(theme.hud)}; color: ${theme.textMuted}; }
.jb-track[aria-pressed="true"] .jb-num { background: ${gold}; color: ${theme.ink}; }
.jb-name { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
.jb-name b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.jb-name small { color: ${theme.textMuted}; font-size: .82em; }
.jb-def { flex: none; width: 46px; font: inherit; cursor: pointer; display: grid; place-items: center; background: ${rgba(theme.panel, 0.9)}; border: 2px solid ${cssHex(theme.boardEdge)}; border-radius: 12px; color: ${theme.textMuted}; }
.jb-def .ic { width: 20px; height: 20px; }
.jb-def:hover { border-color: ${gold}; color: ${theme.text}; }
.jb-def[aria-pressed="true"] { color: ${gold}; border-color: ${gold}; }
.jb-vol { margin: 0; }
.jb-vol label { min-width: 0; }
.mm-screen.narrow { width: min(620px, 100%); }
.bm .jb { gap: 8px; font-size: 14px; }
.bm .jb .jb-now { padding: 8px 10px; }
.bm .jb .mm-note { font-size: 12px; }
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
.mm-btn:focus-visible, .mm-seg:focus-visible, .mm-skin:focus-visible, .mm-card:focus-visible, .mm-range:focus-visible, .mm-switch:focus-visible { outline: 3px solid ${gold}; outline-offset: 2px; }
.mm-btn.big { min-height: clamp(50px, 9vmin, 70px); font-size: clamp(16px, 2.9vmin, 23px); }
.mm-btn.primary { background: ${gold}; color: ${theme.ink}; border-color: ${gold}; }
.mm-btn.primary:hover { background: ${cssHex(theme.playerHot)}; }
.mm-btn:disabled { opacity: .5; cursor: default; }
.mm-btn:disabled:hover { background: ${rgba(theme.board, 0.94)}; border-color: ${cssHex(theme.boardEdge)}; }
.mm-soon { font: inherit; font-size: clamp(11px, 1.7vmin, 13px); color: ${theme.textMuted}; background: transparent; border: 1.5px dashed ${cssHex(theme.boardEdge)}; border-radius: 999px; padding: 5px 14px; display: inline-flex; gap: 8px; align-items: center; opacity: .8; cursor: default; }
.mm-soon b { color: ${theme.text}; }
.mm-foot { color: ${theme.textMuted}; font-size: clamp(10px, 1.5vmin, 12px); opacity: .75; text-align: center; }
.mm-ver { font: inherit; font-size: clamp(10px, 1.5vmin, 12px); color: ${theme.textMuted}; background: transparent; border: 0; border-radius: 8px; padding: 4px 10px; min-height: 30px; cursor: pointer; font-variant-numeric: tabular-nums; }
.mm-ver span { opacity: .8; }
.mm-ver:hover { color: ${theme.text}; text-decoration: underline; text-underline-offset: 3px; }
.mm-ver:focus-visible { outline: 2px solid ${gold}; outline-offset: 1px; }
.mm-verfoot { display: flex; justify-content: center; margin-top: 14px; opacity: .85; }
.mm-btn.small { min-height: 42px; font-size: clamp(12px, 1.9vmin, 14px); padding: 4px 14px; border-radius: 11px; gap: 8px; }
.mm-btn.danger { background: ${cssHex(theme.enemy)}; border-color: ${cssHex(theme.enemy)}; color: ${theme.ink}; }
.mm-btn.danger:hover { background: ${cssHex(theme.enemy)}; filter: brightness(1.08); border-color: ${theme.text}; }
.mm-toast { position: fixed; left: 50%; bottom: calc(max(10px, var(--discord-safe-area-inset-bottom, env(safe-area-inset-bottom))) + clamp(76px, 13vmin, 100px)); transform: translateX(-50%); z-index: 9; max-width: min(92vw, 460px); background: ${rgba(theme.panel, 0.98)}; color: ${theme.text}; border: 2px solid ${gold}; border-radius: 12px; padding: 10px 16px; font-weight: bold; text-align: center; box-shadow: 0 8px 24px ${rgba(0, 0.45)}; animation: mm-toast-in .16s ease-out; }
@keyframes mm-toast-in { from { opacity: 0; transform: translate(-50%, 8px); } }
.mm-copybox { width: 100%; margin-top: 10px; font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace; color: ${theme.text}; background: ${rgba(theme.panel, 0.95)}; border: 2px solid ${gold}; border-radius: 10px; padding: 8px; resize: vertical; user-select: text; }
.mm-me { display: flex; align-items: center; justify-content: center; gap: clamp(14px, 4vmin, 40px); background: ${rgba(theme.panel, 0.8)}; border: 1px solid ${cssHex(theme.boardEdge)}; border-radius: 14px; padding: 8px 12px; margin-bottom: 12px; }
.mm-me > div { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.mm-me .pv { display: block; width: clamp(72px, 13vmin, 104px); aspect-ratio: 1; }
.mm-me .pv svg { width: 100%; height: 100%; display: block; }
.mm-me .pv.ai { transform: scaleX(-1); }
.mm-me small { color: ${theme.textMuted}; font-weight: bold; }
.mm-me .vs { color: ${theme.textMuted}; font-weight: bold; font-size: 1.1em; }
.mm-saved { color: ${gold}; font-size: 12px; min-width: 3em; }
.mm-row .mm-input { flex: 1; }
.mm-confirm { background: ${rgba(theme.panel, 0.9)}; border: 2px solid ${cssHex(theme.enemy)}; border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.mm-confirm .mm-row { margin: 4px 0 0; }
.mm-cred { margin: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0; max-width: 760px; margin-inline: auto; }
.mm-cred-row { display: contents; }
.mm-cred dt, .mm-cred dd { margin: 0; padding: 9px 10px; border-bottom: 1px solid ${rgba(theme.boardEdge, 0.7)}; line-height: 1.45; }
.mm-cred dt { font-weight: bold; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: ${theme.textMuted}; padding-top: 11px; }
.mm-cred dd { color: ${theme.text}; }
.mm-cred a, .mm-news a { color: ${gold}; }
.mm-news { max-width: 760px; margin-inline: auto; }
.mm-news ul { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.mm-news li { display: flex; gap: 10px; align-items: flex-start; background: ${rgba(theme.panel, 0.85)}; border: 1px solid ${cssHex(theme.boardEdge)}; border-radius: 12px; padding: 8px 10px; }
.mm-news li > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mm-news li span:not(.mm-kind) { color: ${theme.textMuted}; line-height: 1.4; }
.mm-kind { flex: none; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: .05em; border-radius: 999px; padding: 2px 8px; margin-top: 1px; min-width: 64px; text-align: center; }
.mm-kind.new { background: ${gold}; color: ${theme.ink}; }
.mm-kind.change { background: ${cssHex(theme.grid)}; color: ${theme.text}; border: 1px solid ${cssHex(theme.boardEdge)}; }
.mm-kind.fix { background: transparent; color: ${gold}; border: 1px solid ${gold}; }

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
.mm-seg:disabled { cursor: default; }
.mm-seg:disabled:hover { border-color: ${cssHex(theme.boardEdge)}; }
.mm-seg:disabled[aria-pressed="true"]:hover { border-color: ${gold}; }
.mm-seg:disabled:not([aria-pressed="true"]) { opacity: .6; }
.mm-segs3 { grid-template-columns: repeat(3, 1fr); }
.mm-segs3 .mm-seg { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4px 2px; line-height: 1.15; }
.mm-segs3 .mm-seg small { font-weight: normal; font-size: .78em; opacity: .85; }
.mm-sub { font-size: .85em; font-weight: bold; color: ${theme.textMuted}; margin: 10px 0 4px; }
.mm-switch:disabled { cursor: default; opacity: .7; }
.mm-sides { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.mm-sides > div { background: ${rgba(theme.panel, 0.9)}; border: 2px solid ${cssHex(theme.boardEdge)}; border-radius: 10px; padding: 6px 10px; min-width: 0; }
.mm-sides small { display: block; color: ${theme.textMuted}; font-size: .78em; }
.mm-sides b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mm-skins { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-bottom: 6px; }
.mm-skin { font: inherit; font-weight: bold; font-size: 12px; color: ${theme.text}; background: ${rgba(theme.panel, 0.9)}; border: 2px solid ${cssHex(theme.boardEdge)}; border-radius: 10px; padding: 4px 2px 5px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
.mm-skin:hover { border-color: ${gold}; }
.mm-skin[aria-pressed="true"] { border-color: ${gold}; box-shadow: inset 0 0 0 1px ${gold}; background: ${rgba(theme.grid, 0.6)}; }
.mm-skin .pv { display: block; width: 100%; max-width: 64px; aspect-ratio: 1; }
.mm-skin .pv svg { width: 100%; height: 100%; display: block; }
.mm-skin .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.mm-skin[aria-pressed="true"] .n { color: ${gold}; }
.mm-skins.small .mm-skin { font-size: 11px; padding: 2px 1px 3px; }
.mm-skins.small .mm-skin .pv { max-width: 40px; }
.mm-skins.colours.small { grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 4px; }
.mm-skins.colours.small .mm-skin { padding: 2px 0; }
.mm-skins.colours.small .mm-skin .n { display: none; }
.mm-vs i { display: inline-block; width: .8em; height: .8em; border-radius: 50%; vertical-align: -1px; margin: 0 4px 0 0; box-shadow: 0 0 0 1px ${cssHex(theme.dim)}; }
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
.mm-tip.wide { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); grid-template-rows: auto 1fr; column-gap: 12px; row-gap: 2px; align-items: start; }
.mm-tip.wide > div { grid-row: 1 / span 2; align-self: center; }
.mm-keys { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 12px; color: ${theme.textMuted}; justify-content: center; }
.mm-keys kbd, .bm kbd { font: inherit; font-weight: bold; color: ${theme.text}; background: ${cssHex(theme.hud)}; border: 1.5px solid ${cssHex(theme.boardEdge)}; border-bottom-width: 3px; border-radius: 6px; padding: 0 6px; margin-right: 4px; }

@media (max-height: 540px) and (min-aspect-ratio: 4/3) {
  .mm-home { width: min(860px, 100%); gap: 4px; }
  .mm-grid { grid-template-columns: repeat(12, minmax(0, 1fr)); }
  .mm-grid .mm-btn.third { grid-column: span 4; }
  .mm-tag { display: none; }
  .mm-how { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .mm-tip svg { max-height: 50px; }
  .mm-tip { padding: 6px 8px; gap: 2px; }
  .mm-tip span { font-size: 11px; line-height: 1.3; }
  .mm-keys { margin-top: 6px; font-size: 11px; }
  .mm-head { padding-top: 6px; padding-bottom: 6px; }
}
@media (max-width: 480px) {
  .mm-cred { grid-template-columns: minmax(0, 1fr); }
  .mm-cred dt { border-bottom: 0; padding-bottom: 0; }
  .mm-cred dd { padding-top: 2px; }
  .mm-kind { min-width: 0; }
  .mm-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .mm-card { padding: 4px; }
  .mm-card .m { display: none; }
  .mm-card .n { font-size: 11px; }
  .mm-bar .mm-btn { min-width: 0; }
}
@media (max-width: 720px) {
  .mm-play, .mm-set { grid-template-columns: minmax(0, 1fr); }
  .mm-how { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mm-tip.wide { display: flex; }
  .mm-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mm-head .mm-sub { display: none; }
}
@media (max-width: 720px) and (max-height: 540px) {
  .mm-how { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .mm-tip.wide { display: grid; }
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
