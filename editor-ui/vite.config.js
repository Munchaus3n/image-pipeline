import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Content-Security-Policy for the production build (the packaged desktop app).
// The dev server is left alone: Vite's hot reload needs inline scripts.
//  - scripts only from the app itself, no inline scripts, no eval;
//  - styles may be inline (React style attributes) and from Google Fonts;
//  - the API and images come from the local backend, whose port is chosen per launch;
//  - blob:/data: images cover dropped files and canvas exports.
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: http://127.0.0.1:*",
  "connect-src 'self' http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const contentSecurityPolicy = {
  name: "content-security-policy",
  apply: "build",
  transformIndexHtml: () => [
    {
      tag: "meta",
      attrs: { "http-equiv": "Content-Security-Policy", content: PRODUCTION_CSP },
      injectTo: "head-prepend",
    },
  ],
};

// Proxy /api/* → FastAPI on 7421 so React never has to think about ports.
// That is the terminal/browser workflow. The desktop app talks to its own backend
// directly, on a port the Electron shell picks per launch (see electron/preload.cjs).
export default defineConfig({
  base: "./",
  plugins: [react(), contentSecurityPolicy],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7421",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
