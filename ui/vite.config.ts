import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// grokACP monitor UI — see /docs/monitor-ui-design.md §4.1
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:41730',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
