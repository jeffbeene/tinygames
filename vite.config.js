import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const page = (p) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  base: '/',
  server: { open: true },
  worker: { format: 'es' },
  optimizeDeps: {
    // Both brotli builds locate their .wasm with `new URL('...', import.meta.url)`.
    // esbuild's dep pre-bundling rewrites that away, so let Vite serve them as-is.
    exclude: ['brotli-wasm', 'brotli-dec-wasm'],
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      input: {
        create: page('./index.html'),
        // Emitted as dist/play/index.html so the QR can point at a clean
        // `/play/` on any static host, with no rewrite rules required.
        play: page('./play/index.html'),
      },
    },
  },
})
