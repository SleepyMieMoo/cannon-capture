import Phaser from 'phaser'
import { theme } from './config/theme'
import { DEBUG } from './debug'
import { perf } from './perf/PerfOverlay'
import { discord } from './platform/runtime'
import { canvasSize, renderScale, watchRenderScale } from './render/resolution'
import { BattleScene } from './scenes/BattleScene'
import { EditorScene } from './scenes/EditorScene'
import { MapsScene } from './scenes/MapsScene'
import { MapScene } from './scenes/MapScene'
import { TitleBgScene } from './scenes/TitleBgScene'
import { TitleScene } from './scenes/TitleScene'
import { mountPvpPanel, mountSplitView } from './net/pvpDev'
import { music } from './audio/music'
import { applyMotion } from './ui/motion'
import { injectMotionStyles } from './ui/motionStyles'

// ?pvpdev=split shows two copies of the game side by side instead (player vs player test mode).
const split = mountSplitView()
const parent = document.getElementById('app')
if (!split) {
  if (!parent) throw new Error('Missing #app mount point')
  boot(parent)
}

function boot(parent: HTMLElement): void {
  document.body.style.background = theme.bgCss
  // Reduce motion (Settings, or the device's own setting): marks <html> before anything animates.
  applyMotion()
  injectMotionStyles()

  // Discord Activity (src/platform/discord.ts): mark the page so CSS can respect Discord's
  // mobile safe areas, send external links through the Discord client, and start the SDK
  // handshake in the background. The game never waits for it; a normal tab skips all of this.
  if (discord.inDiscord) {
    document.documentElement.classList.add('in-discord')
    discord.interceptLinks(document)
    void discord.start()
  }
  if (DEBUG.enabled || discord.inDiscord) (window as unknown as { __discord: typeof discord }).__discord = discord

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
    // Web Audio for the sound effects (src/audio); browsers unlock it on the first click, tap or key.
    audio: { disableWebAudio: false },
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
    scene: [TitleScene, TitleBgScene, MapScene, BattleScene, EditorScene, MapsScene],
  })

  watchRenderScale(game, parent)
  // Performance overlay (Settings, F3 or backtick, or ?perf): costs nothing until shown.
  perf.attach(game)
  if (DEBUG.enabled) (window as unknown as { __perf: typeof perf }).__perf = perf
  // ?pvpdev: the player vs player test panel.
  mountPvpPanel(game)
  // The jukebox (src/audio/music.ts): one player for the whole game, so songs carry on
  // between scenes. It downloads the song only once the page is idle (after the first
  // menu paint) and starts on the first click, tap or key if the browser blocks autoplay.
  game.events.once(Phaser.Core.Events.READY, () => music.bootLater())
  if (DEBUG.enabled) (window as unknown as { __music: typeof music }).__music = music
}
