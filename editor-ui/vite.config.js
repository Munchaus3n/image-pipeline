import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
 
// Proxy /api/* → FastAPI on 7421 so React never has to think about ports.
// In production (Electron), React is bundled and talks directly to 7421.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7421",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
