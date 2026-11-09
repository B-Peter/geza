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

const SEARCH_RESULTS: Record<string, ReturnType<typeof track>> = {
  "long way round": track(101, "Fifth Gear", "Long Way Round"),
  "open window": track(102, "Paper Coast", "Open Window"),
};

export const CLAUDE_PICKS = {
  remove: [
    { artist: "Sundial", title: "Blue Hour", reason: "Too slow for this mix" },
    { artist: "Gravel Choir", title: "Hymn for the Ring Road", reason: "Never played" },
  ],
  add: [
    { artist: "Fifth Gear", title: "Long Way Round", reason: "Like your loved tracks" },
    { artist: "Paper Coast", title: "Open Window", reason: "Same scene, new to you" },
  ],
};

const CORS = { "access-control-allow-origin": "*" };

/** Mock every external API the app talks to. */
export async function mockApis(page: Page): Promise<void> {
  await page.route(/^https:\/\/api\.spotify\.com\/v1\//, async (route) => {
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
    if (path === "/search") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const hit = Object.entries(SEARCH_RESULTS).find(([k]) => q.includes(k));
      return json({ tracks: { items: hit ? [hit[1]] : [] } });
    }
    return json({ error: { message: `No mock for ${path}` } }, 404);
  });

  await page.route(/^https:\/\/api\.anthropic\.com\//, async (route) => {
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
}

/** Put the app into a state by writing straight to its storage (dev server only). */
export async function seed(page: Page, opts: SeedOptions): Promise<void> {
  await page.goto("./");
  await page.evaluate(async (o) => {
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
  }, opts);
}

/** Open a route with a full reload, so the app starts from the seeded storage. */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.reload();
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
  await expect(page).toHaveScreenshot(`${name}.png`);
  if (process.env.SHOTS_DIR) {
    await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png` });
  }
}
