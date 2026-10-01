import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5555,
    strictPort: true,
    host: true,
    allowedHosts: [".trycloudflare.com"],
  },
  preview: { port: 5555, strictPort: true, host: true },
});
