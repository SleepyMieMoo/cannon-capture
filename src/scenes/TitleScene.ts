import Phaser from 'phaser'
import { perf } from '../perf/PerfOverlay'
import { applyAudioSettings, preloadSfx, previewPop } from '../audio/Sfx'
import { loadAudioSettings, saveAudioSettings, type AudioSettings } from '../audio/audioSettings'
import { BRAND } from '../config/brand'
import { DEBUG } from '../debug'
import { findLevel } from '../levels'
import { MainMenu } from '../menu/mainMenu'
import type { MenuScreen } from '../menu/routes'
import { bindSceneResolution } from '../render/resolution'

let launchedFromUrl = false

export interface TitleData {
  /** Open this menu screen (coming back from a battle started from it). */
  screen?: MenuScreen
}

/** Title screen and main menu: the HTML menu (menu/mainMenu.ts) over a background battle (TitleBgScene). */
export class TitleScene extends Phaser.Scene {
  menu: MainMenu | null = null
  private leaving = false

  constructor() {
    super('title')
  }

  preload(): void {
    preloadSfx(this)
  }

  create(data: TitleData): void {
    // ?level=<id> jumps straight into a level once per page load.
    if (!launchedFromUrl && DEBUG.level && findLevel(DEBUG.level)) {
      launchedFromUrl = true
      this.scene.start('battle', { levelId: DEBUG.level })
      return
    }
    launchedFromUrl = true
    this.leaving = false
    document.title = BRAND.title
    bindSceneResolution(this)
    applyAudioSettings(this.sound, loadAudioSettings())
    if (!this.scene.isActive('titlebg')) this.scene.launch('titlebg')
    this.scene.sendToBack('titlebg')

    const go = (key: string, payload?: object): void => {
      if (this.leaving) return
      this.leaving = true
      this.scene.start(key, payload)
    }
    this.menu = new MainMenu(
      {
        playVsAi: (level) => go('battle', { custom: level, from: 'menu' }),
        playPuzzle: (p) => go('battle', p.custom ? { custom: p.level, from: 'puzzles' } : { levelId: p.id, from: 'puzzles' }),
        levels: () => go('map'),
        editor: () => go('editor'),
        myMaps: () => go('maps'),
        getAudio: () => loadAudioSettings(),
        setAudio: (s: AudioSettings) => {
          saveAudioSettings(s)
          applyAudioSettings(this.sound, s)
        },
        previewSound: () => previewPop(this),
        perf: { get: () => perf.shown, set: (on) => perf.setShown(on), onChange: (fn) => perf.onChange(fn) },
      },
      data?.screen ?? 'home',
    )
    // Phaser keeps a scene's last start data when it is started again without
    // any (Back from Levels or My maps): clear it so those land on the home screen.
    this.sys.settings.data = {}
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.menu?.destroy()
      this.menu = null
      this.scene.stop('titlebg')
    })
    if (DEBUG.enabled) (window as unknown as { __menu?: unknown }).__menu = this
  }
}
