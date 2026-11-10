// Test fixtures: fake Spotify and Anthropic APIs, and helpers to put the app
// into a given state. No real network calls leave the browser.

import { test as base, expect, type Page } from "@playwright/test";

const track = (n: number, artist: string, title: string) => ({
  id: `t${n}`,
  uri: `spotify:track:t${n}`,
  name: title,
  type: "track",
  artists: [{ name: artist }],
});

export const PLAYLIST_TRACKS = [
  track(1, "Kestrel Lane", "Midnight Tarmac"),
  track(2, "Kestrel Lane", "Neon Shoulder"),
  track(3, "Dunmore Quartet", "Harbour Lights"),
  track(4, "The Overpass", "Static Bloom"),
  track(5, "Sundial", "Blue Hour"),
  track(6, "Gravel Choir", "Hymn for the Ring Road"),
];

export const SEARCH_RESULTS: Record<string, ReturnType<typeof track> & Record<string, unknown>> = {
  "long way round": {
    ...track(101, "Fifth Gear", "Long Way Round"),
    album: { name: "Night Service", release_date: "1997-04-01" },
    duration_ms: 222_000,
    explicit: false,
    popularity: 58,
  },
  "open window": {
    ...track(102, "Paper Coast", "Open Window"),
    album: { name: "Low Tide Hours", release_date: "2019" },
    duration_ms: 245_000,
    explicit: true,
  },
};

/** Artists Claude names for a Train deck; Spotify has a song for each. */
export const CLAUDE_ARTISTS = {
  artists: [
    {
      artist: "Fifth Gear",
      want: "hit",
      reason: "Like your loved tracks",
      tags: ["indie rock", "driving"],
    },
    {
      artist: "Paper Coast",
      want: "hit",
      reason: "Same scene, new to you",
      tags: ["dream pop", "mellow"],
    },
    { artist: "Nobody Band", want: "any", reason: "Not on Spotify", tags: ["folk"] },
  ],
};
const ARTISTS: Record<string, { id: string; name: string; genres: string[]; popularity: number }> = {
  "fifth gear": { id: "a1", name: "Fifth Gear", genres: ["britpop"], popularity: 40 },
  "paper coast": { id: "a2", name: "Paper Coast", genres: ["dream pop"], popularity: 25 },
};
const TOP_TRACKS: Record<string, unknown[]> = {
  a1: [SEARCH_RESULTS["long way round"]],
  a2: [SEARCH_RESULTS["open window"]],
};

/** The fake Spotify app on the phone: what was asked to play, and whether it exists. */
type FakeDevice = { id: string; name: string; type: string; is_active: boolean };
const PHONE: FakeDevice = { id: "phone1", name: "iPhone", type: "Smartphone", is_active: true };

/** The embedded player stand-in: does it start when told to play? */
export const embed = {
  autoplay: true,
  reset() {
    this.autoplay = true;
  },
};

/** Playlists in the tester's Spotify library (none by default). */
export const library = {
  playlists: [] as { id: string; name: string; tracks: unknown[] }[],
  /** Refuse public playlists (a login without playlist-modify-public). */
  noPublic: false,
  reset() {
    this.playlists = [];
    this.noPublic = false;
  },
};

export const player = {
  devices: true,
  /** Devices Spotify lists (default: just the phone). */
  list: [PHONE] as FakeDevice[],
  /** Accepts play commands but never actually plays (an app iOS put to sleep). */
  silent: false,
  /** Reject play commands with this Spotify error; `times` limits how many (default: always). */
  reject: null as { status: number; message: string; times?: number } | null,
  /** The device the last play went to. */
  on: null as string | null,
  playing: null as string | null,
  plays: [] as { uris: string[]; position_ms: number; device: string | null }[],
  transfers: [] as string[],
  reset() {
    this.devices = true;
    this.list = [PHONE];
    this.silent = false;
    this.reject = null;
    this.on = null;
    this.playing = null;
    this.plays = [];
    this.transfers = [];
  },
};

export const CLAUDE_PICKS = {
  remove: [
    { artist: "Sundial", title: "Blue Hour", reason: "Too slow for this mix" },
    { artist: "Gravel Choir", title: "Hymn for the Ring Road", reason: "Never played" },
  ],
  add: [
    {
      artist: "Fifth Gear",
      title: "Long Way Round",
      reason: "Like your loved tracks",
      tags: ["indie rock", "90s", "driving"],
    },
    {
      artist: "Paper Coast",
      title: "Open Window",
      reason: "Same scene, new to you",
      tags: ["dream pop", "2010s", "mellow"],
    },
  ],
};

// Like the real APIs: answer CORS preflights (Safari sends them for requests
// with an Authorization header and is strict about the allowed headers).
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers":
    "*, authorization, content-type, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access",
  "access-control-max-age": "600",
};
const preflight = (route: import("@playwright/test").Route) => route.fulfill({ status: 204, headers: CORS });
const PLAYS_BASE = Date.now();

/** Mock every external API the app talks to. */
export async function mockApis(page: Page): Promise<void> {
  await page.route(/^https:\/\/api\.spotify\.com\/v1\//, async (route) => {
    if (route.request().method() === "OPTIONS") return preflight(route);
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/v1", "");
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });

    if (path === "/me")
      return json({ id: "tester", display_name: "Peter", country: "HU", product: "premium" });
    if (path === "/me/top/tracks") return json({ items: PLAYLIST_TRACKS.slice(0, 3) });
    if (path === "/me/top/artists") return json({ items: [{ name: "Kestrel Lane" }] });
    if (path === "/me/playlists" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { name: string; public?: boolean };
      if (body.public && library.noPublic)
        return json({ error: { message: "Insufficient client scope" } }, 403);
      return json({
        id: `pl-${body.name.replace(/\W+/g, "-").toLowerCase()}`,
        name: body.name,
        uri: "spotify:playlist:x",
      });
    }
    if (path === "/me/playlists" && route.request().method() === "GET") {
      return json({
        items: library.playlists.map(({ id, name }) => ({ id, name, uri: `spotify:playlist:${id}` })),
        next: null,
      });
    }
    const items = /^\/playlists\/([^/]+)\/items$/.exec(path);
    if (items) {
      if (route.request().method() === "GET") {
        const own = library.playlists.find((p) => p.id === items[1]);
        return json({ items: (own?.tracks ?? PLAYLIST_TRACKS).map((t) => ({ item: t })), next: null });
      }
      return json({ snapshot_id: "s1" });
    }
    if (path === "/me/player/devices") {
      return json({ devices: player.devices ? player.list : [] });
    }
    if (path === "/me/player" && route.request().method() === "GET") {
      if (!player.playing) return route.fulfill({ status: 204, headers: CORS });
      return json({ is_playing: true, item: { id: player.playing }, device: { id: player.on } });
    }
    if (path === "/me/player" && route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { device_ids: string[]; play?: boolean };
      player.transfers.push(`${body.device_ids[0] ?? ""}${body.play ? ":play" : ""}`);
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (path === "/me/player/play" && route.request().method() === "PUT") {
      if (!player.devices) return json({ error: { message: "No active device found" } }, 404);
      if (player.reject && (player.reject.times === undefined || player.reject.times-- > 0))
        return json({ error: { message: player.reject.message } }, player.reject.status);
      player.on = url.searchParams.get("device_id");
      const body = route.request().postDataJSON() as { uris: string[]; position_ms: number };
      player.plays.push({ ...body, device: url.searchParams.get("device_id") });
      if (!player.silent) player.playing = body.uris[0]?.split(":").pop() ?? null;
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (path === "/me/player/pause") {
      player.playing = null;
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (path === "/me/player/currently-playing") {
      if (!player.playing) return route.fulfill({ status: 204, headers: CORS });
      return json({ is_playing: true, item: { id: player.playing } });
    }
    if (path === "/me/player/recently-played") {
      // Two plays of Midnight Tarmac and one of Harbour Lights, in the last hour.
      // Fixed timestamps, like real Spotify: the same play keeps its time.
      const ago = (min: number) => new Date(PLAYS_BASE - min * 60_000).toISOString();
      return json({
        items: [
          { track: PLAYLIST_TRACKS[0], played_at: ago(10) },
          { track: PLAYLIST_TRACKS[0], played_at: ago(30) },
          { track: PLAYLIST_TRACKS[2], played_at: ago(50) },
        ],
      });
    }
    if (path === "/me/tracks/contains") {
      // Midnight Tarmac is in your Liked Songs.
      const ids = (url.searchParams.get("ids") ?? "").split(",");
      return json(ids.map((id) => id === "t1"));
    }
    const top = /^\/artists\/([^/]+)\/top-tracks$/.exec(path);
    if (top) return json({ tracks: TOP_TRACKS[top[1] ?? ""] ?? [] });
    if (path === "/search" && url.searchParams.get("type") === "artist") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const hit = Object.entries(ARTISTS).find(([k]) => q.includes(k));
      return json({ artists: { items: hit ? [hit[1]] : [] } });
    }
    if (path === "/search") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const hit = Object.entries(SEARCH_RESULTS).find(([k]) => q.includes(k));
      return json({ tracks: { items: hit ? [hit[1]] : [] } });
    }
    return json({ error: { message: `No mock for ${path}` } }, 404);
  });

  await page.route(/^https:\/\/api\.anthropic\.com\//, async (route) => {
    if (route.request().method() === "OPTIONS") return preflight(route);
    const url = route.request().url();
    if (url.includes("/v1/models/")) {
      return route.fulfill({
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify({ id: "claude-haiku-5-5", type: "model" }),
      });
    }
    // A deck request asks for artists; everything else asks for songs.
    const deck = (route.request().postData() ?? "").includes("judged_artists");
    return route.fulfill({
      contentType: "application/json",
      headers: CORS,
      body: JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify(deck ? CLAUDE_ARTISTS : CLAUDE_PICKS) }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });
  });

  // MusicBrainz: Fifth Gear is a British group; "Night Service" first came out
  // in 1994 (Spotify's copy says 1997). Paper Coast isn't in the database.
  await page.route(/^https:\/\/musicbrainz\.org\//, async (route) => {
    if (route.request().method() === "OPTIONS") return preflight(route);
    const url = new URL(route.request().url());
    const q = (url.searchParams.get("query") ?? "").toLowerCase();
    const json = (body: unknown) =>
      route.fulfill({ contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    if (url.pathname === "/ws/2/artist" && q.includes("fifth gear")) {
      return json({
        artists: [
          {
            score: 100,
            name: "Fifth Gear",
            country: "GB",
            type: "Group",
            tags: [
              { name: "britpop", count: 9 },
              { name: "british", count: 7 },
              { name: "indie rock", count: 5 },
            ],
          },
        ],
      });
    }
    if (url.pathname === "/ws/2/release-group" && q.includes("night service")) {
      return json({
        "release-groups": [{ score: 100, title: "Night Service", "first-release-date": "1994-03-01" }],
      });
    }
    return json(url.pathname === "/ws/2/artist" ? { artists: [] } : { "release-groups": [] });
  });

  // Spotify's embedded player: a stand-in that speaks the same postMessage
  // protocol (ready → play → playback_update). `embed.autoplay` = false acts
  // like a browser that blocks autoplay.
  await page.route(/^https:\/\/open\.spotify\.com\//, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>embed</title><button id="p">play</button><p id="song">song 0</p><script>
        // Like Spotify's player: one song at a time; seeking to the end moves on to the next one.
        let song = 0, position = 0, paused = true;
        const tell = (m) => parent.postMessage(m, "*");
        const update = () => {
          document.getElementById("song").textContent = "song " + song + (paused ? " paused" : " playing");
          tell({ type: "playback_update", payload: { isPaused: paused, position, duration: 30000 } });
        };
        const play = () => { paused = false; position = Math.max(position, 1000); update(); };
        addEventListener("message", (e) => {
          const c = e.data && e.data.command;
          if (c === "play" && ${embed.autoplay}) play();
          if (c === "resume") { paused = false; update(); }
          if (c === "pause") { paused = true; update(); }
          if (c === "seek") {
            if (e.data.timestamp >= 28) { song++; position = 0; } else position = e.data.timestamp * 1000;
            update();
          }
        });
        document.getElementById("p").onclick = play;
        tell({ type: "ready" });
      </script>`,
    }),
  );

  // Fail loudly if anything else tries to reach the internet.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    if (
      /api\.spotify\.com|api\.anthropic\.com|musicbrainz\.org|open\.spotify\.com/.test(route.request().url())
    )
      return route.fallback();
    return route.abort();
  });
}

export interface SeedOptions {
  loggedIn?: boolean;
  claudeKey?: boolean;
  playlists?: boolean;
  pendingSwap?: boolean;
  /** A login from before Géza asked for the listening permissions. */
  oldLogin?: boolean;
  /** Train plays through the Spotify app instead of the embedded player. */
  spotifyApp?: boolean;
}

export const ALL_SCOPES =
  "user-read-private user-top-read playlist-read-private playlist-modify-private playlist-modify-public user-library-read user-read-recently-played user-read-playback-state user-modify-playback-state";

/** Put the app into a state by writing straight to its storage (dev server only). */
export async function seed(page: Page, opts: SeedOptions): Promise<void> {
  await page.goto("./");
  await page.evaluate(
    async (o) => {
      // Runs in the browser against the Vite dev server, which serves the
      // app's own modules; this writes state exactly as the app would.
      const load = (path: string) => import(/* @vite-ignore */ path);
      const store = await load("/src/store.ts");
      const mixes = await load("/src/mixes.ts");
      localStorage.setItem("ps.spotifyClientId", "test-client-id");
      if (o.spotifyApp) localStorage.setItem("ps.trainInApp", "0");
      else localStorage.removeItem("ps.trainInApp");
      if (o.loggedIn) {
        await store.setSecret("spotifyTokens", {
          access_token: "test-access",
          refresh_token: "test-refresh",
          expires_at: Date.now() + 3_600_000,
          ...(o.oldLogin ? {} : { scope: o.allScopes }),
        });
      }
      if (o.claudeKey) await store.setSecret("anthropicKey", "sk-ant-test-0000000000004f2a");
      const list = mixes
        .defaultMixes()
        .map((m: { id: string }) => ({ ...m, playlistId: o.playlists ? `pl-${m.id}` : null }));
      await mixes.saveMixes(list);
      if (o.pendingSwap) {
        const t = (id: string, artist: string, title: string) => ({
          id,
          uri: `spotify:track:${id}`,
          artist,
          title,
        });
        await mixes.savePending({
          mixId: "driving",
          createdAt: Date.now(),
          remove: [
            { track: t("t5", "Sundial", "Blue Hour"), reason: "Too slow for this mix" },
            { track: t("t6", "Gravel Choir", "Hymn for the Ring Road"), reason: "Never played" },
          ],
          add: [
            { track: t("t101", "Fifth Gear", "Long Way Round"), reason: "Like your loved tracks" },
            { track: t("t102", "Paper Coast", "Open Window"), reason: "Same scene, new to you" },
          ],
          picked: 3,
          found: 2,
          missing: [{ artist: "Ghost Band", title: "Not Real", reason: "" }],
        });
      }
    },
    { ...opts, allScopes: ALL_SCOPES },
  );
}

/** Open a route with a full reload, so the app starts from the seeded storage. */
export async function open(page: Page, path: string): Promise<void> {
  // Leave the app completely, then one clean load. (Load-then-reload aborted
  // the first load's requests mid-flight, which WebKit reports as errors.)
  await page.goto("about:blank");
  await page.goto(path);
}

/** Collects console errors and page exceptions; tests assert it stays empty. */
// `auto: true` so the mocks are in place before every test, not only tests
// that ask for `errors`.
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(e.message));
      if (process.env.PW_TRACE_ERRORS) {
        page.on("console", (m) => console.log("CONSOLE", m.type(), m.text()));
        page.on("pageerror", (e) => console.log("PAGEERROR", e.stack));
      }
      // Fresh fake Spotify app for every test.
      player.reset();
      library.reset();
      embed.reset();
      await mockApis(page);
      await use(errors);
    },
    { auto: true },
  ],
});

export { expect };

/** Wait until fonts are loaded and nothing is animating, then screenshot. */
export async function snap(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  // Keep moving parts out of the comparison: the build version label and the
  // Train listening timer.
  await expect(page).toHaveScreenshot(`${name}.png`, {
    mask: [page.locator(".version"), page.locator(".playing")],
  });
  if (process.env.SHOTS_DIR) {
    await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png` });
  }
}
