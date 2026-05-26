import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import path from 'path'
import electron from 'vite-plugin-electron'

const sharedAlias = { '@shared': path.resolve(__dirname, './shared') }
const electronConditions = ['node', 'import', 'module', 'default']

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
    electron([
      {
        entry: 'electron/main.js',
        onstart: electronOnstartNoop,
        vite: {
          resolve: { alias: sharedAlias, conditions: electronConditions },
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: [
                'electron',
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
              ],
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
    ]),
  ],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
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
      '@supabase/postgrest-js',
      '@xyflow/react',
      '@xyflow/system',
      '@monaco-editor/react',
      'monaco-editor',
    ],
    exclude: ['electron'],
  },
  worker: {
    format: 'es',
  },
})
