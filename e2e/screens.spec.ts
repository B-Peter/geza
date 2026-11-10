import { expect, open, seed, snap, test } from "./fixtures.js";

test.afterEach(({ errors }) => {
  expect(errors, "console errors").toEqual([]);
});

test("01 welcome", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Your music, tuned every week." })).toBeVisible();
  await expect(page.getByLabel("Spotify client ID")).toBeVisible();
  await snap(page, "01-welcome");
});

test("02 claude key", async ({ page }) => {
  await seed(page, { loggedIn: true });
  await open(page, "./");
  await expect(page.getByRole("heading", { name: "Add your Claude key" })).toBeVisible();
  await snap(page, "02-claude-key");
});

test("03 playlist setup", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true });
  await open(page, "./");
  await expect(page.getByRole("heading", { name: "Your four mixes" })).toBeVisible();
  await snap(page, "03-setup");
});

test("04 mixes", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true, playlists: true });
  await open(page, "./#/");
  await expect(page.getByRole("heading", { name: "Mixes", exact: true })).toBeVisible();
  // Wait for the sync with Spotify listening, so the screenshot is stable.
  await expect(page.getByText(/Learned from your listening/)).toBeVisible();
  await snap(page, "04-mixes");
});

test("05 one mix", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true, playlists: true });
  await open(page, "./#/mix/driving");
  await expect(page.getByText("Midnight Tarmac")).toBeVisible();
  await expect(page.getByText("· Liked · played 2×")).toBeVisible();
  await snap(page, "05-mix");
});

test("06 weekly swap", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true, playlists: true, pendingSwap: true });
  await open(page, "./#/review/driving");
  await expect(page.getByText("2 of 3 found on Spotify")).toBeVisible();
  await snap(page, "06-review");
});

test("07 settings", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true, playlists: true });
  await open(page, "./#/settings");
  await expect(page.getByText("Linked as Peter")).toBeVisible();
  await snap(page, "07-settings");
});

test("flow: create playlists, prepare and apply a swap", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true });
  await open(page, "./");
  await page.getByRole("button", { name: "Create playlists" }).click();
  await expect(page.getByRole("heading", { name: "Mixes", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Driving settings" }).click();
  await expect(page.getByText("Midnight Tarmac")).toBeVisible();
  await page.getByRole("button", { name: "Prepare swap" }).click();

  await expect(page.getByRole("heading", { name: "Weekly swap" })).toBeVisible();
  await expect(page.getByText("Long Way Round")).toBeVisible();
  await expect(page.getByText("Open Window")).toBeVisible();
  // The mock mix has 6 of 25 songs, so the swap only fills: nothing comes out.
  await expect(page.getByText("Blue Hour")).toHaveCount(0);

  const write = page.waitForRequest((r) => r.method() === "PUT" && r.url().includes("/items"));
  await page.getByRole("button", { name: "Apply" }).click();
  const body = (await write).postDataJSON() as { uris: string[] };
  expect(body.uris).toEqual([
    ...["t1", "t2", "t3", "t4", "t5", "t6"].map((id) => `spotify:track:${id}`),
    "spotify:track:t101",
    "spotify:track:t102",
  ]);
  await expect(page.getByText("Driving updated in Spotify.")).toBeVisible();
});

test("security: refuses to run inside another site's frame", async ({ page }) => {
  // Parent page on the same server (browsers block blank or public pages from
  // framing a local address).
  await page.goto("./");
  await page.evaluate(() => {
    document.body.innerHTML = '<iframe src="./" width="390" height="600"></iframe>';
  });
  // Two safe outcomes: the frame redirects the parent to the app (allowed for
  // same-origin frames), or it blanks itself. Never a usable app inside a frame.
  await expect
    .poll(async () => {
      const frame = page.frames().find((f) => f !== page.mainFrame());
      if (!frame) return "parent redirected";
      const children = await frame.evaluate(() => document.documentElement.childElementCount).catch(() => -1);
      return children === 0 ? "frame blank" : "frame still showing";
    })
    .toMatch(/parent redirected|frame blank/);
});

test("security: the Spotify login asks only for the scopes the app uses", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("Spotify client ID").fill("test-client-id");
  const auth = page.waitForRequest((r) => r.url().startsWith("https://accounts.spotify.com/authorize"));
  await page.route(/^https:\/\/accounts\.spotify\.com\//, (route) => route.fulfill({ body: "ok" }));
  await page.getByRole("button", { name: "Continue with Spotify" }).click();
  const url = new URL((await auth).url());
  expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual(
    [
      "playlist-modify-private",
      "playlist-read-private",
      "user-library-read",
      "user-modify-playback-state",
      "user-read-playback-state",
      "user-read-private",
      "user-read-recently-played",
      "user-top-read",
    ].sort(),
  );
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9._~-]{16}$/);
});

test("08 play something", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true, playlists: true });
  await open(page, "./#/random");
  await expect(page.getByRole("heading", { name: "Play something" })).toBeVisible();
  await snap(page, "08-random");
});

test("flow: tune a mix with the spider graph", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true, playlists: true });
  await open(page, "./#/mix/driving");
  const graph = page.getByRole("group", { name: "Sound of Driving" });
  await expect(graph).toBeVisible();
  // Driving starts at tempo 4 ("Brisk"); the stepper changes the selected axis.
  await expect(graph.getByText("Brisk", { exact: true })).toBeVisible();
  await graph.getByRole("button", { name: "More tempo" }).click();
  await expect(graph.getByText("Racing", { exact: true })).toBeVisible();
  // Tapping the graph near the top selects Mood at the tapped level.
  const svg = graph.locator("svg");
  const box = await svg.boundingBox();
  if (!box) throw new Error("no graph");
  // Mood axis points up from the centre (175,170) in a 350x330 drawing; level 1 is 1/5 of the radius.
  await svg.click({ position: { x: (175 / 350) * box.width, y: ((170 - 94 / 5) / 330) * box.height } });
  await expect(graph.getByRole("button", { name: "Mood", pressed: true })).toBeVisible();
  await expect(graph.getByText("Gloomy", { exact: true })).toBeVisible();
  // The change is saved: after a reload the stepper (back on Tempo) still shows it.
  await page.reload();
  await expect(
    page.getByRole("group", { name: "Sound of Driving" }).getByText("Racing", { exact: true }),
  ).toBeVisible();
});

test("flow: play something random", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true, playlists: true });
  await open(page, "./#/");
  await page.getByRole("link", { name: /Play something random/ }).click();
  await page.getByRole("button", { name: "Focus" }).click();
  await expect(page.getByRole("button", { name: "Focus", pressed: true })).toBeVisible();

  const created = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/me/playlists"));
  const write = page.waitForRequest((r) => r.method() === "PUT" && r.url().includes("/items"));
  await page.getByRole("button", { name: "Pick 20 songs" }).click();
  expect((await created).postDataJSON()).toMatchObject({ name: "Studio Random", public: false });
  expect(((await write).postDataJSON() as { uris: string[] }).uris).toEqual([
    "spotify:track:t101",
    "spotify:track:t102",
  ]);
  await expect(page.getByText(/2 songs ready in “Studio Random”/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Play in Spotify" })).toHaveAttribute(
    "href",
    "spotify:playlist:pl-studio-random",
  );
});

test("09 loading animation while playlists are created", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true });
  await open(page, "./");
  // Hold Spotify's answer so the loader is on screen long enough to check.
  let release: () => void = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route(/\/v1\/me\/playlists$/, async (route) => {
    await held;
    await route.fallback();
  });
  await page.getByRole("button", { name: "Create playlists" }).click();
  const loader = page.getByRole("status").filter({ hasText: "Creating playlists…" });
  await expect(loader).toBeVisible();
  await expect(loader).toHaveAttribute("aria-busy", "true");
  await expect(loader.getByText("Digging through the crates…")).toBeVisible();
  await snap(page, "09-loading");
  release();
  await expect(page.getByRole("heading", { name: "Mixes", exact: true })).toBeVisible();
  await expect(loader).toHaveCount(0);
});

test("loading animation stays still with Reduce Motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seed(page, { loggedIn: true, claudeKey: true });
  await open(page, "./");
  await page.route(/\/v1\/me\/playlists$/, () => new Promise(() => {})); // never answers
  await page.getByRole("button", { name: "Create playlists" }).click();
  const bar = page.locator(".bar").first();
  await expect(bar).toBeVisible();
  expect(await bar.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});

test("flow: change Claude's mind on a swap row, and the reasons stay with the songs", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true, playlists: true, pendingSwap: true });
  await open(page, "./#/review/driving");
  // Keep Blue Hour after all: it leaves the swap and gets locked.
  await page.getByRole("button", { name: "Keep Blue Hour" }).click();
  await expect(page.getByText("Blue Hour")).toHaveCount(0);
  // Not Open Window: it leaves the swap and is never suggested for Driving again.
  await page.getByRole("button", { name: "Skip Open Window" }).click();
  await expect(page.getByText("Open Window")).toHaveCount(0);
  await expect(page.getByText(/1 out, 1 in/)).toBeVisible();

  const write = page.waitForRequest((r) => r.method() === "PUT" && r.url().includes("/items"));
  await page.getByRole("button", { name: "Apply" }).click();
  const body = (await write).postDataJSON() as { uris: string[] };
  // Only one song comes in, so (the mix being short anyway) nothing comes out.
  expect(body.uris).toEqual([
    ...["t1", "t2", "t3", "t4", "t5", "t6"].map((id) => `spotify:track:${id}`),
    "spotify:track:t101",
  ]);
  await expect(page.getByText("Driving updated in Spotify.")).toBeVisible();

  const mix = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const mixes = await load("/src/mixes.ts");
    return (await mixes.loadMixes()).find((m: { id: string }) => m.id === "driving");
  });
  // t1 is auto-locked by learning (it is in Liked Songs); t5 by the Keep tap.
  expect(mix.locked.map((t: { id: string }) => t.id)).toContain("t5");
  expect(mix.blocked).toEqual([{ artist: "Paper Coast", title: "Open Window" }]);
  // Kept per song for the mix screen (the mock playlist doesn't keep the PUT, so not checked there).
  expect(mix.reasons).toEqual({ t101: "Like your loved tracks" });
});

test("12 what Géza learned: labels can be switched off", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true, playlists: true });
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const store = await load("/src/store.ts");
    const now = Date.now();
    const j = (verdict: string, tags: string[], year: number, artist: string, country?: string) => ({
      artist,
      title: `Song ${Math.random()}`,
      verdict,
      tags,
      year,
      country,
      dwellMs: 10_000,
      at: now,
    });
    await store.set("train", {
      yes: [],
      no: [],
      playlistId: null,
      history: [
        j("yes", ["indie rock", "driving"], 1996, "Fifth Gear", "GB"),
        j("yes", ["indie rock", "mellow"], 1994, "Fifth Gear", "GB"),
        j("yes", ["indie rock"], 1998, "Dunmore Quartet", "GB"),
        j("no", ["ballad", "2020s"], 2022, "Someone", "US"),
        j("no", ["ballad"], 2023, "Someone Else", "US"),
      ],
    });
  });
  await open(page, "./#/settings");
  await page.getByRole("link", { name: /What Géza learned/ }).click();
  await expect(page.getByRole("heading", { name: "What Géza learned" })).toBeVisible();
  await expect(page.getByText("From 5 swipes")).toBeVisible();
  const genres = page.getByRole("group", { name: "Genres and moods" });
  await expect(genres.getByRole("button", { name: /indie rock/ })).toHaveAttribute("aria-pressed", "true");
  await expect(genres.getByRole("button", { name: /ballad/ })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Eras" }).getByRole("button", { name: /1990s/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Artists" }).getByRole("button", { name: /Fifth Gear/ }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "Where artists are from" })
      .getByRole("button", { name: /United Kingdom/ }),
  ).toBeVisible();
  await snap(page, "12-taste");
  // Switch "indie rock" off: it's remembered and leaves the profile Claude gets.
  await genres.getByRole("button", { name: /indie rock/ }).click();
  await expect(genres.getByRole("button", { name: /indie rock/ })).toHaveAttribute("aria-pressed", "false");
  const muted = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const store = await load("/src/store.ts");
    return (await store.get("train")).muted;
  });
  expect(muted).toEqual(["tag:indie rock"]);
});

test("flow: rate the random picks, and it counts like a swipe", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true, playlists: true });
  await open(page, "./#/random");
  await page.getByRole("button", { name: "Pick 20 songs" }).click();
  await expect(page.getByText(/2 songs ready in “Studio Random”/)).toBeVisible();
  await expect(page.getByText("Long Way Round")).toBeVisible();
  const added = page.waitForRequest(
    (r) => r.method() === "POST" && /\/playlists\/[^/]+\/items$/.test(r.url()),
  );
  await page.getByRole("button", { name: "Yes: Long Way Round" }).click();
  expect((await added).postDataJSON()).toEqual({ uris: ["spotify:track:t101"] });
  await expect(page.getByRole("button", { name: "Yes: Long Way Round" })).toBeDisabled();
  await page.getByRole("button", { name: "No: Open Window" }).click();
  const history = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const store = await load("/src/store.ts");
    return (await store.get("train")).history;
  });
  expect(history.map((h: { verdict: string }) => h.verdict)).toEqual(["yes", "no"]);
});

test("mixes: nudges to swipe a deck first when there are no swipes yet", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true, playlists: true });
  await open(page, "./#/");
  await expect(page.getByText(/No swipes yet: do one deck first/)).toBeVisible();
});

test("an installed update says so once", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true, playlists: true });
  await page.evaluate(() => localStorage.setItem("ps.seenVersion", "old-version"));
  await open(page, "./#/");
  await expect(page.getByText("Géza was updated.")).toBeVisible();
  await open(page, "./#/");
  await expect(page.getByRole("heading", { name: "Mixes", exact: true })).toBeVisible();
  await expect(page.getByText(/Géza was updated/)).toHaveCount(0);
});
