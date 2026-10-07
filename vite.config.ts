import { defineConfig } from 'vitest/config'

// Project site: https://sleepymiemoo.github.io/cannon-capture/
// The dev server stays at / so `npm run dev` opens the game directly.
// `npm run preview` uses the production base so it matches the live site.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/cannon-capture/' : '/',
  build: {
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}))
