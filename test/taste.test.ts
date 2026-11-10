import { describe, expect, it } from "vitest";
import { buildTaste, decade, type Judgement, MIN_JUDGED, weight } from "../src/taste.js";

let n = 0;
const j = (verdict: Judgement["verdict"], over: Partial<Judgement> = {}): Judgement => ({
  artist: `Artist ${++n}`,
  title: `Song ${n}`,
  verdict,
  tags: [],
  dwellMs: 10_000,
  at: n,
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
      j("yes", { tags: ["indie rock"], year: 1994, artist: "Fifth Gear" }),
      j("no", { tags: ["ballad"], year: 2021, dwellMs: 3_000 }),
      j("no", { tags: ["ballad", "slow"], year: 2023, dwellMs: 4_000 }),
    ]);
    expect(p.liked_tags[0]).toBe("indie rock");
    expect(p.liked_tags).toContain("driving");
    expect(p.disliked_tags[0]).toBe("ballad");
    expect(p.liked_eras).toEqual(["1990s"]);
    expect(p.disliked_eras).toEqual(["2020s"]);
    expect(p.liked_artists).toEqual(["Fifth Gear"]);
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

  it("names decades", () => {
    expect(decade(1997)).toBe("1990s");
    expect(decade(2000)).toBe("2000s");
  });
});
