import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import path from 'path'
import electron from 'vite-plugin-electron'

const sharedAlias = { '@shared': path.resolve(__dirname, './shared') }
const electronConditions = ['node', 'import', 'module', 'default']

/**
 * Web-only build for the server edition: the Docker/Caddy image serves the
 * browser SPA directly. In this mode we skip the vite-plugin-electron bundles
 * (no Electron main/preload needed) and inline a flag so the browser client
 * defaults to talking to its own origin (no `?serverUrl=` required).
 */
const webOnly = process.env.SIMPLECRM_WEB_ONLY === '1'

/** Nodemon starts Electron (`electron:dev:main`); disable vite-plugin-electron auto-spawn. */
const electronOnstartNoop = () => {}

// https://vitejs.dev/config/
export default defineConfig({
  /** Separate cache when dev server runs beside `vite build --watch` (electron:dev). */
  cacheDir: process.env.VITE_DEV_CACHE === '1' ? 'node_modules/.vite-dev' : 'node_modules/.vite',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      ...sharedAlias,
    },
    dedupe: ['react', 'react-dom', '@tanstack/react-router'],
  },
  plugins: [
    react(),
    tailwindcss(),
    tsconfigPaths(),
    ...(webOnly ? [] : [electron([
      {
        entry: 'electron/main.js',
        onstart: electronOnstartNoop,
        vite: {
          resolve: { alias: sharedAlias, conditions: electronConditions },
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // electron/main.js loads its real implementation lazily via
              // require('../dist-electron/electron/<service>') — those files
              // are produced by build:electron:main (a separate tsc step) and
              // are NOT part of this Vite bundle. Vite 7/Rollup silently
              // tolerated the unresolved imports; Vite 8/Rolldown errors on
              // them. The function-form external keeps them external.
              external: (id) =>
                id === 'electron'
                || id.startsWith('electron/')
                || id.includes('dist-electron/')
                || [
                  'better-sqlite3',
                  'mssql',
                  'keytar',
                  'electron-window-state',
                  'electron-log',
                  'electron-rebuild',
                  'imapflow',
                  'mailparser',
                  'nodemailer',
                  'node-pop3',
                  'google-auth-library',
                  'node-cron',
                  'archiver',
                  'safe-regex',
                ].includes(id),
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart: electronOnstartNoop,
        vite: {
          resolve: { alias: sharedAlias, conditions: electronConditions },
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: (id) => id === 'electron' || id.startsWith('electron/'),
              output: { entryFileNames: 'electron/preload.js', format: 'cjs' },
            },
          },
        },
      },
    ])]),
  ],
  define: {
    // Inlined at build time. `true` only for the server web-only build so the
    // browser client defaults to its own origin; `false` for dev/electron so
    // the deploy-mode wizard keeps its existing behavior.
    __SIMPLECRM_FORCE_SAME_ORIGIN__: JSON.stringify(webOnly),
  },
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Skip the gzip-size report: it walks every chunk through gzip at the very
    // end of the build, the peak-memory phase that OOM-kills `vite build` on
    // small (4 GB) hosts. It only affects console output, not the artifacts.
    reportCompressedSize: false,
    rollupOptions: {
      input: { main: './index.html' },
    },
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
  },
  clearScreen: false,
  optimizeDeps: {
    include: [
      '@xyflow/react',
      '@xyflow/system',
      '@monaco-editor/react',
    ],
    exclude: ['electron'],
  },
  worker: {
    format: 'es',
  },
})
