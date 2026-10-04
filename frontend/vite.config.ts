import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Aegis',
        short_name: 'Aegis',
        description: 'Intelligent Vehicle Access Management System',
        theme_color: '#2B6CB0',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        // config.js is written by the container at start. Precaching it would
        // pin every returning browser to the values it first saw, whatever the
        // deployment says now. API responses are never cached either: they
        // are personal data, and stale access decisions are worse than none.
        // The plate reader (ocr/, ~7 MB) is fetched only when someone scans.
        globIgnores: ['config.js', 'ocr/**'],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    // Single worker: the default forked pool cannot spawn in some CI sandboxes.
    pool: 'threads',
    maxWorkers: 1,
    setupFiles: './src/setupTests.ts',
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx,js,jsx}'],
      exclude: ['src/**/*.test.*', 'src/setupTests.ts', 'src/main.tsx'],
    },
  },
})
