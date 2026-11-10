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

const SEARCH_RESULTS: Record<string, ReturnType<typeof track> & Record<string, unknown>> = {
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

/** The fake Spotify app on the phone: what was asked to play, and whether it exists. */
export const player = {
  devices: true,
  playing: null as string | null,
  plays: [] as { uris: string[]; position_ms: number }[],
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
      const body = route.request().postDataJSON() as { name: string };
      return json({
        id: `pl-${body.name.replace(/\W+/g, "-").toLowerCase()}`,
        name: body.name,
        uri: "spotify:playlist:x",
      });
    }
    if (/^\/playlists\/[^/]+\/items$/.test(path)) {
      if (route.request().method() === "GET")
        return json({ items: PLAYLIST_TRACKS.map((t) => ({ item: t })), next: null });
      return json({ snapshot_id: "s1" });
    }
    if (path === "/me/player/devices") {
      return json({
        devices: player.devices
          ? [{ id: "phone1", name: "iPhone", type: "Smartphone", is_active: true }]
          : [],
      });
    }
    if (path === "/me/player/play" && route.request().method() === "PUT") {
      if (!player.devices) return json({ error: { message: "No active device found" } }, 404);
      const body = route.request().postDataJSON() as { uris: string[]; position_ms: number };
      player.plays.push(body);
      player.playing = body.uris[0]?.split(":").pop() ?? null;
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
    return route.fulfill({
      contentType: "application/json",
      headers: CORS,
      body: JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify(CLAUDE_PICKS) }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });
  });

  // Fail loudly if anything else tries to reach the internet.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    if (/api\.spotify\.com|api\.anthropic\.com/.test(route.request().url())) return route.fallback();
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
  /** This many past Train swipes (each is 1 XP for Géza). */
  swipes?: number;
}

export const ALL_SCOPES =
  "user-read-private user-top-read playlist-read-private playlist-modify-private user-library-read user-read-recently-played user-read-playback-state user-modify-playback-state";

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
      if (o.loggedIn) {
        await store.setSecret("spotifyTokens", {
          access_token: "test-access",
          refresh_token: "test-refresh",
          expires_at: Date.now() + 3_600_000,
          ...(o.oldLogin ? {} : { scope: o.allScopes }),
        });
      }
      if (o.claudeKey) await store.setSecret("anthropicKey", "sk-ant-test-0000000000004f2a");
      if (o.swipes) {
        const history = Array.from({ length: o.swipes }, (_, i) => ({
          artist: `Artist ${i}`,
          title: `Song ${i}`,
          verdict: i % 3 === 0 ? "no" : "yes",
          tags: i % 3 === 0 ? ["ballad"] : ["indie rock"],
          dwellMs: 4_000,
          at: i,
        }));
        await store.set("train", { yes: [], no: [], playlistId: null, history });
      }
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
      player.devices = true;
      player.playing = null;
      player.plays = [];
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
  // The version label changes with every build; keep it out of the comparison.
  await expect(page).toHaveScreenshot(`${name}.png`, { mask: [page.locator(".version")] });
  if (process.env.SHOTS_DIR) {
    await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png` });
  }
}
