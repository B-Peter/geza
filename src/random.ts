// "Play something random": a one-off playlist picked from its own spider
// graph, separate from the four weekly mixes.

import { type CurateInput, curate, type Tune } from "./claude.js";
import { PRESETS } from "./radar.js";
import type { Profile, Track } from "./spotify.js";
import * as spotify from "./spotify.js";
import * as store from "./store.js";
import { filterAdditions } from "./swap.js";
import { songKey } from "./text.js";
import { type Card, loadTrain, trainSignals } from "./train.js";

export const RANDOM_PLAYLIST = "Studio Random";
export const RANDOM_SIZE = 20;

export interface RandomSettings {
  tune: Tune;
  note: string;
  /** The reusable Spotify playlist; null until first used. */
  playlistId: string | null;
  /** Every song a random playlist has had, newest first: none of them comes back. */
  recent?: { artist: string; title: string }[];
}

/** How many earlier random songs are remembered (and never picked again). */
const RECENT_MAX = 2000;
/** Of those, how many are listed to Claude; the rest are only filtered out here. */
const RECENT_SENT = 200;
/** Extra rounds of picking when too few songs were new and on Spotify. */
const EXTRA_ROUNDS = 2;

export interface RandomResult {
  settings: RandomSettings;
  picked: number;
  found: number;
  /** What went into the playlist, in order, with Claude's reasons and tags. */
  songs: Card[];
}

const KEY = "random";

export async function loadRandom(): Promise<RandomSettings> {
  const saved = await store.get<RandomSettings>(KEY);
  if (saved) return saved;
  const first = PRESETS[0]?.tune ?? { mood: 3, tempo: 3, energy: 3, fresh: 3, vocals: 3 };
  return { tune: { ...first }, note: "", playlistId: null };
}

export async function saveRandom(settings: RandomSettings): Promise<void> {
  await store.set(KEY, settings);
}

const ref = (t: { artist: string; title: string }) => ({ artist: t.artist, title: t.title });
/** Back from a songKey ("artist|title", normalised) to a reference Claude can read. */
const fromKey = (key: string) => {
  const [artist = "", title = ""] = key.split("|");
  return { artist, title };
};

async function createRandomPlaylist(profile: Profile): Promise<string> {
  const playlist = await spotify.createPlaylist(
    profile.id,
    RANDOM_PLAYLIST,
    "One-off picks from Géza. Replaced every time you play something random.",
  );
  return playlist.id;
}

/**
 * Ask Claude for songs matching the graph, find them on Spotify, and put them
 * in the reusable random playlist (created on first use, recreated if it was
 * deleted in Spotify).
 */
export async function prepareRandom(
  settings: RandomSettings,
  profile: Profile,
  onProgress: (message: string) => void = () => {},
): Promise<RandomResult> {
  onProgress("Reading your listening…");
  const [topTracks, topArtists] = await Promise.all([spotify.getTopTracks(20), spotify.getTopArtists(20)]);

  const trained = trainSignals(await loadTrain());
  onProgress("Géza is picking songs…");
  // A random playlist is all new: no song any earlier one had, ever.
  const recent = settings.recent ?? [];
  const avoid = [...trained.blocked, ...recent];
  const input: CurateInput = {
    mix: "Random, for right now. Every song must be new: none in blocked, and none Géza picked for an earlier random playlist",
    mode: "renew",
    remove_count: 0,
    add_count: RANDOM_SIZE,
    tune: settings.tune,
    loved: [...trained.loved, ...topTracks.map(ref)].slice(0, 40),
    blocked: [...trained.blocked, ...recent.slice(0, RECENT_SENT)],
    taste: trained.taste,
    locked: [],
    current: [],
    top_artists: topArtists,
    note: settings.note,
  };
  const picks = await curate(input, "low");

  onProgress("Finding the songs on Spotify…");
  let resolved = await spotify.findAll(picks.add);
  let { add, missing } = filterAdditions(resolved, [], [], avoid, RANDOM_SIZE);
  const named = new Set(picks.add.map((p) => songKey(p.artist, p.title)));

  // More rounds for picks that weren't new or weren't on Spotify.
  for (let round = 0; round < EXTRA_ROUNDS && add.length < RANDOM_SIZE; round++) {
    const short = RANDOM_SIZE - add.length;
    onProgress(`Géza is picking ${short} more…`);
    const retry = await curate(
      {
        ...input,
        add_count: short,
        current: add.map((a) => ref(a.track)),
        // Whatever was named already, kept or not, must not come again.
        blocked: [...input.blocked, ...[...named].map(fromKey), ...missing.map(ref)],
      },
      "low",
    ).catch(() => ({ add: [], remove: [] }));
    for (const p of retry.add) named.add(songKey(p.artist, p.title));
    const more = await spotify.findAll(retry.add);
    const extra = filterAdditions(
      more,
      add.map((a) => a.track),
      [],
      avoid,
      short,
    );
    resolved = [...resolved, ...more];
    add = [...add, ...extra.add];
    missing = [...missing, ...extra.missing];
  }
  if (add.length === 0)
    throw new Error(
      "Géza found no new songs for this sound this time. Try again, or change the sound or the note.",
    );
  const uris = add.map((a) => (a.track as Track).uri);
  const tagsOf = new Map(resolved.map((r) => [r.track?.id ?? "", (r.pick.tags ?? []).slice(0, 4)]));
  const songs: Card[] = add.map((a) => ({
    track: a.track,
    reason: a.reason,
    tags: tagsOf.get(a.track.id) ?? [],
  }));

  onProgress("Filling the playlist…");
  let playlistId = settings.playlistId ?? (await createRandomPlaylist(profile));
  try {
    await spotify.replacePlaylistTracks(playlistId, uris);
  } catch (e) {
    // Deleted or no longer ours in Spotify: make a new one and try once more.
    if (!(e instanceof spotify.SpotifyError) || ![403, 404].includes(e.status)) throw e;
    playlistId = await createRandomPlaylist(profile);
    await spotify.replacePlaylistTracks(playlistId, uris);
  }

  const picked = add.map((a) => ref(a.track));
  const next = { ...settings, playlistId, recent: [...picked, ...recent].slice(0, RECENT_MAX) };
  await saveRandom(next);
  // "picked" counts the different songs Claude named over both rounds.
  return { settings: next, picked: Math.max(named.size, add.length), found: add.length, songs };
}
