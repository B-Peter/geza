import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });

// The device's storage, as a plain map.
const kept = new Map<string, unknown>();
vi.mock("../src/store.js", () => ({
  get: async (key: string) => kept.get(key),
  set: async (key: string, value: unknown) => void kept.set(key, value),
  remove: async (key: string) => void kept.delete(key),
}));

const buildDeck = vi.fn();
vi.mock("../src/train.js", () => ({ buildDeck: (...args: unknown[]) => buildDeck(...args) }));

import { forgetDecks, prefetchDeck, resetDeckCache, takeDeck } from "../src/deckCache.js";
import type { Card, Deck, TrainData } from "../src/train.js";

const card = (n: number, deck: number): Card => ({
  track: { id: `t${n}`, uri: `spotify:track:t${n}`, artist: `Artist ${n}`, title: `Song ${n}` },
  reason: "r",
  tags: [],
  deck,
});
const ms = { listening: 0, claude: 0, spotify: 0, total: 0 };
const deckOf = (at: number, numbers: number[]): Deck => ({
  at,
  cards: numbers.map((n) => card(n, at)),
  asked: numbers.length,
  found: numbers.length,
  ms,
});
const empty: TrainData = { yes: [], no: [], playlistId: null, history: [] };
const judged = (numbers: number[]): TrainData => ({
  ...empty,
  history: numbers.map((n) => ({
    artist: `Artist ${n}`,
    title: `Song ${n}`,
    verdict: "later" as const,
    tags: [],
    dwellMs: 0,
    at: 0,
  })),
});
const ids = (deck: Deck) => deck.cards.map((c) => c.track.id);
/** Let the background save (after a build) finish. */
const settle = () => new Promise((r) => setTimeout(r, 0));
const now = Date.now();

beforeEach(async () => {
  await forgetDecks();
  buildDeck.mockReset();
});

describe("deck cache", () => {
  it("keeps a finished deck on the device: after a restart, Start doesn't build one", async () => {
    // The deck starts with its first cards; the rest follows.
    buildDeck.mockResolvedValueOnce({ ...deckOf(now, [1, 2, 3]), rest: Promise.resolve([card(4, now)]) });
    prefetchDeck(empty);
    await settle();
    // The app was closed and opened again: nothing in memory.
    resetDeckCache();
    const deck = await takeDeck(empty, () => {});
    expect(ids(deck)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(deck.rest).toBeUndefined();
    expect(buildDeck).toHaveBeenCalledTimes(1);
  });

  it("picks a half-played deck up where you stopped", async () => {
    buildDeck.mockResolvedValueOnce(deckOf(now, [1, 2, 3, 4, 5, 6]));
    expect(ids(await takeDeck(empty, () => {}))).toHaveLength(6);
    await settle();
    resetDeckCache();
    // Songs 1 and 2 were swiped before leaving.
    expect(ids(await takeDeck(judged([1, 2]), () => {}))).toEqual(["t3", "t4", "t5", "t6"]);
    expect(buildDeck).toHaveBeenCalledTimes(1);
  });

  it("builds a new deck when too little of the saved one is left", async () => {
    buildDeck.mockResolvedValueOnce(deckOf(now, [1, 2, 3, 4]));
    await takeDeck(empty, () => {});
    await settle();
    resetDeckCache();
    buildDeck.mockResolvedValueOnce(deckOf(now + 1, [7, 8, 9]));
    expect(ids(await takeDeck(judged([1, 2]), () => {}))).toEqual(["t7", "t8", "t9"]);
  });

  it("near the end of a deck, prepares a different one that avoids the songs still waiting", async () => {
    const playing = deckOf(now, [1, 2, 3, 4, 5]);
    buildDeck.mockResolvedValueOnce(playing);
    await takeDeck(empty, () => {});
    await settle();
    const next = deckOf(now + 1, [7, 8, 9]);
    buildDeck.mockResolvedValueOnce(next);
    const waiting = playing.cards.slice(2);
    prefetchDeck(judged([1, 2]), { at: playing.at, cards: waiting });
    // Asking twice doesn't build twice.
    prefetchDeck(judged([1, 2]), { at: playing.at, cards: waiting });
    await settle();
    expect(buildDeck).toHaveBeenCalledTimes(2);
    expect(buildDeck.mock.calls[1]?.[2]).toEqual(waiting);
    expect(ids(await takeDeck(judged([1, 2, 3, 4, 5]), () => {}))).toEqual(["t7", "t8", "t9"]);
  });
});
