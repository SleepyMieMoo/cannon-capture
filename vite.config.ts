import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

/** The game's version, from package.json (shown under the main menu and in What's new). */
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version

/** Short commit of this build ('dev' when git isn't there). */
function commit(): string {
  try {
    return (process.env.GITHUB_SHA ?? execSync('git rev-parse HEAD').toString()).trim().slice(0, 7)
  } catch {
    return 'dev'
  }
}

/** Build id for the performance overlay: short commit and its date (stable for the same commit). */
function buildId(): string {
  try {
    const sha = (process.env.GITHUB_SHA ?? execSync('git rev-parse HEAD').toString()).trim().slice(0, 7)
    const date = execSync(`git log -1 --format=%cs ${sha}`).toString().trim()
    return `${sha} ${date}`
  } catch {
    return 'dev'
  }
}

// Project site: https://sleepymiemoo.github.io/cannon-capture/
// The build uses relative asset URLs (base './'), so the same files work on GitHub Pages
// under /cannon-capture/ and inside Discord, where the Activity is served from the root of
// https://<client_id>.discordsays.com/ through Discord's proxy.
// The dev server stays at / so `npm run dev` opens the game directly.
// `npm run preview` serves the build under /cannon-capture/ so it matches the live site.
export default defineConfig(({ command, isPreview }) => ({
  base: isPreview ? '/cannon-capture/' : command === 'build' ? './' : '/',
  define: {
    __BUILD_ID__: JSON.stringify(command === 'build' ? buildId() : 'dev'),
    __APP_VERSION__: JSON.stringify(version),
    __COMMIT__: JSON.stringify(command === 'build' ? commit() : 'dev'),
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // The Discord SDK is loaded only inside Discord; keep it in its own, clearly named file.
        manualChunks: (id) => (id.includes('@discord/embedded-app-sdk') ? 'discord-sdk' : undefined),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}))
