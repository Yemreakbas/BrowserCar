import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      external: [
        'three',
        'three/examples/jsm/loaders/GLTFLoader.js',
        '@dimforge/rapier3d-compat',
      ],
      output: {
        entryFileNames: 'game.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'style.css'
          return 'assets/[name][extname]'
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 4173,
  },
})
