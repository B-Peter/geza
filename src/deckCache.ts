// Decks prepared ahead of time, so Start and New deck are usually instant:
// one is built when Train opens, the next one while you swipe. Lives for the
// app session (memory only).

import { buildDeck, type Deck, type TrainData } from "./train.js";

let next: Promise<Deck> | null = null;

/** Start building a deck in the background, unless one is already coming. */
export function prefetchDeck(data: TrainData): void {
  if (next) return;
  next = buildDeck(data);
  // A failed prefetch is forgotten; Start then builds one in the open.
  next.catch(() => {
    next = null;
  });
}

/**
 * The prepared deck if there is one (waiting for it if it's still on its
 * way), else a fresh one. Either way, the prepared deck is used up.
 */
export async function takeDeck(data: TrainData, onProgress: (m: string) => void): Promise<Deck> {
  const ready = next;
  next = null;
  if (ready) {
    onProgress("Claude is picking artists to discover…");
    try {
      return await ready;
    } catch {
      // Fall through and try again in the open.
    }
  }
  return buildDeck(data, onProgress);
}

/** For tests: forget any prepared deck. */
export function resetDeckCache(): void {
  next = null;
}
