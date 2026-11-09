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
  await snap(page, "04-mixes");
});

test("05 one mix", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true, playlists: true });
  await open(page, "./#/mix/driving");
  await expect(page.getByText("Midnight Tarmac")).toBeVisible();
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
