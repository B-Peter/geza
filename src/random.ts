// "Play something random": a one-off playlist picked from its own spider
// graph, separate from the four weekly mixes.

import { curate, type Tune } from "./claude.js";
import { PRESETS } from "./radar.js";
import type { Profile, Track } from "./spotify.js";
import * as spotify from "./spotify.js";
import * as store from "./store.js";
import { filterAdditions } from "./swap.js";
import { loadTrain, trainSignals } from "./train.js";

export const RANDOM_PLAYLIST = "Studio Random";
export const RANDOM_SIZE = 20;

export interface RandomSettings {
  tune: Tune;
  note: string;
  /** The reusable Spotify playlist; null until first used. */
  playlistId: string | null;
}

export interface RandomResult {
  settings: RandomSettings;
  picked: number;
  found: number;
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
  onProgress("Claude is picking songs…");
  const picks = await curate({
    mix: "Random, for right now",
    mode: "renew",
    remove_count: 0,
    add_count: RANDOM_SIZE,
    tune: settings.tune,
    loved: [...trained.loved, ...topTracks.map(ref)].slice(0, 40),
    blocked: trained.blocked,
    locked: [],
    current: [],
    top_artists: topArtists,
    note: settings.note,
  });

  onProgress("Finding the songs on Spotify…");
  const { add } = filterAdditions(await spotify.findAll(picks.add), [], [], [], RANDOM_SIZE);
  if (add.length === 0) throw new Error("None of Claude's picks were found on Spotify. Try again.");
  const uris = add.map((a) => (a.track as Track).uri);

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

  const next = { ...settings, playlistId };
  await saveRandom(next);
  return { settings: next, picked: picks.add.length, found: add.length };
}
