/** The game's version (package.json) and short commit, put in by Vite at build time (vite.config.ts). */
declare const __APP_VERSION__: string
declare const __COMMIT__: string

export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
/** Short commit hash, or 'dev' for the dev server and tests. */
export const COMMIT: string = typeof __COMMIT__ !== 'undefined' ? __COMMIT__ : 'dev'

/** "v0.1.0 · 8642847" (or "v0.1.0 · dev"). */
export function versionLabel(version = APP_VERSION, commit = COMMIT): string {
  return `v${version} · ${commit || 'dev'}`
}
