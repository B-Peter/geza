import { expect, open, seed, test } from "./fixtures.js";

test.afterEach(({ errors }) => {
  expect(errors, "console errors").toEqual([]);
});

test("learning: plays, hearts and locks from Spotify show up", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true, playlists: true });
  await open(page, "./#/");
  // 3 plays in each of the 4 mixes (the mock gives every mix the same songs);
  // Midnight Tarmac is liked, so 4 liked.
  await expect(page.getByText("Learned from your listening: 12 plays · 4 liked.")).toBeVisible();
  await page.getByRole("link", { name: "Driving settings" }).click();
  await expect(page.getByText("· Liked · played 2×")).toBeVisible();
  await expect(page.getByText("· played 1×")).toBeVisible();
  // The hearted song was locked automatically.
  await expect(page.getByRole("button", { name: "Unlock Midnight Tarmac" })).toBeVisible();
});

test("learning: plays are counted once, not again on the next open", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true, playlists: true });
  await open(page, "./#/");
  await expect(page.getByText(/Learned from your listening: 12 plays/)).toBeVisible();
  await page.reload();
  // Same three plays from Spotify: already counted, and the heart is unchanged.
  await expect(page.getByText(/Learned from your listening: 4 liked\./)).toBeVisible();
  await page.getByRole("link", { name: "Driving settings" }).click();
  await expect(page.getByText("· Liked · played 2×")).toBeVisible();
});

test("learning: an older login is asked to reconnect for the new permissions", async ({ page }) => {
  await seed(page, { loggedIn: true, claudeKey: true, playlists: true, oldLogin: true });
  await open(page, "./#/");
  await expect(page.getByText("Géza needs a new Spotify permission", { exact: false })).toBeVisible();
  // Nothing is learned without the permissions.
  await expect(page.getByText(/Learned from your listening:/)).toHaveCount(0);
  const auth = page.waitForRequest((r) => r.url().startsWith("https://accounts.spotify.com/authorize"));
  await page.route(/^https:\/\/accounts\.spotify\.com\//, (route) => route.fulfill({ body: "ok" }));
  await page.getByRole("button", { name: "Reconnect Spotify" }).click();
  const scopes = new URL((await auth).url()).searchParams.get("scope")?.split(" ") ?? [];
  expect(scopes).toContain("user-library-read");
  expect(scopes).toContain("user-read-recently-played");
});
