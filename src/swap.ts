// Pure swap logic: how many songs to change, which of Claude's picks are
// usable, and the playlist that results. No network, no storage.

import type { Pick } from "./claude.js";
import type { Mix, SwapEntry } from "./mixes.js";
import { MIX_SIZE, SWAP_PCT } from "./mixes.js";
import type { Track } from "./spotify.js";
import { songKey } from "./text.js";

export interface SwapCounts {
  remove: number;
  add: number;
}

/** How many songs to take out and put in for this mix this week. */
export function swapCounts(mix: Mix, current: Track[], size = MIX_SIZE): SwapCounts {
  const deficit = Math.max(0, size - current.length);
  if (mix.mode === "keep") return { remove: 0, add: deficit };
  const lockedIds = new Set(mix.locked.map((t) => t.id));
  const swappable = current.filter((t) => !lockedIds.has(t.id)).length;
  const pct = SWAP_PCT[mix.id][mix.mode];
  const remove = Math.min(swappable, Math.round((current.length * pct) / 100));
  return { remove, add: remove + deficit };
}

const keyOf = (t: { artist: string; title: string }) => songKey(t.artist, t.title);

/** Map Claude's "remove" picks onto tracks in the mix, skipping locked and unknown songs. */
export function matchRemovals(picks: Pick[], current: Track[], locked: Track[], limit: number): SwapEntry[] {
  const byKey = new Map(current.map((t) => [keyOf(t), t]));
  const lockedIds = new Set(locked.map((t) => t.id));
  const out: SwapEntry[] = [];
  const seen = new Set<string>();
  for (const p of picks) {
    const track = byKey.get(keyOf(p));
    if (!track || lockedIds.has(track.id) || seen.has(track.id)) continue;
    seen.add(track.id);
    out.push({ track, reason: p.reason });
    if (out.length >= limit) break;
  }
  return out;
}

export interface Resolved {
  pick: Pick;
  track: Track | null;
}

/**
 * Keep picks that were found on Spotify and are new: not blocked, not
 * already in the mix (unless being removed now), no duplicates.
 */
export function filterAdditions(
  resolved: Resolved[],
  current: Track[],
  removing: SwapEntry[],
  blocked: { artist: string; title: string }[],
  limit: number,
): { add: SwapEntry[]; missing: Pick[] } {
  const removingIds = new Set(removing.map((r) => r.track.id));
  const taken = new Set(current.filter((t) => !removingIds.has(t.id)).map(keyOf));
  for (const r of removing) taken.add(keyOf(r.track));
  const blockedKeys = new Set(blocked.map(keyOf));
  const add: SwapEntry[] = [];
  const missing: Pick[] = [];
  for (const { pick, track } of resolved) {
    if (!track) {
      missing.push(pick);
      continue;
    }
    const key = keyOf(track);
    if (taken.has(key) || blockedKeys.has(key) || blockedKeys.has(keyOf(pick))) continue;
    taken.add(key);
    add.push({ track, reason: pick.reason });
    if (add.length >= limit) break;
  }
  return { add, missing };
}

/**
 * Never shrink the mix: if fewer songs could be added than planned, take
 * out fewer.
 */
export function balance(
  remove: SwapEntry[],
  add: SwapEntry[],
  current: Track[],
  size = MIX_SIZE,
): SwapEntry[] {
  const deficit = Math.max(0, size - current.length);
  const allowed = Math.max(0, add.length - deficit);
  return remove.slice(0, allowed);
}

/** The playlist after the swap: kept songs in their order, new ones appended. */
export function applySwap(current: Track[], remove: SwapEntry[], add: SwapEntry[]): Track[] {
  const out = new Set(remove.map((r) => r.track.id));
  return [...current.filter((t) => !out.has(t.id)), ...add.map((a) => a.track)];
}
