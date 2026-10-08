import { describe, expect, it } from 'vitest'
import titleBgSource from '../src/scenes/TitleBgScene.ts?raw'
import { DEMO_CHECK_MS, DemoWatch, SCENE_STATUS, demoFix, keepDemoRunning, type DemoScenes } from '../src/scenes/demoWatch'

/**
 * A tiny stand-in for Phaser's scene manager with the part that caused the
 * alt-tab bug: sleep/wake/launch from a scene are queued and only carried out
 * on the next frame (and a hidden tab gets no frames).
 */
class FakeScenes implements DemoScenes {
  st = new Map<string, number>([['titlebg', SCENE_STATUS.RUNNING]])
  queue: Array<[string, string]> = []
  launches = 0
  status(key: string): number | undefined {
    return this.st.get(key)
  }
  sleep(key: string): void {
    this.queue.push(['sleep', key])
  }
  wake(key: string): void {
    this.queue.push(['wake', key])
  }
  resume(key: string): void {
    this.queue.push(['resume', key])
  }
  launch(key: string): void {
    this.queue.push(['launch', key])
  }
  /** One frame: carry out the queued operations, like Phaser's processQueue. */
  frame(): void {
    for (const [op, key] of this.queue.splice(0)) {
      const s = this.st.get(key)
      if (op === 'sleep' && s === SCENE_STATUS.RUNNING) this.st.set(key, SCENE_STATUS.SLEEPING)
      if (op === 'wake' || op === 'resume') this.st.set(key, SCENE_STATUS.RUNNING)
      if (op === 'launch') {
        this.launches++
        this.st.set(key, SCENE_STATUS.RUNNING)
      }
    }
  }
}

describe('title demo across alt-tab', () => {
  it('the old sleep-on-hide / wake-on-show left the demo asleep (the bug), and the watch brings it back', () => {
    const scenes = new FakeScenes()
    const running = () => scenes.status('titlebg') === SCENE_STATUS.RUNNING
    // Old handlers: HIDDEN -> sleep if running; VISIBLE -> wake if sleeping. No frames in between.
    scenes.sleep('titlebg')
    if (scenes.status('titlebg') === SCENE_STATUS.SLEEPING) scenes.wake('titlebg') // still RUNNING: skipped
    scenes.frame() // first frame back carries out the queued sleep
    expect(running()).toBe(false)
    for (let i = 0; i < 100; i++) scenes.frame()
    expect(running()).toBe(false) // nothing ever woke it: the empty background Nova saw

    // The watch: on VISIBLE/FOCUS and every DEMO_CHECK_MS.
    const watch = new DemoWatch(scenes, 'titlebg')
    expect(watch.now()).toBe('wake')
    scenes.frame()
    expect(running()).toBe(true)
  })

  it('without the sleep, hiding and showing leaves the demo running, and the periodic check finds nothing to do', () => {
    const scenes = new FakeScenes()
    const watch = new DemoWatch(scenes, 'titlebg')
    // Hidden: no frames. Visible again: VISIBLE then FOCUS, then frames.
    expect(watch.now()).toBe('ok')
    expect(watch.now()).toBe('ok')
    for (let f = 0; f < 120; f++) {
      scenes.frame()
      const r = watch.tick(1000 / 60)
      if (r) expect(r).toBe('ok')
    }
    expect(scenes.queue).toEqual([])
    expect(scenes.status('titlebg')).toBe(SCENE_STATUS.RUNNING)
  })

  it('the periodic check revives a sleeping or paused demo, and relaunches a stopped one only when it stays stopped', () => {
    const scenes = new FakeScenes()
    const watch = new DemoWatch(scenes, 'titlebg')
    scenes.st.set('titlebg', SCENE_STATUS.PAUSED)
    expect(watch.tick(DEMO_CHECK_MS - 1)).toBeNull()
    expect(watch.tick(1)).toBe('resume')
    scenes.frame()
    expect(scenes.status('titlebg')).toBe(SCENE_STATUS.RUNNING)
    // Between demo rounds (restart = stop + start) it may look stopped once: no launch yet.
    scenes.st.set('titlebg', SCENE_STATUS.SHUTDOWN)
    expect(watch.tick(DEMO_CHECK_MS)).toBe('launch')
    expect(scenes.queue).toEqual([])
    scenes.st.set('titlebg', SCENE_STATUS.RUNNING)
    expect(watch.tick(DEMO_CHECK_MS)).toBe('ok')
    // Stopped twice in a row: launched.
    scenes.st.set('titlebg', SCENE_STATUS.SHUTDOWN)
    watch.tick(DEMO_CHECK_MS)
    watch.tick(DEMO_CHECK_MS)
    scenes.frame()
    expect(scenes.launches).toBe(1)
    expect(scenes.status('titlebg')).toBe(SCENE_STATUS.RUNNING)
  })

  it('maps every scene status to what the demo needs', () => {
    expect(demoFix(SCENE_STATUS.RUNNING)).toBe('ok')
    expect(demoFix(SCENE_STATUS.SLEEPING)).toBe('wake')
    expect(demoFix(SCENE_STATUS.PAUSED)).toBe('resume')
    expect(demoFix(SCENE_STATUS.CREATING)).toBe('starting')
    expect(demoFix(SCENE_STATUS.LOADING)).toBe('starting')
    expect(demoFix(SCENE_STATUS.INIT)).toBe('launch') // added at boot, never started
    expect(demoFix(SCENE_STATUS.PENDING)).toBe('launch')
    expect(demoFix(SCENE_STATUS.SHUTDOWN)).toBe('launch')
    expect(demoFix(SCENE_STATUS.DESTROYED)).toBe('launch')
    expect(demoFix(undefined)).toBe('launch')
    // Entering the title screen with the demo asleep wakes it rather than starting a second copy.
    const scenes = new FakeScenes()
    scenes.st.set('titlebg', SCENE_STATUS.SLEEPING)
    expect(keepDemoRunning(scenes, 'titlebg')).toBe('wake')
    scenes.frame()
    expect(scenes.launches).toBe(0)
  })

  it('the demo scene no longer puts itself to sleep when the tab hides', () => {
    const src = titleBgSource
    expect(src).not.toMatch(/scene\.sleep\(/)
    expect(src).not.toMatch(/Events\.HIDDEN/)
  })
})
