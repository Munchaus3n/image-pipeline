import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const appVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version;

// Content-Security-Policy for the production build (the packaged desktop app).
// The dev server is left alone: Vite's hot reload needs inline scripts.
//  - scripts only from the app itself, no inline scripts, no eval;
//  - styles may be inline (React style attributes); fonts are bundled with the app;
//  - the API and images come from the local backend, whose port is chosen per launch;
//  - blob:/data: images cover dropped files and canvas exports.
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
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
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
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
