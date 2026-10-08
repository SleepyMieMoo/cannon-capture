import Phaser from 'phaser'
import { GAME_WIDTH } from '../config/layout'
import { cssHex, theme } from '../config/theme'

/**
 * HTML panels laid over the canvas (text fields, file pickers, scrolling
 * lists). Positioned in 1200x720 layout units and scaled with the canvas, so
 * they line up with the game at any window size.
 */
export interface LayoutRect {
  x: number
  y: number
  w: number
  h: number
}

export class Overlay {
  readonly el: HTMLDivElement
  private readonly canvas: HTMLCanvasElement
  private readonly observer: ResizeObserver | null
  private readonly onResize = (): void => this.place()

  constructor(
    scene: Phaser.Scene,
    private readonly rect: LayoutRect,
    className = 'cc-panel',
  ) {
    injectStyles()
    this.canvas = scene.game.canvas
    this.el = document.createElement('div')
    this.el.className = className
    this.el.style.width = `${rect.w}px`
    this.el.style.height = `${rect.h}px`
    document.body.appendChild(this.el)
    window.addEventListener('resize', this.onResize)
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.onResize)
    this.observer = 'ResizeObserver' in window ? new ResizeObserver(this.onResize) : null
    this.observer?.observe(this.canvas)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.destroy()
      scene.scale.off(Phaser.Scale.Events.RESIZE, this.onResize)
    })
    this.place()
    requestAnimationFrame(this.onResize)
  }

  place(): void {
    const r = this.canvas.getBoundingClientRect()
    const k = r.width / GAME_WIDTH
    this.el.style.left = `${r.left + this.rect.x * k}px`
    this.el.style.top = `${r.top + this.rect.y * k}px`
    this.el.style.transform = `scale(${k})`
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize)
    this.observer?.disconnect()
    this.el.remove()
  }
}

export { h } from './dom'

let injected = false

function injectStyles(): void {
  if (injected) return
  injected = true
  const gold = cssHex(theme.player)
  // Panels over the canvas are 97% opaque on purpose: fully opaque layers on
  // top of the WebGL canvas made Chrome skip drawing parts of the canvas
  // (blank strips) in testing. At 97% it looks identical.
  const glass = (c: number): string => `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, 0.97)`
  const css = `
.cc-panel, .cc-sheet {
  position: fixed; transform-origin: 0 0; box-sizing: border-box; z-index: 5;
  font-family: ${theme.font}; font-size: 13px; color: ${theme.text};
  background: ${glass(theme.panel)}; border-left: 2px solid ${cssHex(theme.boardEdge)};
  overflow: hidden; padding: 10px 12px 14px;
}
.cc-sheet { border: 2px solid ${cssHex(theme.boardEdge)}; border-radius: 18px; padding: 18px 22px; background: ${glass(theme.board)}; }
.cc-panel *, .cc-sheet * { box-sizing: border-box; }
.cc-h { font-weight: bold; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: ${theme.textMuted}; margin: 12px 0 6px; }
.cc-h:first-child { margin-top: 0; }
.cc-row { display: flex; gap: 6px; align-items: center; margin: 5px 0; flex-wrap: wrap; }
.cc-row > label { min-width: 74px; color: ${theme.textMuted}; }
.cc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
.cc-btn {
  font: inherit; font-weight: bold; color: ${theme.text}; background: ${cssHex(theme.board)};
  border: 2px solid ${cssHex(theme.boardEdge)}; border-radius: 9px; padding: 6px 8px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 32px;
}
.cc-btn:hover { background: ${cssHex(theme.grid)}; }
.cc-btn.on { border-color: ${gold}; box-shadow: inset 0 0 0 1px ${gold}; }
.cc-btn.primary { background: ${gold}; color: ${theme.ink}; border-color: ${gold}; }
.cc-btn.primary:hover { background: ${cssHex(theme.playerHot)}; }
.cc-btn.danger { color: ${cssHex(theme.enemy)}; }
.cc-btn.wide { width: 100%; }
.cc-btn:disabled { opacity: .45; cursor: default; }
.cc-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; }
.cc-in, .cc-sel, .cc-area {
  font: inherit; color: ${theme.text}; background: ${cssHex(theme.hud)}; border: 2px solid ${cssHex(theme.boardEdge)};
  border-radius: 8px; padding: 5px 7px; min-width: 0; flex: 1;
}
.cc-in:focus, .cc-sel:focus, .cc-area:focus { outline: none; border-color: ${gold}; }
.cc-in.num { flex: 0 0 64px; width: 64px; }
.cc-area { width: 100%; height: 64px; resize: none; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; word-break: break-all; }
.cc-range { flex: 1; accent-color: ${gold}; min-width: 0; }
.cc-note { color: ${theme.textMuted}; font-size: 12px; line-height: 1.4; }
.cc-msg { font-size: 12px; line-height: 1.4; margin-top: 6px; min-height: 16px; }
.cc-msg.err { color: ${cssHex(theme.enemy)}; }
.cc-msg.ok { color: ${cssHex(theme.fan)}; }
.cc-list { display: flex; flex-direction: column; gap: 8px; }
.cc-item { display: flex; gap: 12px; align-items: center; background: ${glass(theme.panel)}; border: 2px solid ${cssHex(theme.boardEdge)}; border-radius: 12px; padding: 8px 10px; }
.cc-item canvas { border-radius: 6px; flex: none; }
.cc-item .meta { flex: 1; min-width: 0; }
.cc-item .name { font-weight: bold; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cc-sep { height: 2px; background: ${cssHex(theme.boardEdge)}; margin: 12px 0 4px; border: 0; }
.cc-check { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; color: ${theme.text}; }
.cc-check input { accent-color: ${gold}; }
.cc-bar {
  position: fixed; transform-origin: 0 0; box-sizing: border-box; z-index: 5; overflow: hidden;
  font-family: ${theme.font}; font-size: 12px; color: ${theme.text};
  background: ${glass(theme.hud)}; border-bottom: 2px solid ${cssHex(theme.boardEdge)};
}
.cc-bar *, .cc-pop * { box-sizing: border-box; }
.cc-toolbar { height: 44px; display: flex; align-items: center; gap: 10px; padding: 0 10px; border-bottom: 1px solid ${cssHex(theme.boardEdge)}; }
.cc-group { display: flex; align-items: center; gap: 4px; }
.cc-spacer { flex: 1; min-width: 4px; }
.cc-btn.sm { min-height: 30px; padding: 3px 8px; border-radius: 8px; font-size: 12px; gap: 4px; white-space: nowrap; }
.cc-btn.sm.icon { width: 30px; padding: 0; font-size: 16px; }
.cc-btn.xs { min-height: 24px; padding: 1px 7px; border-radius: 7px; font-size: 12px; border-width: 1.5px; white-space: nowrap; }
.cc-context { height: 32px; display: flex; align-items: center; gap: 8px; padding: 0 12px; white-space: nowrap; overflow: hidden; }
.cc-name { color: ${theme.textMuted}; max-width: 240px; overflow: hidden; text-overflow: ellipsis; flex: none; }
.cc-vsep { width: 1px; height: 18px; background: ${cssHex(theme.boardEdge)}; flex: none; }
.cc-props { display: flex; align-items: center; gap: 10px; flex: none; }
.cc-field { display: inline-flex; align-items: center; gap: 5px; }
.cc-field label { color: ${theme.textMuted}; }
.cc-val { min-width: 30px; color: ${theme.text}; font-variant-numeric: tabular-nums; }
.cc-props .cc-range { width: 96px; flex: none; }
.cc-sel.xs { padding: 2px 4px; border-radius: 7px; flex: none; font-size: 12px; }
.cc-status { color: ${theme.textMuted}; overflow: hidden; text-overflow: ellipsis; max-width: 380px; flex: 0 1 auto; min-width: 0; }
.cc-status.err { color: ${cssHex(theme.enemy)}; }
.cc-status.ok { color: ${cssHex(theme.fan)}; }
.cc-pop {
  position: fixed; transform-origin: 0 0; box-sizing: border-box; z-index: 6; overflow: hidden;
  font-family: ${theme.font}; font-size: 13px; color: ${theme.text};
  background: ${glass(theme.panel)}; border: 2px solid ${cssHex(theme.boardEdge)}; border-radius: 12px;
  padding: 10px 12px; box-shadow: 0 8px 24px rgba(0,0,0,.45);
}
.cc-keys { display: grid; grid-template-columns: auto 1fr; gap: 5px 12px; font-size: 12px; }
.cc-keys b { color: ${gold}; white-space: nowrap; }
.cc-keys span { color: ${theme.text}; }
`
  document.head.appendChild(Object.assign(document.createElement('style'), { id: 'cc-ui', textContent: css }))
}
