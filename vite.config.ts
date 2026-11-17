import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Relative paths, so the app runs from any address, e.g. a GitHub Pages project folder.
  base: './',
  plugins: [
    react(),
    VitePWA({
      // A new version waits until the writer accepts it (see UpdateNotice).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        name: 'Writer',
        short_name: 'Writer',
        description: 'Schreiben mit Kapiteln, Wiki und Outline.',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#171615',
        theme_color: '#171615',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Everything the app needs offline. Only woff2 fonts: every browser that can install the app reads them.
        globPatterns: ['**/*.{js,css,html,woff2,png,webmanifest}'],
        navigateFallback: 'index.html',
        // The grammar check (Harper) is large: kept once it was used, not downloaded up front.
        globIgnores: ['**/harper*', '**/*.wasm'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /harper|\.wasm$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'grammar', expiration: { maxEntries: 10 } },
          },
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
