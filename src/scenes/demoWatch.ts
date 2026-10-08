/**
 * Keeps the title screen's demo battle (TitleBgScene) running under the menu.
 *
 * Why this exists: the demo used to put itself to sleep when the tab was
 * hidden and wake on return. Phaser's scene.sleep()/wake() are queued and
 * only carried out on the next frame, and a hidden tab gets no frames. So on
 * return the "wake" check still saw a running scene (the sleep was only
 * queued), did nothing, and the first frame back then carried out the sleep:
 * the demo stayed asleep for good. Nothing needs to stop the demo (a hidden
 * tab runs no frames, so the round already waits), and this watch revives the
 * demo whatever stopped it.
 *
 * No Phaser import: the tests run in Node.
 */

/** Phaser.Scenes status numbers (Phaser.Scenes.PENDING ... DESTROYED). */
export const SCENE_STATUS = {
  PENDING: 0,
  INIT: 1,
  START: 2,
  LOADING: 3,
  CREATING: 4,
  RUNNING: 5,
  PAUSED: 6,
  SLEEPING: 7,
  SHUTDOWN: 8,
  DESTROYED: 9,
} as const

export type DemoFix = 'ok' | 'starting' | 'wake' | 'resume' | 'launch'

/** What the demo scene needs, given its status (undefined: not added). */
export function demoFix(status: number | undefined): DemoFix {
  if (status === SCENE_STATUS.RUNNING) return 'ok'
  if (status === SCENE_STATUS.SLEEPING) return 'wake'
  if (status === SCENE_STATUS.PAUSED) return 'resume'
  // INIT: added but never started (or not since it was stopped).
  if (status !== undefined && status >= SCENE_STATUS.START && status <= SCENE_STATUS.CREATING) return 'starting'
  return 'launch'
}

/** The bits of Phaser's scene plugin the watch uses. */
export interface DemoScenes {
  status(key: string): number | undefined
  wake(key: string): void
  resume(key: string): void
  launch(key: string): void
}

/**
 * Bring the demo back if it isn't running. A restart (stop + start, between
 * demo rounds) can show "shut down" for a moment, so a missing demo is only
 * launched when `sure` (seen twice in a row, or on screen entry).
 */
export function keepDemoRunning(scenes: DemoScenes, key: string, sure = true): DemoFix {
  const fix = demoFix(scenes.status(key))
  if (fix === 'wake') scenes.wake(key)
  else if (fix === 'resume') scenes.resume(key)
  else if (fix === 'launch' && sure) scenes.launch(key)
  return fix
}

/** Checks per second while the title screen shows; cheap (one status read). */
export const DEMO_CHECK_MS = 500

/** Calls keepDemoRunning every DEMO_CHECK_MS of frame time, launching only after two misses. */
export class DemoWatch {
  private since = 0
  private missed = false

  constructor(
    private readonly scenes: DemoScenes,
    private readonly key: string,
  ) {}

  /** On return to the tab or window: check now. */
  now(): DemoFix {
    this.since = 0
    return this.check()
  }

  tick(deltaMs: number): DemoFix | null {
    this.since += deltaMs
    if (this.since < DEMO_CHECK_MS) return null
    this.since = 0
    return this.check()
  }

  private check(): DemoFix {
    const fix = keepDemoRunning(this.scenes, this.key, this.missed)
    this.missed = fix === 'launch'
    return fix
  }
}
