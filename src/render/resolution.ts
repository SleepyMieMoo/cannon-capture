import Phaser from 'phaser'
import { GAME_HEIGHT, GAME_WIDTH } from '../config/layout'

/**
 * Crisp rendering at any size.
 *
 * The game is laid out in a fixed 1200x720 world, but the canvas itself is
 * sized to what is actually on screen (fit size x devicePixelRatio), and the
 * camera zooms the world up to fill it. Scale.FIT then only has to shrink the
 * canvas back to CSS pixels, so nothing is ever stretched up and blurred.
 */

/** Higher-DPI screens are capped here to keep the GPU cost sensible. */
const MAX_DPR = 2
/** Hard cap on world-to-canvas scale (3x = 3600x2160 canvas). */
const MAX_SCALE = 3
const MIN_SCALE = 0.25

export function renderScale(parent: HTMLElement): number {
  const width = parent.clientWidth || window.innerWidth
  const height = parent.clientHeight || window.innerHeight
  const fit = Math.min(width / GAME_WIDTH, height / GAME_HEIGHT)
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
  return Phaser.Math.Clamp(fit * dpr, MIN_SCALE, MAX_SCALE)
}

export function canvasSize(scale: number): { width: number; height: number } {
  return { width: Math.round(GAME_WIDTH * scale), height: Math.round(GAME_HEIGHT * scale) }
}

/** Re-size the canvas whenever the window, the embed frame, or the DPR changes. */
export function watchRenderScale(game: Phaser.Game, parent: HTMLElement): void {
  let pending = 0
  const update = (): void => {
    pending = 0
    const { width, height } = canvasSize(renderScale(parent))
    if (width === game.scale.width && height === game.scale.height) return
    game.scale.setGameSize(width, height)
  }
  const schedule = (): void => {
    if (!pending) pending = requestAnimationFrame(update)
  }
  window.addEventListener('resize', schedule)
  if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(parent)
  const watchDpr = (): void => {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    query.addEventListener('change', () => {
      schedule()
      watchDpr()
    }, { once: true })
  }
  watchDpr()
}

/**
 * Keeps a scene's camera zoomed so the 1200x720 world fills the canvas, and
 * renders text at the same scale so it stays sharp. Call once in create().
 */
export function bindSceneResolution(scene: Phaser.Scene): void {
  let textResolution = 1

  const applyText = (obj: Phaser.GameObjects.GameObject): void => {
    if (obj instanceof Phaser.GameObjects.Text && obj.style.resolution !== textResolution) {
      obj.setResolution(textResolution)
    }
  }

  const apply = (): void => {
    const { width, height } = scene.scale
    const zoom = Math.min(width / GAME_WIDTH, height / GAME_HEIGHT)
    const cam = scene.cameras.main
    cam.setSize(width, height)
    cam.setZoom(zoom)
    cam.centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2)
    textResolution = Math.max(1, Math.ceil(zoom * 4) / 4)
    scene.children.list.forEach(applyText)
  }

  scene.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, applyText)
  scene.scale.on(Phaser.Scale.Events.RESIZE, apply)
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, applyText)
    scene.scale.off(Phaser.Scale.Events.RESIZE, apply)
  })
  apply()
}
