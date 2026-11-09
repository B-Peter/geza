import { svelte } from "@sveltejs/vite-plugin-svelte";
import type { Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

// Strict Content Security Policy, production builds only (the dev server
// needs inline styles and a websocket for hot reload).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://accounts.spotify.com https://api.spotify.com https://api.anthropic.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

const csp = (): Plugin => ({
  name: "csp",
  apply: "build",
  transformIndexHtml: () => [
    {
      tag: "meta",
      attrs: { "http-equiv": "Content-Security-Policy", content: CSP },
      injectTo: "head-prepend",
    },
  ],
});

export default defineConfig({
  // Relative base so the app works at https://<user>.github.io/<repo>/.
  base: "./",
  plugins: [
    svelte(),
    csp(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: {
        name: "Playlist Studio",
        short_name: "Playlists",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#F4F1EA",
        theme_color: "#F4F1EA",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallback: "index.html",
        // The spike page and OAuth callbacks are never served from cache.
        navigateFallbackDenylist: [/spike\.html/, /[?&]code=/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: ["safari16", "chrome120", "firefox120"],
    sourcemap: true,
    rollupOptions: {
      input: { main: "index.html", spike: "spike.html" },
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
