import Phaser from 'phaser'
import { theme } from './config/theme'
import { canvasSize, renderScale, watchRenderScale } from './render/resolution'
import { BattleScene } from './scenes/BattleScene'
import { MapScene } from './scenes/MapScene'
import { TitleScene } from './scenes/TitleScene'

const parent = document.getElementById('app')
if (!parent) throw new Error('Missing #app mount point')

document.body.style.background = theme.bgCss

// The canvas matches the on-screen size x devicePixelRatio (see render/resolution.ts);
// the world is still laid out at GAME_WIDTH x GAME_HEIGHT.
const { width, height } = canvasSize(renderScale(parent))

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent,
  width,
  height,
  backgroundColor: theme.bg,
  banner: false,
  audio: { noAudio: true },
  render: {
    antialias: true,
    antialiasGL: true,
    pixelArt: false,
    roundPixels: false,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width,
    height,
  },
  scene: [TitleScene, MapScene, BattleScene],
})

watchRenderScale(game, parent)
