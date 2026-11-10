import { embed, expect, library, open, player, SEARCH_RESULTS, seed, snap, test } from "./fixtures.js";

test.afterEach(({ errors }) => {
  expect(errors, "console errors").toEqual([]);
});

const ready = { loggedIn: true, claudeKey: true, playlists: true, spotifyApp: true } as const;
const embedded = { loggedIn: true, claudeKey: true, playlists: true } as const;

test("10 train start", async ({ page }) => {
  await seed(page, ready);
  await open(page, "./#/train");
  await expect(page.getByRole("button", { name: "Start a deck" })).toBeVisible();
  await snap(page, "10-train-start");
});

test("11 train card with song details", async ({ page }) => {
  await seed(page, ready);
  await open(page, "./#/train");
  await page.getByRole("button", { name: "Start a deck" }).click();
  const card = page.getByRole("article", { name: "Long Way Round by Fifth Gear" });
  await expect(card).toBeVisible();
  // Everything known about the song is on the card.
  await expect(card.getByText(/Night Service · .*3:42/)).toBeVisible();
  await expect(card.getByText("indie rock")).toBeVisible();
  await expect(card.getByText("1990s")).toBeVisible();
  await expect(card.getByText("driving")).toBeVisible();
  await expect(card.getByRole("img", { name: "Popularity 3 of 5" })).toBeVisible();
  await expect(card.getByText("Like your loved tracks")).toBeVisible();
  await expect(page.getByText(/Playing on iPhone · started in \d\.\d s/)).toBeVisible();
  // One request starts the whole deck in Spotify, skipping the intro.
  expect(player.plays[0]?.uris).toEqual(["spotify:track:t101", "spotify:track:t102"]);
  expect(player.plays[0]?.position_ms).toBe(Math.round(222_000 * 0.35));
  // Wait for the MusicBrainz details too, so the screenshot is stable.
  await expect(card.getByText("Group from United Kingdom")).toBeVisible();
  await snap(page, "11-train-card");
});

test("flow: swipe yes and no; yes lands in Géza · Yes; taste is recorded", async ({ page }) => {
  await seed(page, ready);
  await open(page, "./#/train");
  await page.getByRole("button", { name: "Start a deck" }).click();
  await expect(page.getByRole("article", { name: /Long Way Round/ })).toBeVisible();

  const created = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/me/playlists"));
  const added = page.waitForRequest(
    (r) => r.method() === "POST" && /\/playlists\/[^/]+\/items$/.test(r.url()),
  );
  await page.getByRole("button", { name: "Yes, I like it" }).click();
  expect((await created).postDataJSON()).toMatchObject({ name: "Géza · Yes", public: false });
  expect((await added).postDataJSON()).toEqual({ uris: ["spotify:track:t101"] });

  // The next song starts right away, from its own catchy part.
  const second = page.getByRole("article", { name: /Open Window/ });
  await expect(second).toBeVisible();
  await expect(second.getByLabel("Explicit")).toBeVisible();
  expect(player.plays.at(-1)?.uris).toEqual(["spotify:track:t102"]);

  // Keyboard works too: left arrow = no.
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("Deck done")).toBeVisible();
  await expect(page.getByText("1", { exact: true }).first()).toBeVisible();

  // Every swipe was recorded with its attributes and listening time.
  const history = await page.evaluate(async () => {
    // The app's own module, served by the Vite dev server.
    const load = (path: string) => import(/* @vite-ignore */ path);
    const store = await load("/src/store.ts");
    return (await store.get("train")).history;
  });
  expect(history).toHaveLength(2);
  expect(history[0]).toMatchObject({
    verdict: "yes",
    tags: ["indie rock", "driving", "1990s"],
    year: 1997,
    durationMs: 222_000,
    explicit: false,
    popularity: 58,
  });
  expect(history[0].dwellMs).toBeGreaterThanOrEqual(0);
  expect(history[1]).toMatchObject({ verdict: "no", year: 2019, explicit: true });
});

test("train: asks to wake Spotify when it isn't running", async ({ page }) => {
  player.devices = false;
  await seed(page, ready);
  await open(page, "./#/train");
  await page.getByRole("button", { name: "Start a deck" }).click();
  await expect(page.getByText("Wake up Spotify")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Spotify" })).toHaveAttribute("href", "spotify:");
  // Spotify opened meanwhile: "I'm back" starts the deck.
  player.devices = true;
  await page.getByRole("button", { name: "I'm back" }).click();
  await expect(page.getByRole("article", { name: /Long Way Round/ })).toBeVisible();
  await expect(page.getByText("Wake up Spotify")).toHaveCount(0);
});

test("train: MusicBrainz adds the original year, origin and genres", async ({ page }) => {
  await seed(page, ready);
  await open(page, "./#/train");
  await page.getByRole("button", { name: "Start a deck" }).click();
  const card = page.getByRole("article", { name: /Long Way Round/ });
  // Filled in a moment later, in the background.
  await expect(card.getByText("Night Service · 1994 (this version 1997) · 3:42")).toBeVisible();
  await expect(card.getByText("Group from United Kingdom")).toBeVisible();
  await expect(card.getByText("britpop")).toBeVisible();
  // ...and it all goes into what Géza learns.
  await page.getByRole("button", { name: "Yes, I like it" }).click();
  await expect(page.getByRole("article", { name: /Open Window/ })).toBeVisible();
  const first = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const store = await load("/src/store.ts");
    return (await store.get("train")).history[0];
  });
  expect(first).toMatchObject({ year: 1994, country: "GB" });
  expect(first.tags).toEqual(expect.arrayContaining(["indie rock", "driving", "1990s", "britpop"]));
});

test("train: with several devices you pick one, and Géza remembers it", async ({ page }) => {
  player.list = [
    { id: "mac1", name: "MacBook", type: "Computer", is_active: true },
    { id: "phone1", name: "iPhone", type: "Smartphone", is_active: false },
    { id: "tv1", name: "Living room TV", type: "TV", is_active: false, is_restricted: true } as never,
  ];
  await seed(page, ready);
  await open(page, "./#/train");
  await page.getByRole("button", { name: "Start a deck" }).click();
  const picker = page.getByRole("region", { name: "Where should Train play?" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("button", { name: /MacBook.*Computer · active now/ })).toBeVisible();
  // A device Spotify won't let apps control can't be picked.
  await expect(picker.getByRole("button", { name: /Living room TV/ })).toBeDisabled();
  await picker.getByRole("button", { name: /MacBook/ }).click();
  await expect(page.getByText(/Playing on MacBook · started in \d\.\d s/)).toBeVisible();
  expect(player.transfers).toEqual(["mac1"]);
  expect(player.plays[0]?.device).toBe("mac1");
  // Next time it goes straight to the MacBook.
  await open(page, "./#/train");
  await page.getByRole("button", { name: "Start a deck" }).click();
  await expect(page.getByText(/Playing on MacBook · started in/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Where should Train play?" })).toHaveCount(0);
  // And you can switch while swiping.
  await page.getByRole("button", { name: "Play on: MacBook · Change" }).click();
  await page
    .getByRole("region", { name: "Where should Train play?" })
    .getByRole("button", { name: /iPhone/ })
    .click();
  await expect(page.getByText(/Playing on iPhone · started in/)).toBeVisible();
});

test("train: shows what Spotify said when it refuses to play", async ({ page, errors }) => {
  player.reject = { status: 403, message: "Player command failed: Restriction violated" };
  // The browser logs the refused request itself; that one is expected here.
  const expected = /status of 403/;
  page.on("console", () => {
    for (let i = errors.length - 1; i >= 0; i--) if (expected.test(errors[i] ?? "")) errors.splice(i, 1);
  });
  await seed(page, ready);
  await open(page, "./#/train");
  await page.getByRole("button", { name: "Start a deck" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "No sound?" });
  await expect(alert.getByText(/Spotify said: Spotify 403 on .*Restriction violated/)).toBeVisible();
  await expect(alert.getByRole("button", { name: "Change device" })).toBeVisible();
  for (let i = errors.length - 1; i >= 0; i--) if (expected.test(errors[i] ?? "")) errors.splice(i, 1);
});

test("train: confirms the sound for every song, not just the first", async ({ page }) => {
  await seed(page, ready);
  await open(page, "./#/train");
  await page.getByRole("button", { name: "Start a deck" }).click();
  await expect(page.getByText(/Playing on iPhone · started in/)).toBeVisible();
  await page.getByRole("button", { name: "Yes, I like it" }).click();
  await expect(page.getByRole("article", { name: /Open Window/ })).toBeVisible();
  // This stayed blank for the second song before the fix.
  await expect(page.getByText(/Playing on iPhone · started in/)).toBeVisible();
});

test("train: says so when Spotify accepts but stays silent", async ({ page }) => {
  player.silent = true;
  await seed(page, ready);
  await open(page, "./#/train");
  await page.getByRole("button", { name: "Start a deck" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "No sound?" });
  await expect(alert).toBeVisible();
  await expect(alert.getByText(/Spotify on “iPhone” didn't start/)).toBeVisible();
  // You opened Spotify and pressed play; trying again now works.
  player.silent = false;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(/Playing on iPhone · started in/)).toBeVisible();
  await expect(alert).toHaveCount(0);
});

test("train: one real song per artist Claude names; the start screen shows how the last deck went", async ({
  page,
}) => {
  await seed(page, ready);
  await open(page, "./#/train");
  await page.getByRole("button", { name: "Start a deck" }).click();
  await expect(page.getByRole("article", { name: "Long Way Round by Fifth Gear" })).toBeVisible();
  await page.getByRole("button", { name: "Yes, I like it" }).click();
  await expect(page.getByRole("article", { name: /Open Window/ })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByText("Deck done")).toBeVisible();
  await expect(page.getByText("Skipped songs may come back")).toBeVisible();
  // Back on the start screen: Nobody Band wasn't on Spotify.
  await open(page, "./#/train");
  await expect(page.getByTestId("last-deck")).toHaveText(
    /2 of 3 artists on Spotify · 2 songs · 1 yes,\s+0 no/,
  );
});

test("train: a no goes to “Géza · No” in Spotify, and a fresh device reads both lists back", async ({
  page,
}) => {
  await seed(page, ready);
  await open(page, "./#/train");
  await page.getByRole("button", { name: "Start a deck" }).click();
  await expect(page.getByRole("article", { name: /Long Way Round/ })).toBeVisible();
  const created = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/me/playlists"));
  await page.getByRole("button", { name: "No, never suggest it" }).click();
  expect((await created).postDataJSON()).toMatchObject({ name: "Géza · No", public: false });

  // Another device: no local swipes, but the playlists are in Spotify.
  library.playlists = [
    { id: "pl-yes", name: "Géza · Yes", tracks: [SEARCH_RESULTS["long way round"]] },
    { id: "pl-no", name: "Géza · No", tracks: [SEARCH_RESULTS["open window"]] },
  ];
  await seed(page, ready);
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const store = await load("/src/store.ts");
    await store.remove("train");
  });
  await open(page, "./#/train");
  await expect(page.getByText("Restored 1 yes and 1 no from your Spotify playlists.")).toBeVisible();
  await expect(page.getByText("So far: 1 yes · 1 no")).toBeVisible();
  await expect(page.getByRole("link", { name: /Play “Géza · Yes” in Spotify · 1 songs/ })).toBeVisible();
});

test("train: a 502 (the app asleep) is explained, and Géza wakes the device and retries", async ({
  page,
  errors,
}) => {
  player.reject = { status: 502, message: "Bad gateway", times: 1 };
  const expected = /status of 502/;
  page.on("console", () => {
    for (let i = errors.length - 1; i >= 0; i--) if (expected.test(errors[i] ?? "")) errors.splice(i, 1);
  });
  await seed(page, ready);
  await open(page, "./#/train");
  await page.getByRole("button", { name: "Start a deck" }).click();
  // The first play got a 502; a transfer with play:true and a retry fixed it.
  await expect(page.getByText(/Playing on iPhone · started in/)).toBeVisible();
  expect(player.transfers).toContain("phone1:play");
  // The refused command isn't recorded as a play; the retry is.
  expect(player.plays).toHaveLength(1);
  for (let i = errors.length - 1; i >= 0; i--) if (expected.test(errors[i] ?? "")) errors.splice(i, 1);
});

test("train: by default plays inside Géza and starts each card on its own", async ({ page }) => {
  player.list = [
    { id: "mac1", name: "MacBook", type: "Computer", is_active: true },
    { id: "phone1", name: "iPhone", type: "Smartphone", is_active: false },
  ];
  await seed(page, embedded);
  await open(page, "./#/train");
  await page.getByRole("button", { name: "Start a deck" }).click();
  // No device picker: the embedded player is the default.
  await expect(page.getByRole("region", { name: "Where should Train play?" })).toHaveCount(0);
  const card = page.getByRole("article", { name: /Long Way Round/ });
  await expect(card.locator("iframe.embed")).toHaveAttribute("src", /open\.spotify\.com\/embed\/track\/t101/);
  await expect(page.getByText(/Playing inside Géza/)).toBeVisible();
  await page.getByRole("button", { name: "Yes, I like it" }).click();
  const next = page.getByRole("article", { name: /Open Window/ });
  await expect(next.locator("iframe.embed")).toHaveAttribute("src", /embed\/track\/t102/);
  await expect(page.getByText(/Playing inside Géza/)).toBeVisible();
  expect(player.plays).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Play on: inside Géza · Change" })).toBeVisible();
});

test("train: when the browser blocks autoplay, it asks for a tap on the player", async ({ page }) => {
  embed.autoplay = false;
  await seed(page, embedded);
  await open(page, "./#/train");
  await page.getByRole("button", { name: "Start a deck" }).click();
  await expect(page.getByText("Tap ▶ on the card to start")).toBeVisible();
  await page.frameLocator("iframe.embed").getByRole("button", { name: "play" }).click();
  await expect(page.getByText(/Playing inside Géza/)).toBeVisible();
});

test("train: you can switch to the Spotify app, and back", async ({ page }) => {
  await seed(page, embedded);
  await open(page, "./#/train");
  await page.getByRole("button", { name: "Start a deck" }).click();
  await page.getByRole("button", { name: "Play on: inside Géza · Change" }).click();
  await page
    .getByRole("region", { name: "Where should Train play?" })
    .getByRole("button", { name: /iPhone/ })
    .click();
  await expect(page.getByText(/Playing on iPhone · started in/)).toBeVisible();
  await page.getByRole("button", { name: "Play on: iPhone · Change" }).click();
  await page
    .getByRole("region", { name: "Where should Train play?" })
    .getByRole("button", { name: /Inside Géza/ })
    .click();
  await expect(page.getByText(/Playing inside Géza/)).toBeVisible();
});
