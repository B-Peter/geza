// Learning from Spotify, run when the app opens and before each swap: new
// plays, hearts, and your own edits to the mix playlists.

import { loadLastPlayedAt, loadLedger, type Play, saveLastPlayedAt, saveLedger, syncMix } from "./ledger.js";
import type { Mix } from "./mixes.js";
import * as spotify from "./spotify.js";
import { addBlocked } from "./swap.js";

export interface LearnSummary {
  plays: number;
  liked: number;
  removedByYou: number;
  addedByYou: number;
  /** False when more plays happened than Spotify keeps (last 50). */
  complete: boolean;
  at: number;
}

/** Returns the mixes with updated locks and never-again lists, and what changed. */
export async function learnFromSpotify(mixes: Mix[]): Promise<{ mixes: Mix[]; summary: LearnSummary }> {
  const now = Date.now();
  const lastPlayedAt = await loadLastPlayedAt();
  const recent = await spotify.getRecentlyPlayed(lastPlayedAt);
  const plays: Play[] = recent.plays.filter((p) => lastPlayedAt === null || p.playedAt > lastPlayedAt);

  const summary: LearnSummary = {
    plays: 0,
    liked: 0,
    removedByYou: 0,
    addedByYou: 0,
    complete: recent.complete,
    at: now,
  };
  const out: Mix[] = [];
  for (const mix of mixes) {
    if (!mix.playlistId) {
      out.push(mix);
      continue;
    }
    let current: spotify.Track[];
    try {
      current = await spotify.getPlaylistTracks(mix.playlistId);
    } catch {
      // Playlist gone or unreadable: leave this mix as it is for now.
      out.push(mix);
      continue;
    }
    // Hearts are a bonus signal: if Spotify won't say, keep the old ones.
    const liked = await spotify.likedAmong(current.map((t) => t.id)).catch(() => null);
    const ledger = await loadLedger(mix.id);
    const before = Object.values(ledger.entries).reduce((n, e) => n + e.plays, 0);
    const result = syncMix(ledger, { now, current, plays, liked, locked: mix.locked });
    await saveLedger(mix.id, result.ledger);

    const after = Object.values(result.ledger.entries).reduce((n, e) => n + e.plays, 0);
    summary.plays += after - before;
    summary.liked += liked ? current.filter((t) => liked.has(t.id)).length : 0;
    summary.removedByYou += result.block.length;
    summary.addedByYou +=
      result.ledger.known && ledger.known ? result.lock.filter((t) => !liked?.has(t.id)).length : 0;

    const unlockIds = new Set(result.unlock.map((t) => t.id));
    const locked = [...mix.locked.filter((t) => !unlockIds.has(t.id)), ...result.lock];
    out.push({ ...mix, locked, blocked: addBlocked(mix.blocked, result.block) });
  }

  const newest = Math.max(lastPlayedAt ?? 0, ...plays.map((p) => p.playedAt));
  if (newest > 0) await saveLastPlayedAt(newest);
  return { mixes: out, summary };
}
