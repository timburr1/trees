import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The page registers the worker itself through virtual:pwa-register, so index.html needs no inline script and the CSP stays strict.
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Trees',
        short_name: 'Trees',
        description: 'A focus timer that grows trees. No ads, no accounts, no tracking.',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // The manifest and its icons are precached by the plugin itself.
      includeManifestIcons: false,
      workbox: {
        // The forest lives in localStorage, so the app shell is all that needs caching.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // A navigation to a path with a file extension is a request for a file, not a page, so it is not answered with the app shell (as SWA's own fallback excludes). The pattern looks at the path only, so a query string that ends in a dotted value still opens the app.
        navigateFallbackDenylist: [/^[^?]*\.[a-z0-9]+(\?|$)/i],
      },
    }),
  ],
  test: {
    globals: true,
    // Tests read the real theme tokens from index.css, so a color change there is checked.
    css: { include: [/index\.css/] },
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // A DST-observing zone, so the date tests exercise clock changes instead of silently passing under UTC in CI.
    env: { TZ: 'America/Denver' },
  },
});
