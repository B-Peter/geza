// Train: swipe through songs Claude suggests. Yes goes to the shadow list
// ("Géza · Yes": on this device and as a private Spotify playlist) and
// becomes the strongest taste signal everywhere; No is never suggested again.

import { type ArtistPick, curate, type Pick, pickArtists } from "./claude.js";
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
  /** The deck this card came from (its "at"), for per-deck stats. */
  deck?: number;
}

/** How a deck went: what Claude asked for, what Spotify had, what you saw. */
export interface DeckStat {
  at: number;
  /** Artists (or songs) Claude named. */
  asked: number;
  /** ...of which Spotify had usable songs. */
  found: number;
  /** Cards in the deck. */
  size: number;
}

export interface Deck {
  at: number;
  cards: Card[];
  asked: number;
  found: number;
}

export interface TrainData {
  yes: Track[];
  no: SongRef[];
  /** The private Spotify copy of the yes list; null until the first yes. */
  playlistId: string | null;
  /** Every swipe with the song's attributes and listening time (newest last). */
  history: Judgement[];
  /** The last decks, newest last. */
  decks?: DeckStat[];
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

/** Below this many cards the artist route is topped up with song picks. */
export const MIN_DECK = 8;
/** Artists Claude is asked for; some won't be on Spotify or will be all known. */
const ARTISTS_ASKED = DECK_SIZE + 7;

export interface ArtistResolved {
  pick: ArtistPick;
  /** The artist's top tracks on Spotify, most popular first; empty if not found. */
  tracks: Track[];
}

/** Versions that don't introduce an artist well. */
const SIDE_VERSION = /[-([].*\b(live|remix|karaoke|instrumental|acoustic|commentary|sped up|slowed)\b/i;
const MIN_LENGTH_MS = 90_000;

/**
 * One song for this artist: a new artist is introduced by a hit, a familiar
 * one by something below their hits. `usable` rules out songs you know or
 * have judged.
 */
export function chooseTrack(pick: ArtistPick, tracks: Track[], usable: (t: Track) => boolean): Track | null {
  const ok = tracks.filter(
    (t) => usable(t) && (t.durationMs ?? MIN_LENGTH_MS) >= MIN_LENGTH_MS && !SIDE_VERSION.test(t.title),
  );
  if (ok.length === 0) return null;
  if (pick.want === "deep cut") {
    const deep = ok.filter((t) => tracks.indexOf(t) >= 3);
    return (deep.length ? deep : ok).at(-1) ?? null;
  }
  return ok[0] ?? null;
}

/**
 * One card per artist, in Claude's order: never a song you know or judged,
 * at most MAX_KNOWN_ARTISTS from familiar artists. Pure.
 */
export function deckFromArtists(resolved: ArtistResolved[], data: TrainData, known: Known): Card[] {
  const seen = new Set([...data.yes, ...data.no].map((s) => songKey(s.artist, s.title)));
  const cards: Card[] = [];
  let familiar = 0;
  for (const { pick, tracks } of resolved) {
    const name = tracks[0]?.artist ?? pick.artist;
    const knownArtist = known.artists.has(firstArtist(name)) || known.artists.has(firstArtist(pick.artist));
    if (knownArtist && familiar >= MAX_KNOWN_ARTISTS) continue;
    const track = chooseTrack(
      pick,
      tracks,
      (t) => !known.trackIds.has(t.id) && !seen.has(songKey(t.artist, t.title)),
    );
    if (!track) continue;
    seen.add(songKey(track.artist, track.title));
    if (knownArtist) familiar++;
    cards.push({ track, reason: pick.reason, tags: (pick.tags ?? []).slice(0, 4) });
    if (cards.length >= DECK_SIZE) break;
  }
  return cards;
}

/** Artist search, then top tracks; six at a time. Unknown artists come back with no tracks. */
async function resolveArtists(picks: ArtistPick[]): Promise<ArtistResolved[]> {
  const out: ArtistResolved[] = new Array(picks.length);
  let next = 0;
  const worker = async () => {
    while (next < picks.length) {
      const i = next++;
      const pick = picks[i];
      if (!pick) continue;
      let tracks: Track[] = [];
      try {
        const artist = await spotify.findArtist(pick.artist);
        if (artist) tracks = await spotify.artistTopTracks(artist.id);
      } catch {
        // Treated as not found; the deck is built from the rest.
      }
      out[i] = { pick, tracks };
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

const uniqueNames = (names: string[], max: number) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const key = firstArtist(n);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(n.split(",")[0]?.trim() ?? n);
    if (out.length >= max) break;
  }
  return out;
};

interface Listening {
  topTracks: Track[];
  topArtists: string[];
  recentIds: string[];
}

async function readListening(): Promise<Listening> {
  const [topTracks, topArtists, recent] = await Promise.all([
    spotify.getTopTracks(50),
    spotify.getTopArtists(30),
    spotify.getRecentlyPlayed(null).catch(() => ({ plays: [], complete: false })),
  ]);
  return { topTracks, topArtists, recentIds: recent.plays.map((p) => p.trackId) };
}

async function knownFrom(data: TrainData, l: Listening, candidateIds: string[]): Promise<Known> {
  // Liked Songs is the strongest "I know this": check the candidates against it.
  const liked = await spotify.likedAmong(candidateIds).catch(() => new Set<string>());
  return {
    trackIds: new Set([...l.topTracks.map((t) => t.id), ...l.recentIds, ...liked]),
    artists: new Set([...l.topArtists, ...data.yes.map((t) => t.artist)].map(firstArtist)),
  };
}

/**
 * Ask Claude for artists to discover, fetch their real songs from Spotify,
 * and deal one song per artist. Falls back to song picks when too few
 * artists worked out.
 */
export async function buildDeck(data: TrainData, onProgress: (m: string) => void = () => {}): Promise<Deck> {
  onProgress("Reading your listening…");
  const listening = await readListening();
  onProgress("Claude is picking artists to discover…");
  const judged = uniqueNames(
    [
      ...data.history
        .slice(-200)
        .reverse()
        .map((j) => j.artist),
      ...data.yes.map((t) => t.artist),
    ],
    80,
  );
  const picks = await pickArtists(
    {
      count: ARTISTS_ASKED,
      loved: [...data.yes.slice(-15), ...listening.topTracks.slice(0, 10)].map(ref),
      top_artists: listening.topArtists,
      judged_artists: judged,
      taste: buildTaste(data.history),
    },
    "low",
  );
  onProgress("Finding their songs on Spotify…");
  const resolved = await resolveArtists(picks);
  const known = await knownFrom(
    data,
    listening,
    resolved.flatMap((r) => r.tracks.map((t) => t.id)),
  );
  const at = Date.now();
  let cards = deckFromArtists(resolved, data, known);
  const found = resolved.filter((r) => r.tracks.length > 0).length;
  if (cards.length < MIN_DECK) {
    onProgress("Claude is picking songs to try…");
    const more = await buildDeckByTitles(data, listening, known, cards);
    cards = [...cards, ...more].slice(0, DECK_SIZE);
  }
  if (cards.length === 0) throw new Error("None of Claude's picks were found on Spotify. Try again.");
  return { at, cards: cards.map((c) => ({ ...c, deck: at })), asked: picks.length, found };
}

/** The older route: Claude names songs, Spotify search finds them. */
async function buildDeckByTitles(data: TrainData, l: Listening, known: Known, have: Card[]): Promise<Card[]> {
  const picks = await curate(
    {
      mix: `Training deck: songs for the listener to judge one by one. At least ${DECK_SIZE - MAX_KNOWN_ARTISTS} must be songs they have very likely never heard, by artists NOT in top_artists or loved: lesser-known tracks and artists that fit their taste. At most ${MAX_KNOWN_ARTISTS} from artists they already know, and never their well-known hits. A varied spread with a few bolder wildcards`,
      mode: "renew",
      remove_count: 0,
      add_count: DECK_SIZE + 5,
      tune: { mood: 3, tempo: 3, energy: 3, fresh: 5, vocals: 3 },
      loved: [...data.yes.slice(-15), ...l.topTracks.slice(0, 10)].map(ref),
      blocked: [...data.no.slice(-150), ...have.map((c) => ref(c.track))],
      taste: buildTaste(data.history),
      locked: [],
      current: [],
      top_artists: l.topArtists,
      note: "",
    },
    "low",
  );
  const found = await spotify.findAll(picks.add);
  const liked = await spotify
    .likedAmong(found.flatMap((f) => (f.track ? [f.track.id] : [])))
    .catch(() => new Set<string>());
  const haveKeys = new Set(have.map((c) => songKey(c.track.artist, c.track.title)));
  return deckFrom(found, data, { ...known, trackIds: new Set([...known.trackIds, ...liked]) }).filter(
    (c) => !haveKeys.has(songKey(c.track.artist, c.track.title)),
  );
}

/** Remember how a deck went (kept for the last 50 decks). */
export async function recordDeck(data: TrainData, deck: Deck): Promise<TrainData> {
  const stat: DeckStat = { at: deck.at, asked: deck.asked, found: deck.found, size: deck.cards.length };
  const next = { ...data, decks: [...(data.decks ?? []), stat].slice(-50) };
  await saveTrain(next);
  return next;
}

/** Yes / no / skipped counts for one deck, from the swipe history. */
export function deckOutcome(data: TrainData, at: number): { yes: number; no: number; later: number } {
  const out = { yes: 0, no: 0, later: 0 };
  for (const j of data.history) if (j.deck === at) out[j.verdict]++;
  return out;
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
    ...(card.deck ? { deck: card.deck } : {}),
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
