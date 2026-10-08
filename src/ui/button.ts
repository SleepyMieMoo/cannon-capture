import Phaser from 'phaser'
import { theme } from '../config/theme'

export interface ButtonOpts {
  width?: number
  height?: number
  primary?: boolean
  fontSize?: number
}

/** Rounded ChocoNeko-style button. Primary is gold; secondary is outlined. */
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  opts: ButtonOpts = {},
): Phaser.GameObjects.Container {
  const w = opts.width ?? 200
  const h = opts.height ?? 48
  const primary = opts.primary ?? true
  const g = scene.add.graphics()
  const text = scene.add
    .text(0, 0, label, {
      fontFamily: theme.font,
      fontSize: `${opts.fontSize ?? 18}px`,
      fontStyle: 'bold',
      color: primary ? theme.ink : theme.text,
    })
    .setOrigin(0.5)
  // A label never spills past the edge: a long one is drawn smaller to fit.
  const room = w - 20
  if (text.width > room) text.setScale(room / text.width)

  const draw = (hot: boolean): void => {
    g.clear()
    if (primary) {
      g.fillStyle(hot ? theme.playerHot : theme.player, 1)
      g.fillRoundedRect(-w / 2, -h / 2, w, h, 12)
    } else {
      g.fillStyle(hot ? theme.grid : theme.board, 1)
      g.fillRoundedRect(-w / 2, -h / 2, w, h, 12)
      g.lineStyle(2, hot ? theme.player : theme.boardEdge, 1)
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, 12)
    }
  }
  draw(false)

  const button = scene.add.container(x, y, [g, text]).setSize(w, h)
  button.setInteractive({ useHandCursor: true })
  button.on('pointerover', () => draw(true))
  button.on('pointerout', () => draw(false))
  button.on(
    'pointerdown',
    (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event?.stopPropagation()
      onClick()
    },
  )
  return button
}

/** Five-point star, used for level ratings. */
export function drawStar(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  r: number,
  filled: boolean,
): void {
  const points: Phaser.Math.Vector2[] = []
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    points.push(new Phaser.Math.Vector2(x + Math.cos(a) * radius, y + Math.sin(a) * radius))
  }
  g.fillStyle(filled ? theme.player : theme.grid, 1)
  g.fillPoints(points, true)
  g.lineStyle(1.5, filled ? theme.playerHot : theme.boardEdge, 1)
  g.strokePoints(points, true)
}
