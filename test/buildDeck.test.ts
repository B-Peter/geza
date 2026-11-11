import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });

vi.mock("../src/store.js", () => ({
  get: async () => undefined,
  set: async () => {},
  remove: async () => {},
}));

/** Lets the test hand Claude's artists over one at a time, like a stream. */
let sendArtist: ((name: string) => void) | null = null;
let endStream: () => void = () => {};
/** When set, every request to Claude fails with this message. */
let claudeError: string | null = null;
vi.mock("../src/claude.js", () => ({
  curate: async () => ({ add: [], remove: [] }),
  streamArtists: (input: { focus: string }, onPick: (p: unknown) => void) =>
    new Promise((resolve, reject) => {
      if (claudeError) return reject(new Error(claudeError));
      // Only one of the three batches answers; the others return nothing.
      if (input.focus !== "close") return resolve([]);
      sendArtist = (name) => onPick({ artist: name, want: "hit", reason: "r", tags: ["rock"] });
      endStream = () => resolve([]);
    }),
}));

vi.mock("../src/spotify.js", () => ({
  getTopTracks: async () => [],
  getTopArtists: async () => [],
  getRecentlyPlayed: async () => ({ plays: [], complete: true }),
  likedAmong: async () => new Set<string>(),
  rateLimitWaitMs: () => 0,
  SessionExpiredError: class extends Error {},
  SpotifyError: class extends Error {},
  findAll: async () => [],
  findArtist: async (name: string) => ({ id: name, name }),
  artistTopTracks: async (id: string) => [
    { id: `${id}-1`, uri: `spotify:track:${id}-1`, artist: id, title: `${id} song`, durationMs: 200_000 },
  ],
}));

import { buildDeck, type Card, type TrainData } from "../src/train.js";

const empty: TrainData = { yes: [], no: [], playlistId: null, history: [] };
const tick = () => new Promise((r) => setTimeout(r, 0));
const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await tick();
};

describe("buildDeck", () => {
  it("is ready with two cards, then hands over each further card as it is found", async () => {
    const building = buildDeck(empty);
    await waitFor(() => sendArtist !== null);
    sendArtist?.("A");
    sendArtist?.("B");
    const deck = await building;
    expect(deck.cards.map((c) => c.track.artist)).toEqual(["A", "B"]);

    const later: Card[] = [];
    deck.onCard?.((c) => later.push(c));
    sendArtist?.("C");
    await waitFor(() => later.length === 1);
    expect(later.map((c) => c.track.artist)).toEqual(["C"]);
    expect(later[0]?.deck).toBe(deck.at);
    sendArtist?.("D");
    await waitFor(() => later.length === 2);
    expect(later.map((c) => c.track.artist)).toEqual(["C", "D"]);

    endStream();
    // The whole rest still arrives too (it's what gets saved on the device).
    const rest = await deck.rest;
    expect(rest?.map((c) => c.track.artist).slice(0, 2)).toEqual(["C", "D"]);
  });

  it('says what went wrong with Claude instead of "nothing found"', async () => {
    claudeError = "Your Anthropic account is out of credit.";
    await expect(buildDeck(empty)).rejects.toThrow("Your Anthropic account is out of credit.");
    claudeError = null;
  });
});

describe("unjudge", () => {
  it("takes a swipe back off the history and its list", async () => {
    const { unjudge } = await import("../src/train.js");
    const song = { id: "s1", uri: "u:s1", artist: "A", title: "One" };
    const other = { id: "s2", uri: "u:s2", artist: "B", title: "Two" };
    const swipe = (t: typeof song, verdict: "yes" | "no") => ({
      artist: t.artist,
      title: t.title,
      verdict,
      tags: [],
      dwellMs: 0,
      at: 1,
    });
    const data = {
      yes: [other, song],
      no: [],
      playlistId: null,
      history: [swipe(other, "yes"), swipe(song, "yes")],
    };
    const next = await unjudge(data, { track: song, reason: "", tags: [] }, "yes");
    expect(next.yes).toEqual([other]);
    expect(next.history.map((j) => j.title)).toEqual(["Two"]);
  });
});
