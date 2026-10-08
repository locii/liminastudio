import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }

export default defineConfig({
  main: {
    // music-metadata v8+ is ESM-only; bundle it into the CJS main build rather
    // than require()-ing it at runtime.
    plugins: [externalizeDepsPlugin({ exclude: ['music-metadata'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: './src/renderer/index.html',
      },
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
  },
})
