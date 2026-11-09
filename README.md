# Playlist Studio

A small PWA that keeps Spotify playlists for occasions (Driving, Working, Cooking, Home) fresh each week. Spotify stores the playlists, Claude picks the songs, and everything else stays on the device. There is no backend.

**Status: milestone 1 spike.** The app is currently a test page with go / no-go checks:

1. **Spotify:** PKCE login, read profile, create a private playlist and add tracks (tries the current and the older playlist endpoints and logs which one works).
2. **Claude key:** paste your own Anthropic API key. It is checked with a free model lookup and stored encrypted on the device (AES-GCM, non-extractable WebCrypto key in IndexedDB).
3. **Tune check:** asks Claude (`claude-opus-5-5`) for Driving picks at Tempo 2 and Tempo 5, seeded with your top tracks, and checks each pick on Spotify. Tempo 5 should be clearly faster.

## Setup

### Spotify developer app

1. Go to https://developer.spotify.com/dashboard and create an app (Web API).
2. Add redirect URIs:
   - `http://127.0.0.1:8080/` for local development
   - `https://<your-user>.github.io/<repo>/` for the deployed app
3. Under **User Management**, add the Spotify email of each person who will use the app (Development Mode allows only a few users).
4. Copy the **Client ID**. It's public by design and is entered in the app, not committed.

### Anthropic API key

Each user creates their own key at https://console.anthropic.com: add credit, set a low monthly spend limit, and create a key just for this app.

## Develop

```bash
npm ci
npm run dev      # http://127.0.0.1:8080/  (use 127.0.0.1, not localhost)
npm run build    # outputs dist/
```

## Deploy

`.github/workflows/pages.yml` builds and deploys `dist/` to GitHub Pages on every push to `main`. In the repo settings, set **Pages → Source** to **GitHub Actions**.

On iPhone or iPad: open the Pages URL in Safari → Share → **Add to Home Screen**, then run the checks from the installed app.

## Security notes

- No third-party scripts, no CDN, no analytics. Strict Content Security Policy limits network calls to Spotify and Anthropic.
- Dependencies are pinned (`save-exact`) and installed from the HTTPS npm registry.
- The Claude key never leaves the device except in requests to `api.anthropic.com`.
