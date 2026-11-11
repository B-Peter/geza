// Decks prepared ahead of time, so Start and New deck don't wait for Claude:
// one is built when the app opens, the next one while you swipe. A finished
// deck is also kept on the device, so it is still there after the app was
// closed, and a deck you left halfway is picked up where you stopped.

import * as store from "./store.js";
import { songKey } from "./text.js";
import { buildDeck, type Card, type Deck, type TrainData } from "./train.js";

const KEY = "deck.ready.3";
// Decks saved before the genre cap could be all one genre: drop them.
for (const old of ["deck.ready", "deck.ready.2"]) void store.remove(old).catch(() => {});
/** A saved deck with fewer unjudged songs than this isn't worth starting. */
export const MIN_SAVED = 3;
const MAX_AGE_MS = 30 * 24 * 3_600_000;

type Saved = Omit<Deck, "rest">;

let next: Promise<Deck> | null = null;
/** What the build in progress is doing right now, for anyone waiting on it. */
let stage = "";
let watchers: ((m: string) => void)[] = [];

const report = (m: string) => {
  stage = m;
  for (const w of watchers) w(m);
};

/**
 * The deck kept on the device, without the songs judged since. Null when
 * there is none, it's the deck being played (`not`), or too little is left.
 */
async function saved(data: TrainData, not?: number): Promise<Deck | null> {
  const deck = await store.get<Saved>(KEY).catch(() => undefined);
  if (!deck || deck.at === not || Date.now() - deck.at > MAX_AGE_MS) return null;
  const judged = new Set([...data.history, ...data.yes, ...data.no].map((s) => songKey(s.artist, s.title)));
  const cards = deck.cards.filter((c) => !judged.has(songKey(c.track.artist, c.track.title)));
  return cards.length >= MIN_SAVED ? { ...deck, cards } : null;
}

/** Build a deck and, once it is complete, keep it on the device. */
async function build(data: TrainData, onProgress: (m: string) => void, avoid: Card[] = []): Promise<Deck> {
  const deck = await buildDeck(data, onProgress, avoid);
  void (deck.rest ?? Promise.resolve([]))
    .then((rest) => {
      const whole: Saved = {
        at: deck.at,
        cards: [...deck.cards, ...rest],
        asked: deck.asked,
        found: deck.found,
        ms: deck.ms,
      };
      return store.set(KEY, whole);
    })
    .catch(() => {});
  return deck;
}

/**
 * Get a deck ready in the background, unless one already is: the saved one
 * if it's still good, else a new one. While a deck is being played, pass it
 * as `playing`: the next deck then avoids its remaining songs.
 */
export function prefetchDeck(data: TrainData, playing?: { at: number; cards: Card[] }): void {
  if (next) return;
  stage = "";
  next = (async () => (await saved(data, playing?.at)) ?? build(data, report, playing?.cards))();
  // A failed prefetch is forgotten; Start then builds one in the open.
  next.catch(() => {
    next = null;
  });
}

/**
 * The prepared deck if there is one (waiting for it if it's still on its
 * way), else the saved one, else a fresh one. The prepared deck is used up.
 */
export async function takeDeck(data: TrainData, onProgress: (m: string) => void): Promise<Deck> {
  const ready = next;
  next = null;
  if (ready) {
    if (stage) onProgress(stage);
    watchers.push(onProgress);
    try {
      return await ready;
    } catch {
      // Fall through and try again in the open.
    } finally {
      watchers = watchers.filter((w) => w !== onProgress);
    }
  }
  return (await saved(data)) ?? build(data, onProgress);
}

/** Forget the prepared and the saved deck (on log out). */
export async function forgetDecks(): Promise<void> {
  resetDeckCache();
  await store.remove(KEY);
}

/** For tests: forget any prepared deck. */
export function resetDeckCache(): void {
  next = null;
  stage = "";
  watchers = [];
}
