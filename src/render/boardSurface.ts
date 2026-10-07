import Phaser from 'phaser'
import { theme } from '../config/theme'
import type { Rect } from '../types'

const DOT_KEY = 'board-grid-dot'

/**
 * The board: rounded panel plus the faint dot grid. The grid is one tiled
 * texture (a single quad), so even a Huge board costs nothing per frame.
 */
export function drawBoardSurface(scene: Phaser.Scene, board: Rect): Phaser.GameObjects.GameObject[] {
  const g = scene.add.graphics().setDepth(0)
  g.fillStyle(theme.board, 1)
  g.fillRoundedRect(board.x, board.y, board.w, board.h, 18)
  g.lineStyle(2, theme.boardEdge, 1)
  g.strokeRoundedRect(board.x, board.y, board.w, board.h, 18)

  if (!scene.textures.exists(DOT_KEY)) {
    const dot = scene.make.graphics({ x: 0, y: 0 }, false)
    dot.fillStyle(theme.grid, 1)
    // Drawn at 4x so the dot stays round when the camera zooms in.
    dot.fillCircle(64, 64, 1.6 * 4)
    dot.generateTexture(DOT_KEY, 128, 128)
    dot.destroy()
  }
  // Dots sit at board.x + 36 + 32i, board.y + 28 + 32j, like the original grid.
  const tiles = scene.add
    .tileSprite(board.x + 20, board.y + 12, board.w - 36, board.h - 28, DOT_KEY)
    .setOrigin(0, 0)
    .setTileScale(0.25, 0.25)
    .setDepth(0)
  return [g, tiles]
}
