import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
  // Album covers come from Spotify's image CDN (images only).
  "img-src 'self' https://i.scdn.co",
  // MusicBrainz: open music database for original years and artist details.
  "connect-src 'self' https://accounts.spotify.com https://api.spotify.com https://api.anthropic.com https://musicbrainz.org",
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

const git = (args: string): string | null => {
  try {
    return execSync(`git ${args}`, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

/**
 * The version people see: major.minor from package.json (raised by hand for
 * a milestone) and the number of commits as the last part, so every deploy
 * gets the next number on its own and a version points at one commit.
 */
function appVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  const [major = "0", minor = "0"] = pkg.version.split(".");
  const commits = Number(git("rev-list --count HEAD"));
  return `${major}.${minor}.${Number.isFinite(commits) && commits > 0 ? commits : 0}`;
}

/** Commit and build time, for telling two builds of one version apart. */
function appBuild(): string {
  const sha = process.env.GITHUB_SHA ?? git("rev-parse HEAD") ?? "dev";
  return `${sha.slice(0, 7)} · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export default defineConfig({
  // Relative base so the app works at https://<user>.github.io/<repo>/.
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
    __APP_BUILD__: JSON.stringify(appBuild()),
  },
  plugins: [
    svelte(),
    csp(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: {
        name: "Géza",
        short_name: "Géza",
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
        // A new version takes over immediately instead of waiting until
        // every window is closed (iOS home-screen apps rarely fully close).
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  build: {
    target: ["safari16", "chrome120", "firefox120"],
    // No source maps on the public site; dev builds still have them inline.
    sourcemap: false,
    rollupOptions: {
      input: { main: "index.html", spike: "spike.html" },
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
