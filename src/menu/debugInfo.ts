/**
 * "Copy debug info" (What's new and Settings): a few lines for bug reports.
 * Only the game and the device's technical facts, never anything personal:
 * no online name, no room code, no maps, no address beyond the switches.
 */
export interface DebugEnv {
  version: string
  commit: string
  /** Build id (commit and its date). */
  build: string
  userAgent: string
  /** Browser label from the user agent ("Chrome 141"). */
  browser: string
  screen: { w: number; h: number }
  viewport: { w: number; h: number }
  dpr: number
  /** The game's canvas in device pixels. */
  canvas: { w: number; h: number } | null
  /** "WebGL2", "WebGL" or "Canvas", and the graphics chip when the browser tells. */
  renderer: string
  gpu: string | null
  /** Frames per second right now (null: not known). */
  fps: number | null
  discord: boolean
  /** Names of the URL switches in use (debug, perf, ...), not their values. */
  switches: string[]
  /** Current settings, already as text. */
  settings: Record<string, string>
}

/** Settings that are fine to share (the menu builds this). */
export interface DebugSettings {
  sound: boolean
  volume: number
  perf: boolean
  skin: string
  colour: string
  difficulty: string
}

export function settingsText(s: DebugSettings): Record<string, string> {
  return {
    sound: s.sound ? `on, ${Math.round(s.volume * 100)}%` : 'off',
    'performance overlay': s.perf ? 'on' : 'off',
    skin: s.skin,
    colour: s.colour,
    'vs AI difficulty': s.difficulty,
  }
}

/** URL switches worth knowing in a report (values left out: a room code is nobody else's business). */
const SWITCHES = ['debug', 'perf', 'pvpdev', 'lag', 'jitter', 'server', 'level', 'frame_id', 'instance_id']

export function urlSwitches(search: string): string[] {
  const p = new URLSearchParams(search)
  return SWITCHES.filter((k) => p.has(k))
}

export function debugInfo(env: DebugEnv): string {
  const set = Object.entries(env.settings)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')
  return [
    `Cannon Capture v${env.version} (${env.commit}), build ${env.build}`,
    `Browser: ${env.browser} | ${env.userAgent}`,
    `Screen ${env.screen.w}×${env.screen.h}, window ${env.viewport.w}×${env.viewport.h}, DPR ${+env.dpr.toFixed(2)}${env.canvas ? `, canvas ${env.canvas.w}×${env.canvas.h}` : ''}`,
    `Renderer: ${env.renderer}${env.gpu ? ` (${env.gpu})` : ''}${env.fps !== null ? `, ${Math.round(env.fps)} FPS` : ''}`,
    `Discord Activity: ${env.discord ? 'yes' : 'no'}${env.switches.length ? ` | switches: ${env.switches.join(', ')}` : ''}`,
    `Settings: ${set}`,
  ].join('\n')
}
