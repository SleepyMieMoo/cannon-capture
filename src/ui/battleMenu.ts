import Phaser from 'phaser'
import { GAME_HEIGHT, GAME_WIDTH } from '../config/layout'
import { ICONS } from '../menu/art'
import { injectMenuStyles } from '../menu/menuStyles'
import { Overlay, h } from './overlay'

export interface BattleMenuItem {
  id: string
  label: string
  run: () => void
  primary?: boolean
  icon?: string
}

/**
 * The in-battle menu (HUD "Menu", or Esc): Resume, Restart, Back, Main menu.
 * HTML over the whole board, scaled with the canvas like the other overlays,
 * so the board can't be clicked while it is open. Keys: Esc resumes, R
 * restarts, arrows move between buttons.
 */
export class BattleMenu {
  open = false
  private readonly overlay: Overlay
  private readonly title: HTMLHeadingElement
  private readonly sub: HTMLDivElement
  private readonly list: HTMLDivElement
  private readonly onKey = (e: KeyboardEvent): void => this.key(e)
  /** The last list of buttons (a panel's Back returns to it). */
  private last: { title: string; sub: string; items: BattleMenuItem[] } | null = null
  /** Clean-up for a panel shown in place of the buttons (the jukebox). */
  private panelOff: (() => void) | null = null

  constructor(
    scene: Phaser.Scene,
    private readonly onEsc: () => void,
    private readonly onRestart: () => void,
  ) {
    injectMenuStyles()
    this.overlay = new Overlay(scene, { x: 0, y: 0, w: GAME_WIDTH, h: GAME_HEIGHT }, 'bm')
    this.title = h('h2', {}, 'Paused')
    this.sub = h('div.s')
    this.list = h('div', { style: 'display:flex;flex-direction:column;gap:10px' })
    const panel = h('div.bm-panel', { role: 'dialog', 'aria-label': 'Battle menu' }, this.title, this.sub, this.list, h('div.k', {}, h('kbd', {}, 'Esc'), 'resume  ·  ', h('kbd', {}, 'R'), 'restart'))
    this.overlay.el.append(panel)
    // A click on the dim area around the panel resumes too.
    this.overlay.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.overlay.el) this.onEsc()
    })
    this.overlay.el.style.display = 'none'
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('keydown', this.onKey))
  }

  show(title: string, sub: string, items: BattleMenuItem[]): void {
    this.closePanel()
    this.last = { title, sub, items }
    this.title.textContent = title
    this.sub.textContent = sub
    this.list.replaceChildren(
      ...items.map((it) => {
        const b = h(`button.mm-btn${it.primary ? '.primary' : ''}`, { type: 'button', dataset: { id: it.id }, onclick: it.run })
        if (it.icon) b.append(h('span', { innerHTML: it.icon, style: 'display:inline-flex' }))
        b.append(it.label)
        return b
      }),
    )
    this.open = true
    this.overlay.el.style.display = 'flex'
    this.overlay.place()
    window.addEventListener('keydown', this.onKey)
    this.list.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
  }

  /**
   * Show a panel (the jukebox) in place of the buttons, with a Back button to
   * the list it came from. Esc still closes the whole menu.
   */
  showPanel(title: string, sub: string, panel: { el: HTMLElement; destroy(): void }): void {
    if (!this.open) return panel.destroy()
    this.closePanel()
    this.panelOff = panel.destroy
    this.title.textContent = title
    this.sub.textContent = sub
    const back = h('button.mm-btn', { type: 'button', dataset: { id: 'panel-back' }, onclick: () => this.last && this.show(this.last.title, this.last.sub, this.last.items) })
    back.append(h('span', { innerHTML: ICONS.back, style: 'display:inline-flex' }), 'Back')
    this.list.replaceChildren(panel.el, back)
    this.overlay.place()
    ;(this.list.querySelector<HTMLElement>('[data-autofocus]') ?? back).focus({ preventScroll: true })
  }

  private closePanel(): void {
    this.panelOff?.()
    this.panelOff = null
  }

  hide(): void {
    this.closePanel()
    if (!this.open) return
    this.open = false
    this.overlay.el.style.display = 'none'
    window.removeEventListener('keydown', this.onKey)
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  }

  private key(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      this.onEsc()
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault()
      this.onRestart()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...this.list.querySelectorAll<HTMLElement>('button, input')]
      const i = items.indexOf(document.activeElement as HTMLElement)
      const d = e.key === 'ArrowDown' ? 1 : -1
      items[(i < 0 ? 0 : i + d + items.length) % items.length]?.focus()
      e.preventDefault()
    }
  }
}

export { ICONS }
