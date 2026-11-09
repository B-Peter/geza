# Géza

A small PWA that keeps four Spotify playlists (Driving, Working, Cooking, Home) fresh each week. Spotify stores the playlists, Claude picks the songs, and everything else stays on the device. There is no backend.

**Status: milestone 2, the core loop.** Log in with Spotify → add your Claude key → create the four playlists → per mix: choose Keep / Tweak / Renew, leave a note for Claude, lock songs → **Prepare swap** (Claude picks, each pick is checked on Spotify, one replacement round for misses) → review → **Apply** (a snapshot is taken first, so **Undo last swap** works).

`spike.html` (Settings → Diagnostics) still has the milestone 1 go / no-go checks.

## Stack

- **Svelte 5** (runes) + **TypeScript**, built with **Vite 8**
- **vite-plugin-pwa** (Workbox) for the offline shell and install
- **@anthropic-ai/sdk**, model `claude-haiku-5-5`, called from the browser with each user's own key
- Fonts self-hosted from npm (`@fontsource-variable`), no CDN
- **Vitest** for the swap logic, **svelte-check** for types, **Biome** for lint and format

## Setup

### Spotify developer app

1. Go to https://developer.spotify.com/dashboard and create an app (Web API).
2. Add redirect URIs (exactly, with the trailing `/`):
   - `http://127.0.0.1:8080/` for local development
   - `https://<your-user>.github.io/<repo>/` for the deployed app
3. Under **User Management**, add the Spotify email of each person who will use the app.
4. Copy the **Client ID**. It's public by design (PKCE, no client secret). Never use the client secret.

### Anthropic API key

Each user creates their own key at https://console.anthropic.com: add credit, set a low spend limit, and create a key just for this app. The app stores it encrypted on the device.

## Develop

```bash
npm ci             # needs npm 8.3+ for the security overrides (older npm: npx npm@11 ci)
npm run dev        # http://127.0.0.1:8080/  (use 127.0.0.1, not localhost)
npm run lint       # Biome
npm run check      # svelte-check (types)
npm test           # Vitest
npm run build      # outputs dist/
```

Locally, the app asks for the Spotify client ID on the welcome screen. To bake it in, put `VITE_SPOTIFY_CLIENT_ID=...` in `.env.local` (ignored by git).

## Deploy

`.github/workflows/pages.yml` lints, type-checks, tests, builds and deploys to GitHub Pages on every push to `main`.

1. Settings → Pages → Source: **GitHub Actions**. (On a free plan, Pages needs a public repo.)
2. Settings → Secrets and variables → Actions → **Variables**: add `SPOTIFY_CLIENT_ID`.

On iPhone or iPad: open the Pages URL in Safari → Share → **Add to Home Screen**.

## Security notes

- No backend, no third-party scripts, no analytics. A strict Content Security Policy limits network calls to Spotify and Anthropic.
- Spotify tokens and the Claude key are encrypted with a non-extractable WebCrypto key in IndexedDB.
- Dependencies are pinned and installed from the HTTPS npm registry; GitHub Actions are pinned to commit SHAs.
