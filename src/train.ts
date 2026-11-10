// Train: swipe through songs Claude suggests. Yes goes to the shadow list
// ("Géza · Yes": on this device and as a private Spotify playlist) and
// becomes the strongest taste signal everywhere; No is never suggested again.

import { curate, type Pick } from "./claude.js";
import type { Enrichment } from "./musicbrainz.js";
import type { Profile, Track } from "./spotify.js";
import * as spotify from "./spotify.js";
import * as store from "./store.js";
import { buildTaste, type Judgement, type TasteProfile, type Verdict } from "./taste.js";
import { normalize, songKey } from "./text.js";

export const DECK_SIZE = 15;
export const YES_PLAYLIST = "Géza · Yes";
/** Where each song starts: past most intros, near the first chorus. */
export const START_AT = 0.35;
const DEFAULT_START_MS = 45_000;

type SongRef = { artist: string; title: string };

export interface Card {
  track: Track;
  reason: string;
  /** Claude's genre / era / mood labels. */
  tags: string[];
}

export interface TrainData {
  yes: Track[];
  no: SongRef[];
  /** The private Spotify copy of the yes list; null until the first yes. */
  playlistId: string | null;
  /** Every swipe with the song's attributes and listening time (newest last). */
  history: Judgement[];
}

const KEY = "train";
const ref = (t: SongRef): SongRef => ({ artist: t.artist, title: t.title });

export async function loadTrain(): Promise<TrainData> {
  const saved = await store.get<TrainData>(KEY);
  return { yes: [], no: [], playlistId: null, ...saved, history: saved?.history ?? [] };
}

export async function saveTrain(data: TrainData): Promise<void> {
  await store.set(KEY, data);
}

export const startPosition = (t: Track): number =>
  t.durationMs ? Math.round(t.durationMs * START_AT) : DEFAULT_START_MS;

/**
 * Keep found, new songs only: not already judged, no duplicates. Pure, so
 * it can be tested without Spotify.
 */
/** What the listener already knows, so the deck can be mostly new songs. */
export interface Known {
  /** Spotify IDs of songs they know: liked, top tracks, recently played. */
  trackIds: Set<string>;
  /** Artists they know (normalised names): top artists and swiped-yes artists. */
  artists: Set<string>;
}

/** At most this many cards per deck may come from artists you already know. */
export const MAX_KNOWN_ARTISTS = 3;

const firstArtist = (artist: string) => normalize(artist.split(",")[0] ?? artist);

/**
 * Keep found, new songs only: never a song you already know or have judged,
 * no duplicates, and at most MAX_KNOWN_ARTISTS from familiar artists. Pure,
 * so it can be tested without Spotify.
 */
export function deckFrom(
  resolved: { pick: Pick; track: Track | null }[],
  data: TrainData,
  known: Known = { trackIds: new Set(), artists: new Set() },
): Card[] {
  const seen = new Set([...data.yes, ...data.no].map((s) => songKey(s.artist, s.title)));
  const cards: Card[] = [];
  let familiar = 0;
  for (const { pick, track } of resolved) {
    if (!track || known.trackIds.has(track.id)) continue;
    const key = songKey(track.artist, track.title);
    if (seen.has(key)) continue;
    const knownArtist = known.artists.has(firstArtist(track.artist));
    if (knownArtist && familiar >= MAX_KNOWN_ARTISTS) continue;
    seen.add(key);
    if (knownArtist) familiar++;
    cards.push({ track, reason: pick.reason, tags: (pick.tags ?? []).slice(0, 4) });
  }
  return cards.slice(0, DECK_SIZE);
}

/** Ask Claude for a deck of songs to judge, found on Spotify. */
export async function buildDeck(
  data: TrainData,
  onProgress: (m: string) => void = () => {},
): Promise<Card[]> {
  onProgress("Reading your listening…");
  const [topTracks, topArtists, recent] = await Promise.all([
    spotify.getTopTracks(50),
    spotify.getTopArtists(30),
    spotify.getRecentlyPlayed(null).catch(() => ({ plays: [], complete: false })),
  ]);
  onProgress("Claude is picking songs to try…");
  const picks = await curate({
    mix: `Training deck: songs for the listener to judge one by one. At least ${DECK_SIZE - MAX_KNOWN_ARTISTS} must be songs they have very likely never heard, by artists NOT in top_artists or loved: lesser-known tracks and artists that fit their taste. At most ${MAX_KNOWN_ARTISTS} from artists they already know, and never their well-known hits. A varied spread with a few bolder wildcards`,
    mode: "renew",
    remove_count: 0,
    // Extra picks, because known songs are filtered out afterwards.
    add_count: DECK_SIZE + 8,
    tune: { mood: 3, tempo: 3, energy: 3, fresh: 5, vocals: 3 },
    loved: [...data.yes.slice(-15), ...topTracks.slice(0, 10)].map(ref),
    blocked: data.no.slice(-150),
    taste: buildTaste(data.history),
    locked: [],
    current: [],
    top_artists: topArtists,
    note: "",
  });
  onProgress("Finding them on Spotify…");
  const found = await spotify.findAll(picks.add);
  // Liked Songs is the strongest "I know this": check the found tracks against it.
  const foundIds = found.flatMap((f) => (f.track ? [f.track.id] : []));
  const liked = await spotify.likedAmong(foundIds).catch(() => new Set<string>());
  const known: Known = {
    trackIds: new Set([...topTracks.map((t) => t.id), ...recent.plays.map((p) => p.trackId), ...liked]),
    artists: new Set([...topArtists, ...data.yes.map((t) => t.artist)].map(firstArtist)),
  };
  const cards = deckFrom(found, data, known);
  if (cards.length === 0) throw new Error("None of Claude's picks were found on Spotify. Try again.");
  return cards;
}

export type { Verdict };

/** Record a swipe. Yes also goes into the private "Géza · Yes" playlist. */
export async function judge(
  data: TrainData,
  card: Card,
  verdict: Verdict,
  profile: Profile | null,
  dwellMs = 0,
  extra: Enrichment = { genres: [] },
): Promise<TrainData> {
  const t = card.track;
  const judgement: Judgement = {
    artist: t.artist,
    title: t.title,
    verdict,
    // Claude's labels plus the artist's community genres from MusicBrainz.
    tags: [...new Set([...card.tags, ...extra.genres].map((s) => s.toLowerCase()))],
    ...(extra.originalYear || t.year ? { year: extra.originalYear ?? t.year } : {}),
    ...(extra.country ? { country: extra.country } : {}),
    ...(t.durationMs ? { durationMs: t.durationMs } : {}),
    ...(t.explicit !== undefined ? { explicit: t.explicit } : {}),
    ...(t.popularity !== undefined ? { popularity: t.popularity } : {}),
    dwellMs: Math.max(0, Math.round(dwellMs)),
    at: Date.now(),
  };
  const withHistory = { ...data, history: [...data.history, judgement].slice(-1000) };
  if (verdict === "later") {
    await saveTrain(withHistory);
    return withHistory;
  }
  if (verdict === "no") {
    const next = { ...withHistory, no: [...data.no, ref(t)].slice(-500) };
    await saveTrain(next);
    return next;
  }
  let next: TrainData = { ...withHistory, yes: [...data.yes.filter((y) => y.id !== t.id), t] };
  await saveTrain(next);
  // The Spotify copy is a convenience: if it fails, the local list still counts.
  try {
    let playlistId = next.playlistId;
    if (!playlistId) {
      const me = profile ?? (await spotify.getProfile());
      playlistId = (
        await spotify.createPlaylist(me.id, YES_PLAYLIST, "Songs you swiped yes on in Géza's Train.")
      ).id;
      next = { ...next, playlistId };
      await saveTrain(next);
    }
    await spotify.addToPlaylist(playlistId, [card.track.uri]);
  } catch {
    // Ignore; retried implicitly next time a playlist id is missing.
  }
  return next;
}

/** Taste signals from Train, for every Claude request. */
export function trainSignals(data: TrainData): { loved: SongRef[]; blocked: SongRef[]; taste: TasteProfile } {
  return {
    loved: data.yes.slice(-25).map(ref),
    blocked: data.no.slice(-200),
    taste: buildTaste(data.history),
  };
}
