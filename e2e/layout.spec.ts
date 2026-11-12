import type { Page } from "@playwright/test";
import { expect, open, player, type SeedOptions, seed, test } from "./fixtures.js";

// Layout audit in Safari's engine (WebKit), at iPhone size: every screen must
// fit the width, show its text in full, and keep tap targets at least 44 px.

interface Screen {
  name: string;
  seed?: SeedOptions;
  path: string;
  ready: (page: Page) => Promise<void>;
}

test.afterEach(({ errors }) => {
  expect(errors, "console errors").toEqual([]);
});

const all = { loggedIn: true, claudeKey: true, playlists: true } satisfies SeedOptions;

const SCREENS: Screen[] = [
  { name: "welcome", path: "./", ready: (p) => p.getByText("New music, picked for you.").waitFor() },
  {
    name: "claude-key",
    seed: { loggedIn: true },
    path: "./",
    ready: (p) => p.getByText("Add your Claude key").waitFor(),
  },
  {
    name: "setup",
    seed: { loggedIn: true, claudeKey: true },
    path: "./",
    ready: (p) => p.getByText("Your four mixes").waitFor(),
  },
  { name: "mixes", seed: all, path: "./#/", ready: (p) => p.getByText("Kept as is").waitFor() },
  { name: "mix", seed: all, path: "./#/mix/driving", ready: (p) => p.getByText("Midnight Tarmac").waitFor() },
  {
    name: "review",
    seed: { ...all, pendingSwap: true },
    path: "./#/review/driving",
    ready: (p) => p.getByText("Long Way Round").waitFor(),
  },
  {
    name: "settings",
    seed: all,
    path: "./#/settings",
    ready: (p) => p.getByText("Linked as Peter").waitFor(),
  },
  { name: "random", seed: all, path: "./#/random", ready: (p) => p.getByText("Start from").waitFor() },
  {
    name: "train-picker",
    seed: all,
    path: "./#/train",
    ready: async (p) => {
      player.list = [
        { id: "mac1", name: "MacBook Pro", type: "Computer", is_active: false },
        { id: "phone1", name: "Peter's iPhone", type: "Smartphone", is_active: false },
      ];
      await p.getByRole("button", { name: "Start a deck" }).click();
      await p.getByRole("region", { name: "Where should the deck play?" }).waitFor();
    },
  },
  { name: "train", seed: all, path: "./#/train", ready: (p) => p.getByText("Swipe right: keep").waitFor() },
  {
    name: "train-card",
    seed: all,
    path: "./#/train",
    ready: async (p) => {
      await p.getByRole("button", { name: "Start a deck" }).click();
      await p.getByText("Group from United Kingdom").waitFor();
    },
  },
];

/** Everything wrong with the current screen's layout, as readable lines. */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const vw = document.documentElement.clientWidth;
    const label = (el: Element) => {
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `<${el.tagName.toLowerCase()}${el.className ? ` class="${String(el.className).trim()}"` : ""}> "${text}"`;
    };
    const visible = (el: Element) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0;
    };

    // 1. The page itself must not scroll sideways.
    const sw = document.documentElement.scrollWidth;
    if (sw > vw + 1) problems.push(`page is ${sw}px wide in a ${vw}px viewport`);

    for (const el of document.querySelectorAll("body *")) {
      if (!visible(el) || el.closest("svg")) continue;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      // 2. Nothing may stick out past the screen edges (decorative art excepted).
      if (!el.closest('[aria-hidden="true"]') && (r.left < -1 || r.right > vw + 1)) {
        problems.push(`off-screen ${Math.round(r.left)}..${Math.round(r.right)}px: ${label(el)}`);
      }
      // 3. Text must not be cut off unless it's deliberately ellipsized.
      const clips = s.overflowX === "hidden" || s.overflow === "hidden";
      const ellipsis = s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none";
      const leafText = el.children.length === 0 && (el.textContent ?? "").trim().length > 0;
      if (leafText && clips && !ellipsis && el.scrollWidth > el.clientWidth + 1) {
        problems.push(`text clipped (${el.scrollWidth} > ${el.clientWidth}px): ${label(el)}`);
      }
      // 4. Tap targets at least 44x44 (Apple HIG). Links inside a sentence
      //    are exempt, as in WCAG 2.5.8.
      const inlineLink = el.matches("p a, li a") && s.display === "inline";
      if (
        el.matches("button, a[href], input, [role=radio]") &&
        !inlineLink &&
        (r.width < 43.5 || r.height < 43.5)
      ) {
        problems.push(`tap target ${Math.round(r.width)}x${Math.round(r.height)}px: ${label(el)}`);
      }
      // 5. Text fields at 16px or more, or iOS zooms the page in and stays zoomed.
      if (el.matches("input, textarea, select") && Number.parseFloat(s.fontSize) < 16) {
        problems.push(`field font ${s.fontSize} < 16px (iOS will zoom): ${label(el)}`);
      }
    }
    return [...new Set(problems)];
  });
}

for (const screen of SCREENS) {
  test(`layout: ${screen.name}`, async ({ page }) => {
    if (screen.seed) await seed(page, screen.seed);
    await open(page, screen.path);
    await screen.ready(page);
    await page.evaluate(() => document.fonts.ready);
    expect(await layoutProblems(page)).toEqual([]);
    // Also check the bottom of long screens.
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    expect(await layoutProblems(page)).toEqual([]);
    await page.screenshot({ path: `test-results/safari-${screen.name}.png` });
  });
}
