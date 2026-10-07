import Phaser from 'phaser'
import { GAME_HEIGHT, GAME_WIDTH } from '../config/layout'
import { theme } from '../config/theme'
import { DEBUG } from '../debug'
import {
  decodeShare,
  deleteMap,
  encodeShare,
  listMaps,
  mapToJson,
  newMapId,
  renameMap,
  saveMap,
  validateMap,
  type SavedMap,
} from '../editor/maps'
import { drawThumb } from '../editor/thumb'
import { MAP_SIZES } from '../levels/board'
import { bindSceneResolution } from '../render/resolution'
import { Overlay, h } from '../ui/overlay'

/** "My maps": every map saved from the editor, plus import from a code or file. */
export class MapsScene extends Phaser.Scene {
  private list!: HTMLDivElement
  private msg!: HTMLDivElement
  private code!: HTMLTextAreaElement
  private confirmDelete: string | null = null
  private page = 0
  private pager!: HTMLDivElement

  constructor() {
    super('maps')
  }

  create(): void {
    bindSceneResolution(this)
    this.confirmDelete = null
    const g = this.add.graphics()
    g.fillStyle(theme.bg, 1)
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)

    const sheet = new Overlay(this, { x: 120, y: 30, w: 960, h: 660 }, 'cc-sheet')
    const file = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: () => {
      const f = file.files?.[0]
      file.value = ''
      if (f) f.text().then((t) => this.importText(t), () => this.say('Could not read that file.', true))
    } })
    this.code = h('textarea.cc-area', { placeholder: 'Paste a share code (CC1:...) or map JSON', spellcheck: false, style: 'height:40px' })
    this.msg = h('div.cc-msg')
    this.list = h('div.cc-list')
    this.pager = h('div.cc-row', { style: 'position:absolute;left:22px;right:22px;bottom:14px;justify-content:center' })
    this.page = 0

    sheet.el.append(
      h('div.cc-row', { style: 'justify-content:space-between;margin:0 0 6px' },
        h('div', { style: 'font-size:28px;font-weight:bold' }, 'My maps'),
        h('div.cc-row', { style: 'margin:0' },
          h('button.cc-btn.primary', { onclick: () => this.scene.start('editor', { fresh: true }) }, '+ New map'),
          h('button.cc-btn', { onclick: () => this.scene.start('editor', { resume: true }) }, 'Open editor'),
          h('button.cc-btn', { onclick: () => this.scene.start('title') }, 'Menu'),
        ),
      ),
      h('div.cc-row', {},
        this.code,
        h('button.cc-btn', { onclick: () => this.importText(this.code.value) }, 'Import code'),
        h('button.cc-btn', { onclick: () => file.click() }, 'Upload .json'),
        file,
      ),
      this.msg,
      h('div', { style: 'height:6px' }),
      this.list,
      this.pager,
    )
    this.renderList()
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('title'))
    if (DEBUG.enabled) (window as unknown as { __maps?: unknown }).__maps = this
  }

  private say(text: string, error = false): void {
    this.msg.textContent = text
    this.msg.className = `cc-msg ${error ? 'err' : 'ok'}`
  }

  private importText(text: string): void {
    try {
      const level = decodeShare(text)
      level.id = newMapId()
      saveMap(level)
      this.code.value = ''
      this.say(`Imported "${level.name}".`)
      this.renderList()
    } catch (err) {
      this.say((err as Error).message, true)
    }
  }

  private renderList(): void {
    const maps = listMaps()
    this.pager.replaceChildren()
    if (!maps.length) {
      this.list.replaceChildren(
        h('div.cc-note', { style: 'padding:24px 4px;font-size:14px' },
          'No saved maps yet. Make one with "+ New map", or paste a share code above.'),
      )
      return
    }
    // Pages instead of a scrolling list keeps the sheet simple.
    const per = 4
    const pages = Math.ceil(maps.length / per)
    this.page = Math.min(this.page, pages - 1)
    this.list.replaceChildren(...maps.slice(this.page * per, this.page * per + per).map((m) => this.row(m)))
    if (pages > 1) {
      const go = (d: number): void => {
        this.page = Math.max(0, Math.min(pages - 1, this.page + d))
        this.renderList()
      }
      this.pager.append(
        h('button.cc-btn', { disabled: this.page === 0, onclick: () => go(-1) }, '‹ Prev'),
        h('span.cc-note', { style: 'min-width:120px;text-align:center' }, `Page ${this.page + 1} of ${pages}  ·  ${maps.length} maps`),
        h('button.cc-btn', { disabled: this.page >= pages - 1, onclick: () => go(1) }, 'Next ›'),
      )
    }
  }

  private row(m: SavedMap): HTMLElement {
    const L = m.level
    const thumb = h('canvas')
    drawThumb(thumb, L, 150)
    const problems = validateMap(L)
    const count = (side: string): number => L.cannons.filter((c) => c.side === side).length
    const mode = L.kind === 'puzzle' ? `Puzzle${L.aims ? ` · ${L.aims} aims` : ''}` : 'Battle'
    const details = `${MAP_SIZES[L.size ?? 'small'].label} · ${mode} · ${count('player')} gold, ${count('enemy')} enemy, ${count('neutral')} neutral · ${L.walls.length} walls, ${L.fans.length} fans`
    const nameEl = h('div.name', {}, L.name)
    const meta = h('div.meta', {},
      nameEl,
      h('div.cc-note', {}, details),
      h('div.cc-note', {}, `Saved ${new Date(m.updated).toLocaleString()}`),
      problems.length ? h('div.cc-msg.err', { style: 'margin-top:2px;min-height:0' }, problems[0]) : null,
    )

    const rename = (): void => {
      const input = h('input.cc-in', { value: L.name, maxLength: 40 })
      const done = (): void => {
        if (input.value.trim()) renameMap(L.id, input.value)
        this.renderList()
      }
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done()
        if (e.key === 'Escape') this.renderList()
      })
      input.addEventListener('blur', done)
      nameEl.replaceWith(input)
      input.focus()
      input.select()
    }
    const share = (): void => {
      const code = encodeShare(L)
      this.code.value = code
      this.code.select()
      navigator.clipboard?.writeText(code).then(
        () => this.say(`Share code for "${L.name}" copied.`),
        () => this.say(`Share code for "${L.name}" is in the box above.`),
      )
    }
    const download = (): void => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([mapToJson(L) + '\n'], { type: 'application/json' }))
      a.download = `${L.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map'}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
    const del = h('button.cc-btn.danger', { onclick: () => {
      if (this.confirmDelete === L.id) {
        deleteMap(L.id)
        this.confirmDelete = null
        this.say(`Deleted "${L.name}".`)
        this.renderList()
      } else {
        this.confirmDelete = L.id
        del.textContent = 'Really delete?'
      }
    } }, 'Delete')

    return h('div.cc-item', {},
      thumb,
      meta,
      h('div', { style: 'display:grid;grid-template-columns:repeat(3,auto);gap:5px' },
        h('button.cc-btn.primary', { disabled: problems.length > 0, onclick: () => this.scene.start('battle', { custom: L, from: 'maps' }) }, '▶ Play'),
        h('button.cc-btn', { onclick: () => this.scene.start('editor', { mapId: L.id }) }, 'Edit'),
        h('button.cc-btn', { onclick: rename }, 'Rename'),
        h('button.cc-btn', { onclick: share }, 'Share'),
        h('button.cc-btn', { onclick: download }, '.json'),
        del,
      ),
    )
  }
}
