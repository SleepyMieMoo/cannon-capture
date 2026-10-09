import { fxLabel } from '../render/vfx/fxPrefs'
import { badgeCount, loadBadges } from '../menu/badges'
import { perf } from './PerfOverlay'
import { loadAudioSettings } from '../audio/audioSettings'
import { loadMotionPref, motionOK } from '../ui/motion'
import { loadMenuPrefs } from '../menu/menuModel'
import { loadSkin } from '../menu/skinPref'
import { loadColour } from '../menu/colourPref'
import { settingsText } from '../menu/debugInfo'
import { debugReport } from './debugEnv'
import { music } from '../audio/music'
import { loadTabPrefs } from '../menu/tabPrefs'
import type Phaser from 'phaser'

/** "Copy debug info" from anywhere (main menu or a battle's Settings): this device's settings right now. */
export function debugNow(game: Phaser.Game): string {
  const audio = loadAudioSettings()
  return debugReport(
    game,
    settingsText({
      sound: !audio.muted,
      volume: audio.volume,
      perf: perf.shown,
      skin: loadSkin(),
      colour: loadColour(),
      difficulty: loadMenuPrefs().difficulty,
      music: { on: music.playing, volume: music.settings.volume, track: music.current, default: music.settings.track, pulse: music.settings.pulse },
      tabbed: { music: music.settings.keepHidden, pauseVsAi: loadTabPrefs().pauseVsAi },
      motion: { pref: loadMotionPref(), reduced: !motionOK() },
      effects: fxLabel(),
      badges: badgeCount(loadBadges()),
    }),
  )
}
