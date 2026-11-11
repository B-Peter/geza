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

import { chooseTrack, deckFromArtists, deckOutcome } from "../src/train.js";

const top = (artist: string, titles: string[], pop = 50) =>
  titles.map((title, i) => ({
    id: `${artist}-${i}`,
    uri: `spotify:track:${artist}-${i}`,
    artist,
    title,
    durationMs: 200_000,
    popularity: pop - i * 5,
  }));
const artist = (name: string, want: "hit" | "deep cut" | "any" = "hit") => ({
  artist: name,
  want,
  reason: "r",
  tags: ["indie"],
});
const all = () => true;

describe("chooseTrack", () => {
  it("introduces a new artist with their biggest usable song", () => {
    const t = chooseTrack(artist("A"), top("A", ["Hit", "Second", "Third"]), all);
    expect(t?.title).toBe("Hit");
  });
  it("skips songs you know and side versions, and very short tracks", () => {
    const tracks = [
      ...top("A", ["Hit", "Hit - Live", "Hit (Remix)"]),
      ...top("A", ["Interlude"]).map((t) => ({ ...t, id: "short", durationMs: 40_000 })),
      ...top("A", ["Fourth"]),
    ];
    const t = chooseTrack(artist("A"), tracks, (x) => x.title !== "Hit");
    expect(t?.title).toBe("Fourth");
  });
  it("gives a familiar artist a deep cut: below the top three, least popular", () => {
    const t = chooseTrack(artist("A", "deep cut"), top("A", ["1", "2", "3", "4", "5", "6"]), all);
    expect(t?.title).toBe("6");
  });
  it("returns null when nothing is usable", () => {
    expect(chooseTrack(artist("A"), top("A", ["Hit"]), () => false)).toBeNull();
  });
});

describe("deckFromArtists", () => {
  it("deals one song per artist in Claude's order, skipping artists Spotify lacks", () => {
    const cards = deckFromArtists(
      [
        { pick: artist("A"), tracks: top("A", ["A1", "A2"]) },
        { pick: artist("Ghost"), tracks: [] },
        { pick: artist("B"), tracks: top("B", ["B1"]) },
      ],
      empty,
      { trackIds: new Set(), artists: new Set() },
    );
    expect(cards.map((c) => c.track.title)).toEqual(["A1", "B1"]);
    expect(cards[0]).toMatchObject({ reason: "r", tags: ["indie"] });
  });
  it("never deals a judged or known song, and caps familiar artists", () => {
    const judged: TrainData = { ...empty, no: [{ artist: "A", title: "A1" }] };
    const familiar = ["K1", "K2", "K3", "K4"].map((k) => ({
      pick: artist(k, "deep cut"),
      tracks: top(k, ["x", "y"]),
    }));
    const cards = deckFromArtists(
      [{ pick: artist("A"), tracks: top("A", ["A1", "A2"]) }, ...familiar],
      judged,
      { trackIds: new Set(["A-1"]), artists: new Set(["k1", "k2", "k3", "k4"]) },
    );
    // A1 judged, A2 known → nothing from A; only MAX_KNOWN_ARTISTS familiar ones.
    expect(cards.map((c) => c.track.artist)).toEqual(["K1", "K2", "K3"]);
  });
});

describe("deckFromArtists, adding to a deck", () => {
  const known = { trackIds: new Set<string>(), artists: new Set(["k1", "k2", "k3", "k4"]) };
  const deal = (name: string, want: "hit" | "deep cut" = "hit") => ({
    pick: artist(name, want),
    tracks: top(name, ["x", "y"]),
  });
  it("returns only new cards: no artist twice, the familiar cap counts across the whole deck", () => {
    const have = deckFromArtists([deal("A"), deal("K1"), deal("K2")], empty, known);
    expect(have.map((c) => c.track.artist)).toEqual(["A", "K1", "K2"]);
    const more = deckFromArtists([deal("A"), deal("K3"), deal("K4"), deal("B")], empty, known, have);
    // A is already in the deck; K3 is the third (and last) familiar artist.
    expect(more.map((c) => c.track.artist)).toEqual(["K3", "B"]);
  });
  it("stops when the deck is full", () => {
    const have = deckFromArtists(
      Array.from({ length: 20 }, (_, i) => deal(`N${i}`)),
      empty,
      known,
    );
    expect(have).toHaveLength(15);
    expect(deckFromArtists([deal("Z")], empty, known, have)).toEqual([]);
  });
});

describe("deckOutcome", () => {
  it("counts the verdicts of one deck only", () => {
    const h = (verdict: "yes" | "no" | "later", deck: number) => ({
      artist: "a",
      title: "t",
      verdict,
      tags: [],
      dwellMs: 0,
      at: 0,
      deck,
    });
    const data: TrainData = { ...empty, history: [h("yes", 1), h("no", 1), h("later", 1), h("yes", 2)] };
    expect(deckOutcome(data, 1)).toEqual({ yes: 1, no: 1, later: 1 });
  });
});

describe("recentGenres", () => {
  it("counts the first tag of the latest cards, most frequent first", async () => {
    const { recentGenres } = await import("../src/train.js");
    const history = [
      { tags: ["Hip Hop", "driving"] },
      { tags: ["hip hop", "mellow"] },
      { tags: ["jazz", "mellow"] },
      { tags: [] },
    ];
    expect(recentGenres(history)).toEqual([
      { genre: "hip hop", cards: 2 },
      { genre: "jazz", cards: 1 },
    ]);
  });
});
