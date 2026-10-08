import Phaser from 'phaser'
import { SFX, type PopKind } from '../config/sfx'
import type { Cannon } from '../entities/Cannon'
import type { Rect } from '../types'
import { loadAudioSettings, saveAudioSettings, type AudioSettings } from './audioSettings'
import { PopPlanner, type PopPlan } from './popPlanner'

/** Queue the pop sample for loading (once per game). */
export function preloadSfx(scene: Phaser.Scene): void {
  if (scene.cache.audio.exists(SFX.key)) return
  // Relative to the page, so it works under the GitHub Pages base path too.
  scene.load.audio(SFX.key, [...SFX.files])
}

/**
 * Set the game's master volume from the saved settings (mute = volume 0).
 * The gain is set from "now" with older automation dropped, so the newest
 * value always wins (Phaser schedules its own volume/mute changes at time 0,
 * which can leave an older value in effect).
 */
export function applyAudioSettings(sm: Phaser.Sound.BaseSoundManager, s: AudioSettings): void {
  const v = s.muted ? 0 : s.volume
  if (sm instanceof Phaser.Sound.WebAudioSoundManager) {
    const gain = sm.masterVolumeNode.gain
    gain.cancelScheduledValues(0)
    gain.setValueAtTime(v, sm.context.currentTime)
    const mute = sm.masterMuteNode.gain
    mute.cancelScheduledValues(0)
    mute.setValueAtTime(1, sm.context.currentTime)
  } else {
    sm.volume = v
    sm.mute = false
  }
}

/** Play one Normal pop at the current settings (the Settings screen's preview). */
export function previewPop(scene: Phaser.Scene): void {
  const sm = scene.sound
  if (sm instanceof Phaser.Sound.NoAudioSoundManager || sm.locked || !scene.cache.audio.exists(SFX.key)) return
  sm.play(SFX.key, { volume: SFX.shot.normal.volume, rate: SFX.shot.normal.rate })
}

/** What happened to the last few requests (debug, see window.__cc.sfx). */
export interface SfxLogEntry extends Partial<PopPlan> {
  kind: PopKind
  side: string
  /** played | skipped | muted | locked | no-audio */
  result: string
}

/**
 * The battle's sound effects: one short pop, played with per-type loudness
 * and pitch (config/sfx.ts), a voice cap and rate limits (PopPlanner), and
 * quieter for the other sides and off-screen. Uses the game's Web Audio
 * sound manager; browsers keep it locked until the first click, tap or key,
 * and pops asked for before that are skipped (not saved up).
 */
export class Sfx {
  readonly planner = new PopPlanner()
  readonly log: SfxLogEntry[] = []
  private readonly playing = new Map<number, Phaser.Sound.BaseSound>()
  settings: AudioSettings = loadAudioSettings()

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly view: () => { rect: Rect; zoom: number },
  ) {
    this.apply()
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.stopAll())
  }

  /** Pops playing right now (performance overlay). */
  get voices(): number {
    return this.playing.size
  }

  get available(): boolean {
    const sm = this.scene.sound
    return !(sm instanceof Phaser.Sound.NoAudioSoundManager) && this.scene.cache.audio.exists(SFX.key)
  }

  setVolume(volume: number): void {
    this.settings.volume = Math.max(0, Math.min(1, volume))
    if (this.settings.volume > 0) this.settings.muted = false
    this.apply()
    saveAudioSettings(this.settings)
  }

  toggleMute(): void {
    this.settings.muted = !this.settings.muted
    if (!this.settings.muted && this.settings.volume <= 0) this.settings.volume = SFX.defaultVolume
    this.apply()
    saveAudioSettings(this.settings)
  }

  shot(c: Cannon): void {
    if (c.kind === 'shield') return
    this.pop(c.kind, c, c.id)
  }

  captured(c: Cannon): void {
    this.pop('capture', c)
  }

  shieldBroken(c: Cannon): void {
    this.pop('shieldBreak', c, c.id + ':shield')
  }

  stopAll(): void {
    for (const s of this.playing.values()) s.destroy()
    this.playing.clear()
  }

  /** The master gain actually applied (0 when muted). */
  get effectiveVolume(): number {
    return this.settings.muted ? 0 : this.settings.volume
  }

  private apply(): void {
    applyAudioSettings(this.scene.sound, this.settings)
  }

  private pop(kind: PopKind, c: Cannon, source?: string): void {
    const note = (result: string, plan?: PopPlan | null) => {
      this.log.push({ kind, side: c.side, result, ...(plan ?? {}) })
      if (this.log.length > 60) this.log.splice(0, this.log.length - 60)
    }
    if (this.settings.muted || this.settings.volume <= 0) return note('muted')
    if (!this.available) return note('no-audio')
    if (this.scene.sound.locked) return note('locked')
    const { rect, zoom } = this.view()
    const plan = this.planner.plan({ kind, source, side: c.side, x: c.x, y: c.y, now: this.scene.time.now, view: rect, zoom })
    if (!plan) return note('skipped')
    if (plan.steal !== null) {
      this.playing.get(plan.steal)?.destroy()
      this.playing.delete(plan.steal)
    }
    const sound = this.scene.sound.add(SFX.key)
    const id = plan.id
    sound.once(Phaser.Sound.Events.COMPLETE, () => {
      this.playing.delete(id)
      this.planner.release(id)
      sound.destroy()
    })
    this.playing.set(id, sound)
    sound.play({ volume: plan.volume, rate: plan.rate, detune: plan.detune, pan: plan.pan })
    note('played', plan)
  }
}
