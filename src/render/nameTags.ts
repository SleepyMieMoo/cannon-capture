import type Phaser from 'phaser'
import { theme } from '../config/theme'
import { TUNING } from '../config/tuning'
import { haloR, trackR, type Cannon } from '../entities/Cannon'
import type { CannonKind, Side } from '../types'

/**
 * Name tags: the owner's name on every owned cannon, for online matches where
 * the two players' looks clash (config/looks.ts). White on your own cannons,
 * red on the other player's (watchers: white on the gold seat's, red on the
 * pink seat's, the same as the rings they see). Neutrals get none. A tag
 * follows the owner, so it flips on capture with the ring.
 *
 * It sits above the cannon, or below while the barrel points upward, clear
 * of the barrel, rings, capture ring, shield barrier and its health bar. One
 * Text object per cannon, made once; a frame only moves or recolours one
 * when something changed.
 */
export const TAG = {
  /** Wanted height of the letters on screen (CSS px), within the world-px limits below. */
  cssPx: 11,
  minWorld: 14,
  maxWorld: 32,
  /** The font size the text is rendered at (then scaled). */
  fontPx: 28,
  /** Go below once the barrel points this far above level (sin of 15°)... */
  upEnter: Math.sin((15 * Math.PI) / 180),
  /** ...and back above once it points level or lower: the gap is the hysteresis. */
  upLeave: 0,
  colour: { player: '#ffffff', enemy: '#ff5f5f' } as Record<'player' | 'enemy', string>,
}

/** Whether a tag sits below its cannon, given where it was and the barrel angle (radians, y down). */
export function tagBelow(below: boolean, angle: number): boolean {
  const up = -Math.sin(angle)
  if (!below && up > TAG.upEnter) return true
  if (below && up < TAG.upLeave) return false
  return below
}

/**
 * Distance from the cannon's centre to the tag's near edge (world px):
 * past the selection halo (which is past the rings and capture track); for a
 * shield, past the barrier and the barrier's health bar too. A barrel never
 * reaches it: the tag is on the side the barrel isn't pointing to (within
 * the 15° band, where a sniper's tip is still far below the tag).
 */
export function tagClearance(kind: CannonKind): number {
  const halo = haloR() + 3
  if (kind !== 'shield') return halo
  const s = TUNING.shield
  return Math.max(halo, s.reach + s.thickness / 2 + 3, trackR() + 13)
}

interface Tag {
  cannon: Cannon
  text: Phaser.GameObjects.Text
  side: Side | null
  kind: CannonKind | null
  below: boolean
}

export class NameTags {
  private readonly tags: Tag[] = []
  private names: Record<'player' | 'enemy', string> = { player: '', enemy: '' }
  private worldPx = 0
  private on = false
  private dirty = true

  constructor(scene: Phaser.Scene, cannons: readonly Cannon[], place: (t: Phaser.GameObjects.Text) => void) {
    for (const cannon of cannons) {
      const text = scene.add
        .text(cannon.x, cannon.y, '', {
          fontFamily: theme.font,
          fontSize: `${TAG.fontPx}px`,
          fontStyle: 'bold',
          color: TAG.colour.player,
          stroke: '#120a06',
          strokeThickness: 6,
          backgroundColor: 'rgba(18,10,6,0.62)',
          padding: { x: 7, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(8)
        .setVisible(false)
      place(text)
      this.tags.push({ cannon, text, side: null, kind: null, below: false })
    }
  }

  get shown(): boolean {
    return this.on
  }

  /** Turn the tags on or off (they show only while the looks clash). */
  setEnabled(on: boolean): void {
    if (on === this.on) return
    this.on = on
    this.dirty = true
    if (!on) for (let i = 0; i < this.tags.length; i++) this.tags[i].text.setVisible(false)
  }

  /** The owners' names in this view's sides ('player' is you; watchers: the gold seat). */
  setNames(player: string, enemy: string): void {
    if (player === this.names.player && enemy === this.names.enemy) return
    this.names = { player, enemy }
    this.dirty = true
  }

  /** Once a frame: follow owners, barrels and the zoom. */
  update(cssPerWorld: number): void {
    if (!this.on) return
    const px = Math.min(TAG.maxWorld, Math.max(TAG.minWorld, Math.round(TAG.cssPx / Math.max(cssPerWorld, 1e-3))))
    const rescale = px !== this.worldPx || this.dirty
    this.worldPx = px
    const scale = px / TAG.fontPx
    for (let i = 0; i < this.tags.length; i++) {
      const t = this.tags[i]
      const c = t.cannon
      let move = rescale
      if (c.side !== t.side || this.dirty) {
        t.side = c.side
        if (c.side === 'neutral') t.text.setVisible(false)
        else {
          t.text.setText(this.names[c.side]).setColor(TAG.colour[c.side]).setVisible(true)
          move = true
        }
      }
      if (c.side === 'neutral') continue
      const below = tagBelow(t.below, c.angle)
      if (below !== t.below || c.kind !== t.kind) move = true
      if (!move) continue
      t.below = below
      t.kind = c.kind
      t.text.setScale(scale)
      const off = tagClearance(c.kind) + t.text.displayHeight / 2
      t.text.setPosition(c.x, c.y + (below ? off : -off))
    }
    this.dirty = false
  }

  destroy(): void {
    for (const t of this.tags) t.text.destroy()
    this.tags.length = 0
  }
}
