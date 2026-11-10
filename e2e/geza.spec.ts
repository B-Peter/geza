import { expect, open, seed, snap, test } from "./fixtures.js";

test.afterEach(({ errors }) => {
  expect(errors, "console errors").toEqual([]);
});

const ready = { loggedIn: true, claudeKey: true, playlists: true } as const;

test("12 Géza on Mixes", async ({ page }) => {
  await seed(page, ready);
  await open(page, "./#/");
  const geza = page.getByRole("region", { name: "Géza" });
  await expect(geza.getByText("LV 1")).toBeVisible();
  await expect(geza.getByText("STREET KID")).toBeVisible();
  await expect(geza.getByRole("img", { name: "Géza, level 1: Street Kid" })).toBeVisible();
  // Learning from the mocked listening (12 plays, 4 hearts) is XP.
  await expect(geza.getByText("16 XP")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await snap(page, "12-geza-mixes");
});

test("13 level up", async ({ page }) => {
  // 30 swipes + 16 from listening = 46 XP: level 2, Netrunner.
  await seed(page, { ...ready, swipes: 30 });
  await open(page, "./#/");
  const dialog = page.getByRole("dialog", { name: "LEVEL UP!" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("NETRUNNER")).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Géza, level 2: Netrunner" })).toBeVisible();
  await snap(page, "13-level-up");
  await dialog.getByRole("button", { name: "CONTINUE >" }).click();
  await expect(dialog).toHaveCount(0);
  // He now talks about what he learned from the swipes.
  await expect(page.getByText("You drop ballad fast. Noted: fewer of those.")).toBeVisible();
  // Celebrated once: not shown again after a reload.
  await open(page, "./#/");
  await expect(page.getByRole("region", { name: "Géza" }).getByText("NETRUNNER")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
