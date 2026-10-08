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

  hide(): void {
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
      const items = [...this.list.querySelectorAll<HTMLElement>('button')]
      const i = items.indexOf(document.activeElement as HTMLElement)
      const d = e.key === 'ArrowDown' ? 1 : -1
      items[(i < 0 ? 0 : i + d + items.length) % items.length]?.focus()
      e.preventDefault()
    }
  }
}

export { ICONS }
