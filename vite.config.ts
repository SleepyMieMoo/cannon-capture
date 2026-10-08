import { defineConfig } from 'vitest/config'

// Project site: https://sleepymiemoo.github.io/cannon-capture/
// The build uses relative asset URLs (base './'), so the same files work on GitHub Pages
// under /cannon-capture/ and inside Discord, where the Activity is served from the root of
// https://<client_id>.discordsays.com/ through Discord's proxy.
// The dev server stays at / so `npm run dev` opens the game directly.
// `npm run preview` serves the build under /cannon-capture/ so it matches the live site.
export default defineConfig(({ command, isPreview }) => ({
  base: isPreview ? '/cannon-capture/' : command === 'build' ? './' : '/',
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
