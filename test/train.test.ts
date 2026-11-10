import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });

import { deckFrom, MAX_KNOWN_ARTISTS, type TrainData } from "../src/train.js";

const track = (n: number, artist = `Artist ${n}`) => ({
  id: `t${n}`,
  uri: `spotify:track:t${n}`,
  artist,
  title: `Song ${n}`,
});
const pick = (t: ReturnType<typeof track>) => ({
  pick: { artist: t.artist, title: t.title, reason: "r" },
  track: t,
});
const empty: TrainData = { yes: [], no: [], playlistId: null, history: [] };

describe("deckFrom", () => {
  it("drops songs you already know (liked, top, recently played)", () => {
    const cards = deckFrom([pick(track(1)), pick(track(2)), pick(track(3))], empty, {
      trackIds: new Set(["t2"]),
      artists: new Set(),
    });
    expect(cards.map((c) => c.track.id)).toEqual(["t1", "t3"]);
  });

  it(`allows at most ${MAX_KNOWN_ARTISTS} songs by artists you already know`, () => {
    const familiar = [1, 2, 3, 4, 5].map((n) => pick(track(n, "Killer Mike")));
    const fresh = [6, 7].map((n) => pick(track(n)));
    const cards = deckFrom([...familiar, ...fresh], empty, {
      trackIds: new Set(),
      artists: new Set(["killer mike"]),
    });
    expect(cards.filter((c) => c.track.artist === "Killer Mike")).toHaveLength(MAX_KNOWN_ARTISTS);
    expect(cards.map((c) => c.track.id)).toContain("t6");
    expect(cards.map((c) => c.track.id)).toContain("t7");
  });

  it("never brings back a song you already judged, or a missing one", () => {
    const judged: TrainData = { ...empty, no: [{ artist: "Artist 1", title: "Song 1" }] };
    const cards = deckFrom(
      [pick(track(1)), { pick: { artist: "X", title: "Y", reason: "" }, track: null }, pick(track(2))],
      judged,
    );
    expect(cards.map((c) => c.track.id)).toEqual(["t2"]);
  });
});
