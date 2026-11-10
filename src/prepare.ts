// The core loop: Claude picks → Spotify search → pending swap → apply.

import { type CurateInput, curate, type Pick } from "./claude.js";
import {
  clearPending,
  loadSnapshots,
  type Mix,
  type PendingSwap,
  popSnapshot,
  pushSnapshot,
  savePending,
} from "./mixes.js";
import type { Profile, Track } from "./spotify.js";
import * as spotify from "./spotify.js";
import {
  addBlocked,
  applySwap,
  balance,
  filterAdditions,
  matchRemovals,
  type Resolved,
  swapCounts,
  unblock,
} from "./swap.js";

const ref = (t: { artist: string; title: string }) => ({ artist: t.artist, title: t.title });

/**
 * Create a private Spotify playlist for each mix that doesn't have one yet.
 * Saves after each one, so a failure halfway doesn't orphan playlists.
 */
export async function ensurePlaylists(
  mixes: Mix[],
  profile: Profile,
  save: (mixes: Mix[]) => Promise<void>,
): Promise<void> {
  let out = [...mixes];
  for (const mix of mixes) {
    if (mix.playlistId) continue;
    const playlist = await spotify.createPlaylist(
      profile.id,
      mix.playlistName,
      `${mix.name} mix, refreshed weekly by Géza.`,
    );
    out = out.map((m) => (m.id === mix.id ? { ...m, playlistId: playlist.id } : m));
    await save(out);
  }
}

/** Look up each pick on Spotify, four at a time (gentle on rate limits). */
export async function resolveAll(picks: Pick[]): Promise<Resolved[]> {
  const out: Resolved[] = new Array(picks.length);
  let next = 0;
  const worker = async () => {
    while (next < picks.length) {
      const i = next++;
      const pick = picks[i];
      if (pick) out[i] = { pick, track: await spotify.findTrack(pick.artist, pick.title) };
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

function uniqueRefs(tracks: Track[], max: number) {
  const seen = new Set<string>();
  const out: { artist: string; title: string }[] = [];
  for (const t of tracks) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(ref(t));
    if (out.length >= max) break;
  }
  return out;
}

export type Progress = (message: string) => void;

/** Ask Claude for this week's changes and resolve them on Spotify. */
export async function prepareSwap(mix: Mix, onProgress: Progress = () => {}): Promise<PendingSwap> {
  if (!mix.playlistId) throw new Error("This mix has no playlist yet.");
  onProgress("Reading the playlist…");
  const current = await spotify.getPlaylistTracks(mix.playlistId);
  const counts = swapCounts(mix, current);
  if (counts.add === 0) throw new Error(`${mix.name} is set to Keep, so there's nothing to change.`);

  onProgress("Reading your listening…");
  const [topTracks, topArtists] = await Promise.all([spotify.getTopTracks(20), spotify.getTopArtists(20)]);

  const input: CurateInput = {
    mix: mix.name,
    mode: mix.mode === "renew" ? "renew" : "tweak",
    remove_count: counts.remove,
    add_count: counts.add,
    tune: mix.tune,
    loved: uniqueRefs([...mix.locked, ...topTracks], 25),
    blocked: mix.blocked,
    locked: mix.locked.map(ref),
    current: current.map(ref),
    top_artists: topArtists,
    note: mix.note,
  };

  onProgress("Claude is picking songs…");
  const picks = await curate(input);
  const removals = matchRemovals(picks.remove, current, mix.locked, counts.remove);
  onProgress("Finding the songs on Spotify…");
  let resolved = await resolveAll(picks.add);
  let { add, missing } = filterAdditions(resolved, current, removals, mix.blocked, counts.add);
  let picked = picks.add.length;

  // One replacement round for picks that weren't found or were unusable.
  const short = counts.add - add.length;
  if (short > 0) {
    onProgress(`Asking Claude for ${short} replacement${short === 1 ? "" : "s"}…`);
    const retry = await curate({
      ...input,
      remove_count: 0,
      add_count: short,
      current: [...input.current, ...add.map((a) => ref(a.track))],
      blocked: [...input.blocked, ...missing.map(ref)],
    });
    resolved = await resolveAll(retry.add);
    picked += retry.add.length;
    const more = filterAdditions(
      resolved,
      [...current, ...add.map((a) => a.track)],
      removals,
      mix.blocked,
      short,
    );
    add = [...add, ...more.add];
    missing = [...missing, ...more.missing];
  }

  if (add.length === 0) throw new Error("None of Claude's picks could be used. Try again.");

  const swap: PendingSwap = {
    mixId: mix.id,
    createdAt: Date.now(),
    remove: balance(removals, add, current),
    add,
    picked,
    found: picked - missing.length,
    missing,
  };
  await savePending(swap);
  return swap;
}

/** Write the swap to Spotify. Takes a snapshot first so it can be undone. */
export async function applyPending(mix: Mix, swap: PendingSwap): Promise<Mix> {
  if (!mix.playlistId) throw new Error("This mix has no playlist yet.");
  const current = await spotify.getPlaylistTracks(mix.playlistId);
  await pushSnapshot(mix.id, current);
  await spotify.replacePlaylistTracks(
    mix.playlistId,
    applySwap(current, swap.remove, swap.add).map((t) => t.uri),
  );
  await clearPending(mix.id);
  return {
    ...mix,
    lastAppliedAt: Date.now(),
    // Removed songs are never suggested again.
    blocked: addBlocked(
      mix.blocked,
      swap.remove.map((r) => r.track),
    ),
  };
}

/**
 * Put the playlist back the way it was before the last swap. Returns the
 * updated mix, or null when there is nothing to undo.
 */
export async function undoLastSwap(mix: Mix): Promise<Mix | null> {
  if (!mix.playlistId) return null;
  const [last] = await loadSnapshots(mix.id);
  if (!last) return null;
  await spotify.replacePlaylistTracks(
    mix.playlistId,
    last.tracks.map((t) => t.uri),
  );
  // Only forget the snapshot once Spotify has the old list back.
  await popSnapshot(mix.id);
  // Songs that came back must not stay on the never-again list.
  return { ...mix, blocked: unblock(mix.blocked, last.tracks) };
}
