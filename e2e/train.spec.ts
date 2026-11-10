import { expect, open, player, seed, snap, test } from "./fixtures.js";

test.afterEach(({ errors }) => {
  expect(errors, "console errors").toEqual([]);
});

const ready = { loggedIn: true, claudeKey: true, playlists: true } as const;

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
  await expect(card.getByText("90s")).toBeVisible();
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
    tags: ["indie rock", "90s", "driving"],
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
  expect(first.tags).toEqual(expect.arrayContaining(["indie rock", "90s", "driving", "britpop"]));
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
