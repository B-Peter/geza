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
  await expect(card.getByText("Night Service · 1997 · 3:42")).toBeVisible();
  await expect(card.getByText("indie rock")).toBeVisible();
  await expect(card.getByText("90s")).toBeVisible();
  await expect(card.getByText("driving")).toBeVisible();
  await expect(card.getByRole("img", { name: "Popularity 3 of 5" })).toBeVisible();
  await expect(card.getByText("Like your loved tracks")).toBeVisible();
  await expect(page.getByText(/Started in \d\.\d s/)).toBeVisible();
  // One request starts the whole deck in Spotify, skipping the intro.
  expect(player.plays[0]?.uris).toEqual(["spotify:track:t101", "spotify:track:t102"]);
  expect(player.plays[0]?.position_ms).toBe(Math.round(222_000 * 0.35));
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
