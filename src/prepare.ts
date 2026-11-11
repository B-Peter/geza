// The core loop: Claude picks → Spotify search → pending swap → apply.

import { type CurateInput, curate, type Pick } from "./claude.js";
import { loadLedger, setKnown, signals } from "./ledger.js";
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
  capAdditions,
  filterAdditions,
  matchRemovals,
  type Resolved,
  swapCounts,
  unblock,
} from "./swap.js";
import { loadTrain, trainSignals } from "./train.js";

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
    // Start the ledger empty, so songs you add in Spotify later are noticed.
    await setKnown(mix.id, []);
    await save(out);
  }
}

/** Look up each pick on Spotify, four at a time (gentle on rate limits). */
const resolveAll = (picks: Pick[]): Promise<Resolved[]> => spotify.findAll(picks);

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

  const trained = trainSignals(await loadTrain());
  const input: CurateInput = {
    mix: mix.name,
    mode: mix.mode === "renew" ? "renew" : "tweak",
    remove_count: counts.remove,
    add_count: counts.add,
    tune: mix.tune,
    // Train "yes" songs first: the most explicit taste signal there is.
    loved: [...trained.loved, ...uniqueRefs([...mix.locked, ...topTracks], 25)].slice(0, 40),
    blocked: [...mix.blocked, ...trained.blocked],
    taste: trained.taste,
    locked: mix.locked.map(ref),
    current: current.map(ref),
    top_artists: topArtists,
    note: mix.note,
    ...signals(await loadLedger(mix.id), current, Date.now()),
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

  // Claude may name fewer usable removals than asked: then fewer songs go in too.
  add = capAdditions(add, removals, current);
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
  // Never shrink the mix: with additions vetoed in Review, fewer come out.
  const remove = balance(swap.remove, swap.add, current);
  const next = applySwap(current, remove, swap.add);
  await spotify.replacePlaylistTracks(
    mix.playlistId,
    next.map((t) => t.uri),
  );
  // Géza's own change: record it so it isn't read as yours next sync.
  await setKnown(mix.id, next);
  await clearPending(mix.id);
  const ids = new Set(next.map((t) => t.id));
  const reasons: Record<string, string> = {};
  for (const [id, why] of Object.entries(mix.reasons ?? {})) if (ids.has(id)) reasons[id] = why;
  for (const a of swap.add) reasons[a.track.id] = a.reason;
  return {
    ...mix,
    lastAppliedAt: Date.now(),
    // Removed songs are never suggested again.
    blocked: addBlocked(
      mix.blocked,
      remove.map((r) => r.track),
    ),
    reasons,
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
  await setKnown(mix.id, last.tracks);
  // Songs that came back must not stay on the never-again list.
  return { ...mix, blocked: unblock(mix.blocked, last.tracks) };
}
