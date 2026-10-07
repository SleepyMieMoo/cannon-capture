import Phaser from 'phaser'
import { GAME_HEIGHT, GAME_WIDTH } from './config/layout'
import { theme } from './config/theme'
import { BattleScene } from './scenes/BattleScene'

const parent = document.getElementById('app')
if (!parent) throw new Error('Missing #app mount point')

document.body.style.background = theme.bgCss

new Phaser.Game({
  type: Phaser.AUTO,
  parent,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: theme.bg,
  banner: false,
  audio: { noAudio: true },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  scene: [BattleScene],
})
