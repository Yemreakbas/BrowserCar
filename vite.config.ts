import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'vendor-three'
          if (id.includes('node_modules/@dimforge/rapier3d-compat')) return 'vendor-rapier'
          if (id.includes('node_modules/socket.io-client')) return 'vendor-socket'
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
