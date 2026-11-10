import { describe, expect, it } from "vitest";
import { gezaSays } from "../src/geza/say.js";
import { GLOW, H, LEVELS, sprite, W } from "../src/geza/sprite.js";
import { levelFor, xpFrom } from "../src/geza/xp.js";
import { buildTaste, type Judgement } from "../src/taste.js";

describe("levels", () => {
  it("adds up swipes, plays and hearts", () => {
    expect(xpFrom({ swipes: 10, plays: 5, hearts: 2 })).toBe(17);
  });

  it("finds the level and progress for any XP", () => {
    expect(levelFor(0)).toMatchObject({ level: { n: 1 }, next: { n: 2 }, progress: 0 });
    expect(levelFor(24).level.n).toBe(1);
    expect(levelFor(25).level.n).toBe(2);
    expect(levelFor(200)).toMatchObject({ level: { n: 3 }, next: { n: 4, from: 300 }, progress: 0.5 });
    expect(levelFor(10_000)).toMatchObject({ level: { n: 5 }, next: null, progress: 1 });
  });

  it("has five levels with rising thresholds", () => {
    expect(LEVELS.map((l) => l.from)).toEqual([0, 25, 100, 300, 750]);
  });
});

describe("sprite", () => {
  it("is a 20 x 24 grid for every level, and each level looks different", () => {
    const drawn = LEVELS.map((l) => sprite(l.n));
    for (const g of drawn) {
      expect(g).toHaveLength(H);
      for (const row of g) expect(row).toHaveLength(W);
    }
    const keys = new Set(drawn.map((g) => JSON.stringify(g)));
    expect(keys.size).toBe(5);
  });

  it("glows more as he levels up", () => {
    const glow = (n: number) =>
      sprite(n)
        .flat()
        .filter((c) => c && GLOW.has(c)).length;
    expect(glow(5)).toBeGreaterThan(glow(1));
    expect(glow(4)).toBeGreaterThan(glow(2));
  });
});

describe("what Géza says", () => {
  const j = (verdict: Judgement["verdict"], tags: string[], dwellMs = 3_000): Judgement => ({
    artist: `A${Math.random()}`,
    title: "S",
    verdict,
    tags,
    dwellMs,
    at: 0,
  });

  it("mentions something he actually learned", () => {
    const taste = buildTaste([j("no", ["ballad"]), j("no", ["ballad"]), j("yes", ["indie rock"], 10_000)]);
    expect(gezaSays(levelFor(30), taste)).toBe("You drop ballad fast. Noted: fewer of those.");
  });

  it("nudges new users towards Train, then counts down to the next level", () => {
    expect(gezaSays(levelFor(0), null)).toMatch(/Train/);
    expect(gezaSays(levelFor(90), null)).toBe(
      "10 more to Signal Hacker. Every swipe, play and heart counts.",
    );
    expect(gezaSays(levelFor(900), null)).toMatch(/inside out/);
  });
});
