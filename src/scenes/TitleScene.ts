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
import { discord } from '../platform/runtime'
import { isRoomCode, normaliseCode } from '../net/online'
import { createRoom, online, saveName, savedName, type OnlineRoom } from '../net/onlineClient'
import type { OnlineMenu } from '../menu/onlineMenu'
import { DemoWatch, keepDemoRunning, type DemoScenes } from './demoWatch'

let launchedFromUrl = false
let joinedFromUrl = false

/** Keep ?room=CODE in the address while in a room (a reload rejoins), drop it after. */
function setRoomParam(code: string | null): void {
  const url = new URL(location.href)
  if (code) url.searchParams.set('room', code)
  else url.searchParams.delete('room')
  history.replaceState(history.state, '', url)
}

export interface TitleData {
  /** Open this menu screen (coming back from a battle started from it). */
  screen?: MenuScreen
}

/** Title screen and main menu: the HTML menu (menu/mainMenu.ts) over a background battle (TitleBgScene). */
export class TitleScene extends Phaser.Scene {
  menu: MainMenu | null = null
  private leaving = false
  private demo: DemoWatch | null = null

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
    // The demo battle behind the menu: start it (or wake it), and keep it going (alt-tab, tab switches).
    const scenes: DemoScenes = {
      status: (key) => this.scene.get(key)?.sys.settings.status,
      wake: (key) => this.scene.wake(key),
      resume: (key) => this.scene.resume(key),
      launch: (key) => this.scene.launch(key),
    }
    keepDemoRunning(scenes, 'titlebg')
    this.scene.sendToBack('titlebg')
    const demo = new DemoWatch(scenes, 'titlebg')
    this.demo = demo
    const back = (): void => void demo.now()
    this.game.events.on(Phaser.Core.Events.VISIBLE, back)
    this.game.events.on(Phaser.Core.Events.FOCUS, back)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.VISIBLE, back)
      this.game.events.off(Phaser.Core.Events.FOCUS, back)
      this.demo = null
    })

    const go = (key: string, payload?: object): void => {
      if (this.leaving) return
      this.leaving = true
      this.scene.start(key, payload)
    }
    // Online play with friends (not inside Discord yet: its frame only reaches allow-listed hosts).
    let onlineMenu: OnlineMenu | undefined
    let screen: MenuScreen = data?.screen ?? 'home'
    if (!discord.inDiscord) {
      const toMatch = (room: OnlineRoom): void => {
        if (!room.start || room.info?.phase !== 'playing') return
        go('battle', { pvp: { role: 'online', room: room.code, transport: room, start: room.start } })
      }
      const watch = (room: OnlineRoom): void => {
        setRoomParam(room.code)
        const off = room.onChange(() => {
          if (room.closed) setRoomParam(null)
          // A match started (or is running and this screen hasn't shown it yet): go to it.
          if (room.start && room.info?.phase === 'playing' && room.entered !== room.start.match) toMatch(room)
        })
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, off)
      }
      onlineMenu = {
        room: () => online.room,
        name: () => savedName(),
        setName: (name) => {
          saveName(name)
          if (online.room && online.room.name !== name) online.room.setName(name)
        },
        create: async (name) => {
          const code = await createRoom()
          const room = online.join(code, name)
          watch(room)
          return room
        },
        join: (code, name) => {
          const room = online.join(code, name)
          watch(room)
          return room
        },
        leave: () => {
          online.room?.leave()
          setRoomParam(null)
        },
        inviteLink: (code) => {
          const url = new URL(location.href)
          url.search = ''
          url.hash = ''
          url.searchParams.set('room', code)
          return url.toString()
        },
        toMatch: () => online.room && toMatch(online.room),
      }
      // ?room=CODE (an invite link): join it once per page load.
      const code = normaliseCode(new URLSearchParams(location.search).get('room') ?? '')
      if (!joinedFromUrl && isRoomCode(code)) {
        joinedFromUrl = true
        onlineMenu.join(code, savedName())
        screen = 'lobby'
      } else if (online.room && !online.room.closed) watch(online.room)
      joinedFromUrl = true
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
        online: onlineMenu,
      },
      screen,
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

  update(_time: number, delta: number): void {
    this.demo?.tick(delta)
  }
}
