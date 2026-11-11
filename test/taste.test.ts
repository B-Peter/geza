import { describe, expect, it } from "vitest";
import {
  agedWeight,
  buildTaste,
  decade,
  explain,
  HALF_LIFE_MS,
  type Judgement,
  MIN_JUDGED,
  weight,
} from "../src/taste.js";

const NOW = Date.now();
let n = 0;
const j = (verdict: Judgement["verdict"], over: Partial<Judgement> = {}): Judgement => ({
  artist: `Artist ${++n}`,
  title: `Song ${n}`,
  verdict,
  tags: [],
  dwellMs: 10_000,
  at: NOW,
  ...over,
});

describe("weight", () => {
  it("counts quick no's hardest, late no's least, and ignores later", () => {
    expect(weight({ verdict: "no", dwellMs: 2_000 })).toBe(-1.5);
    expect(weight({ verdict: "no", dwellMs: 10_000 })).toBe(-1);
    expect(weight({ verdict: "no", dwellMs: 40_000 })).toBe(-0.6);
    expect(weight({ verdict: "yes", dwellMs: 5_000 })).toBe(1);
    expect(weight({ verdict: "yes", dwellMs: 25_000 })).toBe(1.3);
    expect(weight({ verdict: "later", dwellMs: 1_000 })).toBe(0);
  });
});

describe("buildTaste", () => {
  it("says nothing until there are a few decisions", () => {
    const p = buildTaste([j("yes", { tags: ["rock"] }), j("later"), j("later"), j("later")]);
    expect(p.judged).toBe(1);
    expect(p.judged).toBeLessThan(MIN_JUDGED);
    expect(p.liked_tags).toEqual([]);
  });

  it("learns liked and disliked tags, eras and artists", () => {
    const p = buildTaste([
      j("yes", { tags: ["Indie Rock", "driving"], year: 1997, artist: "Fifth Gear" }),
      j("yes", { tags: ["indie rock", "driving"], year: 1994, artist: "Fifth Gear" }),
      j("no", { tags: ["ballad"], year: 2021, dwellMs: 3_000 }),
      j("no", { tags: ["ballad", "slow"], year: 2023, dwellMs: 4_000 }),
      j("no", { tags: ["ballad"], year: 2022, dwellMs: 4_000 }),
    ]);
    expect(p.liked_tags[0]).toBe("indie rock");
    expect(p.liked_tags).toContain("driving");
    expect(p.disliked_tags[0]).toBe("ballad");
    expect(p.liked_eras).toEqual(["1990s"]);
    expect(p.disliked_eras).toEqual(["2020s"]);
    expect(p.liked_artists).toEqual(["Fifth Gear"]);
  });

  it("needs three no's before a label is avoided: two could be the songs, not the genre", () => {
    const two = [j("no", { tags: ["jazz"] }), j("no", { tags: ["jazz"] }), j("yes", { tags: ["rock"] })];
    expect(buildTaste(two).disliked_tags).toEqual([]);
    expect(buildTaste([...two, j("no", { tags: ["jazz"] })]).disliked_tags).toEqual(["jazz"]);
  });

  it("keeps a no to the genre that fills most of the decks", () => {
    const hipHop = [1, 2, 3, 4, 5, 6, 7].map(() => j("no", { tags: ["hip hop"] }));
    const other = [1, 2].map(() => j("yes", { tags: ["soul"] }));
    const p = buildTaste([...hipHop, ...other]);
    expect(p.disliked_tags).toEqual(["hip hop"]);
    expect(p.liked_tags).toEqual(["soul"]);
  });

  it("a quick no outweighs a hesitant yes", () => {
    const p = buildTaste([
      j("yes", { tags: ["synth"], dwellMs: 8_000 }),
      j("no", { tags: ["synth"], dwellMs: 2_000 }),
      j("no", { tags: ["other"] }),
    ]);
    expect(p.disliked_tags).not.toContain("synth"); // -0.5 is not a clear dislike
    expect(p.liked_tags).not.toContain("synth");
  });

  it("detects a dislike of explicit lyrics only with enough evidence", () => {
    const explicitNo = [1, 2, 3].map(() => j("no", { explicit: true }));
    const cleanYes = [1, 2, 3].map(() => j("yes", { explicit: false }));
    expect(buildTaste([...explicitNo, ...cleanYes]).explicit).toBe("avoid");
    expect(buildTaste([...explicitNo.slice(0, 2), ...cleanYes]).explicit).toBe("unknown");
    const explicitYes = [1, 2, 3].map(() => j("yes", { explicit: true }));
    expect(buildTaste([...explicitYes, ...cleanYes]).explicit).toBe("fine");
  });

  it("notices a preference for shorter songs and lesser-known ones", () => {
    const yes = [1, 2, 3].map(() => j("yes", { durationMs: 150_000, popularity: 30 }));
    const no = [1, 2, 3].map(() => j("no", { durationMs: 300_000, popularity: 80 }));
    const p = buildTaste([...yes, ...no]);
    expect(p.length).toBe("shorter");
    expect(p.popularity).toBe("lesser-known");
  });

  it("learns countries only from a clear pattern", () => {
    const fromHu = [1, 2, 3].map(() => j("yes", { country: "HU" }));
    const fromUs = [j("no", { country: "US" })];
    const p = buildTaste([...fromHu, ...fromUs]);
    expect(p.liked_countries).toEqual(["HU"]);
    expect(p.disliked_countries).toEqual([]); // one song isn't a pattern
  });

  it("names decades", () => {
    expect(decade(1997)).toBe("1990s");
    expect(decade(2000)).toBe("2000s");
  });
});

describe("normalised, fading taste", () => {
  it("needs two swipes before a label counts", () => {
    const p = buildTaste([
      j("yes", { tags: ["once"] }),
      j("yes", { tags: ["twice"] }),
      j("yes", { tags: ["twice"] }),
    ]);
    expect(p.liked_tags).toEqual(["twice"]);
  });

  it("does not let a label on most songs stand for taste", () => {
    const every = [1, 2, 3, 4, 5, 6].map((i) =>
      j(i % 2 ? "yes" : "no", { tags: ["rock", i % 2 ? "shoegaze" : "ballad"] }),
    );
    const p = buildTaste(every);
    expect(p.liked_tags).toEqual(["shoegaze"]);
    expect(p.disliked_tags).toEqual(["ballad"]);
  });

  it("scores by preference, not volume: 3 yes of 3 beats 4 yes of 7", () => {
    const steady = [1, 2, 3].map(() => j("yes", { tags: ["steady"] }));
    const mixed = [1, 2, 3, 4, 5, 6, 7].map((i) => j(i <= 4 ? "yes" : "no", { tags: ["mixed"] }));
    const dims = explain([...steady, ...mixed]);
    const score = (k: string) => dims.tag.find((s) => s.key === k)?.score ?? 0;
    expect(score("steady")).toBeGreaterThan(score("mixed"));
  });

  it("fades old swipes: half after the half-life", () => {
    const fresh = { verdict: "yes" as const, dwellMs: 0, at: NOW };
    expect(agedWeight(fresh, NOW)).toBe(1);
    expect(agedWeight({ ...fresh, at: NOW - HALF_LIFE_MS }, NOW)).toBeCloseTo(0.5);
    const old = [1, 2, 3].map(() => j("no", { tags: ["disco"], at: NOW - 6 * HALF_LIFE_MS }));
    const recent = [1, 2].map(() => j("yes", { tags: ["disco"] }));
    const others = [1, 2, 3, 4, 5].map(() => j("no", { tags: ["polka"] }));
    expect(buildTaste([...old, ...recent, ...others]).liked_tags).toContain("disco");
  });

  it("counts MusicBrainz genres more than Claude's tags", () => {
    const h = [1, 2].map(() => j("yes", { tags: ["claude", "mb"], genres: ["mb"] }));
    const dims = explain([...h, j("no", { tags: ["other"] })]);
    const score = (k: string) => dims.tag.find((s) => s.key === k)?.score ?? 0;
    expect(score("mb")).toBeCloseTo(score("claude") * 1.5);
  });

  it("leaves out what you muted, and explains the rest with songs", () => {
    const h = [1, 2].map((i) => j("yes", { tags: ["folk"], artist: "A", title: `S${i}` }));
    expect(buildTaste([...h, j("no")], { muted: ["tag:folk"] }).liked_tags).toEqual([]);
    const folk = explain(h).tag.find((s) => s.key === "folk");
    expect(folk).toMatchObject({ count: 2, songs: ["A – S1", "A – S2"] });
  });
});
