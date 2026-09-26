import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 5555, strictPort: true, host: true },
  preview: { port: 5555, strictPort: true, host: true },
})
