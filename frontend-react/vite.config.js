import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Load .env.local so VITE_ variables are available inside this config
  // file itself — needed to read VITE_API_URL and VITE_WS_URL for the
  // proxy target rather than hardcoding localhost:8000 here.
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_URL || 'http://localhost:8000'
  const wsTarget  = env.VITE_WS_URL  || 'ws://localhost:8000'

  return {
    plugins: [
      react({
        // Enables the faster SWC-based transformer for development builds.
        // No config change needed in production — Vite uses Rollup there
        // regardless, and SWC only affects the dev server.
      }),
    ],

    server: {
      port: 5173,
      // strictPort: if 5173 is taken, fail loudly rather than silently
      // picking the next available port — prevents a scenario where two
      // dev sessions are running on different ports and one is proxying
      // to the wrong backend instance.
      strictPort: true,

      proxy: {
        // All REST API calls (everything in lib/api.js)
        '/api': {
          target:       apiTarget,
          changeOrigin: true,
          secure:       false,
          // No rewrite — the backend's router is already mounted at
          // /api/v1/session and /api/v1/feedback, matching exactly what
          // lib/api.js calls. A rewrite here would break that contract.
        },

        // WebSocket upgrade (lib/websocket.js connects to /ws/{room}/{role})
        '/ws': {
          target:       wsTarget,
          ws:           true,        // required — tells Vite to upgrade the connection
          changeOrigin: true,
          secure:       false,
        },
      },
    },

    build: {
      // Target modern browsers that support dynamic import natively.
      // Matches the mobile Safari / Chrome versions your users will
      // realistically have — avoids shipping unnecessary polyfills.
      target: 'es2020',

      // Warn (not error) if any single chunk exceeds 600kB before gzip.
      // The canvas engine + simplex-noise is legitimately large; this
      // gives us visibility without blocking the build.
      chunkSizeWarningLimit: 600,

      rollupOptions: {
        output: {
          manualChunks: (id) => {
            // ── Vendor: React core ─────────────────────────────────────────
            // Smallest possible initial bundle. React + router is all the
            // Foyer screen needs; nothing else should be in this chunk.
            if (
              id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/react-router-dom/')
            ) {
              return 'vendor-react'
            }

            // ── Vendor: Framer Motion ──────────────────────────────────────
            // Large library (~100kB gzipped) but needed by the Foyer and
            // Intake screens for page transitions — so not deferred. Split
            // from React to enable parallel loading.
            if (id.includes('node_modules/framer-motion/')) {
              return 'vendor-motion'
            }

            // ── Vendor: State + utilities ─────────────────────────────────
            // Zustand, clsx, tailwind-merge — collectively tiny, grouped
            // together to avoid fragmenting the module graph.
            if (
              id.includes('node_modules/zustand/') ||
              id.includes('node_modules/clsx/') ||
              id.includes('node_modules/tailwind-merge/')
            ) {
              return 'vendor-state'
            }

            // ── Canvas engine ─────────────────────────────────────────────
            // The heaviest chunk — the noise field simulation, palette math,
            // painting definitions, and simplex-noise are all grouped here.
            // This chunk is NOT needed until WaitingScreen or ChatScreen
            // mounts (both of which lazy-import LivingCanvas.jsx via
            // React.lazy in App.jsx). The Foyer and Intake screens therefore
            // load without parsing any of this, despite it being part of the
            // same build output.
            if (
              id.includes('/src/canvas/engine/') ||
              id.includes('/src/canvas/states/') ||
              id.includes('/src/paintings/') ||
              id.includes('node_modules/simplex-noise/')
            ) {
              return 'canvas-engine'
            }

            // All other src/ modules (screens, components, hooks, lib,
            // store, utils) fall through to Rollup's default chunking,
            // which groups them sensibly by import graph proximity.
          },
        },
      },
    },

    // Allows src/ imports without relative path hell in components.
    // e.g. import { tokens } from 'design/tokens' instead of '../../design/tokens'
    // Every alias here must also be reflected in jsconfig.json (or
    // tsconfig.json if you ever migrate) for IDE resolution to work.
    resolve: {
      alias: {
        'canvas':     '/src/canvas',
        'paintings':  '/src/paintings',
        'screens':    '/src/screens',
        'components': '/src/components',
        'hooks':      '/src/hooks',
        'lib':        '/src/lib',
        'animations': '/src/animations',
        'design':     '/src/design',
        'store':      '/src/store',
        'utils':      '/src/utils',
      },
    },
  }
})