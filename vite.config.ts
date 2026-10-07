import { defineConfig } from 'vitest/config'

// Project site: https://sleepymiemoo.github.io/cannon-capture/
// The dev server stays at / so `npm run dev` opens the game directly.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/cannon-capture/' : '/',
  build: {
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}))
