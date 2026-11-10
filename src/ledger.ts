// The ledger: what Géza has learned about each song in each mix, from what
// you do in Spotify. Pure functions here; storage at the bottom.
//
//   Heart a song                 +2, and it's locked (kept) while liked
//   A play of a song in the mix  +1 per play
//   Never played after a week    -0.5 (applied when scoring, not stored)
//   You add a song in Spotify    +2, and it's locked
//   You remove a song in Spotify -3, and it's never suggested again

import type { MixId } from "./mixes.js";
import type { Track } from "./spotify.js";
import * as store from "./store.js";

export const SCORE = { like: 2, play: 1, userAdd: 2, userRemove: -3, neverPlayed: -0.5 } as const;
export const NEVER_PLAYED_AFTER_MS = 7 * 24 * 3600 * 1000;

export interface Entry {
  score: number;
  plays: number;
  liked: boolean;
  /** Locked by Géza because it was liked or added by you (not by your own tap). */
  autoLocked: boolean;
  firstSeen: number;
  lastPlayed: number | null;
}

export interface MixLedger {
  /** The playlist as Géza last saw or wrote it; null before the first sync. */
  known: Track[] | null;
  entries: Record<string, Entry>;
}

export interface Play {
  trackId: string;
  playedAt: number;
}

export interface SyncInput {
  now: number;
  /** The playlist as it is in Spotify right now. */
  current: Track[];
  /** Plays since the last sync (any order). */
  plays: Play[];
  /** IDs of songs in the playlist that are in your Liked Songs; null if unknown. */
  liked: Set<string> | null;
  /** Songs you locked yourself (never auto-unlocked). */
  locked: Track[];
}

export interface SyncResult {
  ledger: MixLedger;
  /** Removed by you in Spotify: never suggest again. */
  block: Track[];
  /** Liked or added by you: keep. */
  lock: Track[];
  /** Was auto-locked because liked, now unliked: unlock. */
  unlock: Track[];
}

export const emptyLedger = (): MixLedger => ({ known: null, entries: {} });

const fresh = (now: number): Entry => ({
  score: 0,
  plays: 0,
  liked: false,
  autoLocked: false,
  firstSeen: now,
  lastPlayed: null,
});

/** Fold what happened in Spotify since the last sync into the ledger. */
export function syncMix(ledger: MixLedger, input: SyncInput): SyncResult {
  const { now, current, plays, liked, locked } = input;
  const entries: Record<string, Entry> = {};
  for (const [id, e] of Object.entries(ledger.entries)) entries[id] = { ...e };
  const entry = (id: string) => {
    entries[id] ??= fresh(now);
    return entries[id];
  };
  const block: Track[] = [];
  const lock: Track[] = [];
  const unlock: Track[] = [];
  const lockedIds = new Set(locked.map((t) => t.id));
  const currentIds = new Set(current.map((t) => t.id));

  // Your own edits in Spotify, found by comparing with what Géza last saw.
  if (ledger.known) {
    const knownIds = new Set(ledger.known.map((t) => t.id));
    for (const t of ledger.known) {
      if (currentIds.has(t.id)) continue;
      entry(t.id).score += SCORE.userRemove;
      block.push(t);
    }
    for (const t of current) {
      if (knownIds.has(t.id)) continue;
      const e = entry(t.id);
      e.score += SCORE.userAdd;
      if (!lockedIds.has(t.id)) {
        e.autoLocked = true;
        lock.push(t);
        lockedIds.add(t.id);
      }
    }
  }
  for (const t of current) entry(t.id);

  // Plays of songs in this mix.
  for (const p of plays) {
    if (!currentIds.has(p.trackId)) continue;
    const e = entry(p.trackId);
    e.plays += 1;
    e.score += SCORE.play;
    e.lastPlayed = Math.max(e.lastPlayed ?? 0, p.playedAt);
  }

  // Hearts, counted when they change.
  if (liked) {
    for (const t of current) {
      const e = entry(t.id);
      const now_ = liked.has(t.id);
      if (now_ && !e.liked) {
        e.liked = true;
        e.score += SCORE.like;
        if (!lockedIds.has(t.id)) {
          e.autoLocked = true;
          lock.push(t);
          lockedIds.add(t.id);
        }
      } else if (!now_ && e.liked) {
        e.liked = false;
        e.score -= SCORE.like;
        if (e.autoLocked) {
          e.autoLocked = false;
          unlock.push(t);
        }
      }
    }
  }

  return { ledger: { known: current, entries }, block, lock, unlock };
}

/** Score including the never-played penalty. */
export function effectiveScore(e: Entry, now: number): number {
  const stale = !e.liked && e.plays === 0 && now - e.firstSeen > NEVER_PLAYED_AFTER_MS;
  return e.score + (stale ? SCORE.neverPlayed : 0);
}

type SongRef = { artist: string; title: string };
const ref = (t: Track): SongRef => ({ artist: t.artist, title: t.title });

/** What Claude is told about the current mix, from the ledger. */
export function signals(ledger: MixLedger, current: Track[], now: number) {
  const scored = current.map((t) => ({ t, e: ledger.entries[t.id] }));
  const neverPlayed = scored.filter(
    // A heart outranks a missing play: liked songs are never "never played".
    ({ e }) => e && !e.liked && e.plays === 0 && now - e.firstSeen > NEVER_PLAYED_AFTER_MS,
  );
  return {
    liked: scored.filter(({ e }) => e?.liked).map(({ t }) => ref(t)),
    played_often: scored
      .filter(({ e }) => (e?.plays ?? 0) >= 2)
      .sort((a, b) => (b.e?.plays ?? 0) - (a.e?.plays ?? 0))
      .map(({ t, e }) => ({ ...ref(t), plays: e?.plays ?? 0 })),
    never_played: neverPlayed.map(({ t }) => ref(t)),
    /** Lowest scores first: what to take out first. */
    remove_first: scored
      .filter(({ e }) => e && !e.liked)
      .sort((a, b) => effectiveScore(a.e as Entry, now) - effectiveScore(b.e as Entry, now))
      .slice(0, 10)
      .map(({ t }) => ref(t)),
  };
}

/** Short label for a track row, e.g. "Liked · played 3×". */
export function badge(e: Entry | undefined, now: number): string {
  if (!e) return "";
  const parts: string[] = [];
  if (e.liked) parts.push("Liked");
  if (e.plays > 0) parts.push(`played ${e.plays}×`);
  else if (!e.liked && now - e.firstSeen > NEVER_PLAYED_AFTER_MS) parts.push("not played yet");
  return parts.join(" · ");
}

// --- Storage --------------------------------------------------------------

export async function loadLedger(mixId: MixId): Promise<MixLedger> {
  return (await store.get<MixLedger>(`ledger:${mixId}`)) ?? emptyLedger();
}

export async function saveLedger(mixId: MixId, ledger: MixLedger): Promise<void> {
  await store.set(`ledger:${mixId}`, ledger);
}

/** Record what Géza itself wrote, so its own changes aren't read as yours. */
export async function setKnown(mixId: MixId, tracks: Track[]): Promise<void> {
  const ledger = await loadLedger(mixId);
  await saveLedger(mixId, { ...ledger, known: tracks });
}

/** Time of the newest play already counted (shared by all mixes). */
export async function loadLastPlayedAt(): Promise<number | null> {
  return (await store.get<number>("ledger:lastPlayedAt")) ?? null;
}

export async function saveLastPlayedAt(ms: number): Promise<void> {
  await store.set("ledger:lastPlayedAt", ms);
}
