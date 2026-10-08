import Phaser from 'phaser'
import { discord } from '../platform/runtime'
import { APP_VERSION, COMMIT } from '../version'
import { debugInfo, urlSwitches, type DebugEnv } from '../menu/debugInfo'
import { BUILD_ID } from './PerfOverlay'
import { browserLabel } from './perfStats'

/** The technical facts for "Copy debug info" (see menu/debugInfo.ts for what is left out). */
export function collectDebugEnv(game: Phaser.Game, settings: Record<string, string>): DebugEnv {
  let renderer = 'Canvas'
  let gpu: string | null = null
  const r = game.renderer
  if (r && r.type === Phaser.WEBGL) {
    const gl = (r as Phaser.Renderer.WebGL.WebGLRenderer).gl
    renderer = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL'
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '') || null
    } catch {
      gpu = null
    }
  }
  const fps = game.loop?.actualFps
  return {
    version: APP_VERSION,
    commit: COMMIT,
    build: BUILD_ID,
    userAgent: navigator.userAgent,
    browser: browserLabel(navigator.userAgent),
    screen: { w: screen.width, h: screen.height },
    viewport: { w: window.innerWidth, h: window.innerHeight },
    dpr: window.devicePixelRatio || 1,
    canvas: game.canvas ? { w: game.canvas.width, h: game.canvas.height } : null,
    renderer,
    gpu,
    fps: typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : null,
    discord: discord.inDiscord,
    switches: urlSwitches(location.search),
    settings,
  }
}

export function debugReport(game: Phaser.Game, settings: Record<string, string>): string {
  return debugInfo(collectDebugEnv(game, settings))
}
