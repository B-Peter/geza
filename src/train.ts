// Train: swipe through songs Claude suggests. Yes goes to the shadow list
// ("Géza · Yes": on this device and as a private Spotify playlist) and
// becomes the strongest taste signal everywhere; No is never suggested again.

import { type ArtistPick, curate, type DeckFocus, type Pick, streamArtists } from "./claude.js";
import type { Enrichment } from "./musicbrainz.js";
import type { Profile, Track } from "./spotify.js";
import * as spotify from "./spotify.js";
import * as store from "./store.js";
import { buildTaste, decade, type Judgement, type TasteProfile, type Verdict } from "./taste.js";
import { normalize, songKey } from "./text.js";

export const DECK_SIZE = 15;
export const YES_PLAYLIST = "Géza · Yes";
export const NO_PLAYLIST = "Géza · No";
export const DECK_PLAYLIST = "Géza · Deck";
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
  /** How long each step took, in ms (missing for decks from before this was recorded). */
  ms?: DeckTiming;
}

export interface DeckTiming {
  /** Reading top tracks, artists and recent plays from Spotify. */
  listening: number;
  /** Claude naming the artists. */
  claude: number;
  /** Finding the artists and their songs on Spotify. */
  spotify: number;
  total: number;
  /** Of all that, time Spotify made us wait because of its rate limit. */
  waited?: number;
}

export interface Deck {
  at: number;
  cards: Card[];
  asked: number;
  found: number;
  ms: DeckTiming;
  /** The rest of the deck, still on its way (the deck starts with the first batch). */
  rest?: Promise<Card[]>;
}

export interface TrainData {
  yes: Track[];
  no: SongRef[];
  /** The private Spotify copy of the yes list; null until the first yes. */
  playlistId: string | null;
  /** The private Spotify copy of the no list; null until the first no. */
  noPlaylistId?: string | null;
  /** The current deck as a playlist: Spotify plays it as one list. */
  deckPlaylistId?: string | null;
  /** Every swipe with the song's attributes and listening time (newest last). */
  history: Judgement[];
  /** The last decks, newest last. */
  decks?: DeckStat[];
  /** Taste inferences you switched off ("tag:ballad", "era:2020s", ...). */
  muted?: string[];
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
 * never an artist twice, at most MAX_KNOWN_ARTISTS from familiar artists.
 * "have" is what the deck already holds; only the new cards are returned.
 * Pure.
 */
export function deckFromArtists(
  resolved: ArtistResolved[],
  data: TrainData,
  known: Known,
  have: Card[] = [],
): Card[] {
  const seen = new Set(
    [...data.yes, ...data.no, ...have.map((c) => c.track)].map((s) => songKey(s.artist, s.title)),
  );
  const artists = new Set(have.map((c) => firstArtist(c.track.artist)));
  let familiar = have.filter((c) => known.artists.has(firstArtist(c.track.artist))).length;
  const cards: Card[] = [];
  for (const { pick, tracks } of resolved) {
    if (have.length + cards.length >= DECK_SIZE) break;
    const name = firstArtist(tracks[0]?.artist ?? pick.artist);
    if (artists.has(name)) continue;
    const knownArtist = known.artists.has(name) || known.artists.has(firstArtist(pick.artist));
    if (knownArtist && familiar >= MAX_KNOWN_ARTISTS) continue;
    const track = chooseTrack(
      pick,
      tracks,
      (t) => !known.trackIds.has(t.id) && !seen.has(songKey(t.artist, t.title)),
    );
    if (!track) continue;
    seen.add(songKey(track.artist, track.title));
    artists.add(name);
    if (knownArtist) familiar++;
    // Claude gives genre and mood; the era comes from the song itself.
    const tags = [
      ...new Set([
        ...(pick.tags ?? []).map((s) => s.toLowerCase()),
        ...(track.year ? [decade(track.year)] : []),
      ]),
    ];
    cards.push({ track, reason: pick.reason, tags: tags.slice(0, 4) });
  }
  return cards;
}

/** An artist's top tracks on Spotify; none when Spotify doesn't have the artist. */
async function artistTracks(pick: ArtistPick): Promise<Track[]> {
  try {
    const artist = await spotify.findArtist(pick.artist);
    return artist ? await spotify.artistTopTracks(artist.id) : [];
  } catch {
    // Treated as not found; the deck is built from the rest.
    return [];
  }
}

/** Runs at most "max" jobs at once; the rest wait their turn. */
function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(job: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((go) => waiting.push(go));
    active++;
    try {
      return await job();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
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

/**
 * Your listening changes slowly, so it's kept on the device: a deck starts
 * from the saved copy right away and the copy is refreshed behind it.
 */
const LISTENING_KEY = "listening";
const LISTENING_FRESH_MS = 10 * 60_000;
const LISTENING_MAX_MS = 24 * 3_600_000;
type SavedListening = { at: number; value: Listening };
let listeningCache: SavedListening | null = null;

async function readListening(): Promise<Listening> {
  listeningCache ??= (await store.get<SavedListening>(LISTENING_KEY).catch(() => undefined)) ?? null;
  const age = listeningCache ? Date.now() - listeningCache.at : Number.POSITIVE_INFINITY;
  if (listeningCache && age < LISTENING_MAX_MS) {
    if (age > LISTENING_FRESH_MS) void refreshListening().catch(() => {});
    return listeningCache.value;
  }
  return refreshListening();
}

async function refreshListening(): Promise<Listening> {
  const value = await fetchListening();
  listeningCache = { at: Date.now(), value };
  void store.set(LISTENING_KEY, listeningCache).catch(() => {});
  return value;
}

/** Forget the saved listening (on log out: the next account has its own). */
export async function forgetListening(): Promise<void> {
  listeningCache = null;
  await store.remove(LISTENING_KEY);
}

async function fetchListening(): Promise<Listening> {
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
 * Claude is asked three times at once, each for a different kind of artist:
 * three short answers arrive together, in about the time of one.
 */
const BATCHES: { focus: DeckFocus; count: number }[] = [
  { focus: "close", count: 8 },
  { focus: "adjacent", count: 7 },
  { focus: "wildcard", count: 5 },
];
/** The deck starts as soon as it has this many cards. */
const FIRST_CARDS = 3;

type LookedUp = ArtistResolved & { known: Known };

/**
 * Ask Claude for artists to discover and deal one real song per artist.
 * Nothing waits for a whole answer: each artist is looked up on Spotify the
 * moment Claude has written the name, and the deck is returned once it has a
 * few cards; the others follow in "rest". "avoid" holds the cards still
 * waiting in the deck being played, so the next deck doesn't repeat them.
 */
export async function buildDeck(
  data: TrainData,
  onProgress: (m: string) => void = () => {},
  avoid: Card[] = [],
): Promise<Deck> {
  const t0 = performance.now();
  const waited0 = spotify.rateLimitWaitMs();
  onProgress("Reading your listening…");
  const listening = await readListening();
  const t1 = performance.now();
  onProgress("Claude is picking artists to discover…");
  const judged = uniqueNames(
    [
      ...avoid.map((c) => c.track.artist),
      ...data.history
        .slice(-200)
        .reverse()
        .map((j) => j.artist),
      ...data.yes.map((t) => t.artist),
    ],
    80,
  );
  const base = {
    loved: [...data.yes.slice(-15), ...listening.topTracks.slice(0, 10)].map(ref),
    top_artists: listening.topArtists,
    judged_artists: judged,
    taste: buildTaste(data.history, { muted: data.muted }),
  };
  // Songs waiting in the current deck count as judged here: never dealt twice.
  const judgedData: TrainData = { ...data, no: [...data.no, ...avoid.map((c) => ref(c.track))] };
  let t2 = 0;
  const stats = { asked: 0, found: 0 };
  const cards: Card[] = [];
  let enough = () => {};
  const firstCards = new Promise<void>((resolve) => {
    enough = resolve;
  });
  const limit = limiter(6);

  /** One artist's songs, and which of them the listener already knows. */
  const lookUp = async (pick: ArtistPick): Promise<LookedUp> => {
    const tracks = await limit(() => artistTracks(pick));
    const known = await knownFrom(
      data,
      listening,
      tracks.map((t) => t.id),
    );
    return { pick, tracks, known };
  };
  const deal = ({ pick, tracks, known }: LookedUp) => {
    stats.asked++;
    if (tracks.length > 0) stats.found++;
    cards.push(...deckFromArtists([{ pick, tracks }], judgedData, known, cards));
    if (cards.length >= FIRST_CARDS) enough();
  };
  /** One answer from Claude: lookups run side by side, cards are dealt in Claude's order. */
  const batch = async ({ focus, count }: { focus: DeckFocus; count: number }) => {
    let dealt = Promise.resolve();
    await streamArtists({ ...base, count, focus }, (pick) => {
      if (!t2) {
        t2 = performance.now();
        onProgress("Finding their songs on Spotify…");
      }
      if (cards.length >= DECK_SIZE) return;
      const found = lookUp(pick);
      dealt = dealt.then(async () => deal(await found)).catch(() => {});
    }).catch(() => []);
    await dealt;
  };
  const all = Promise.all(BATCHES.map(batch));
  await Promise.race([firstCards, all]);

  const at = Date.now();
  const tag = (list: Card[]) => list.map((c) => ({ ...c, deck: at }));
  const first = tag(cards);
  const t3 = performance.now();
  const ms: DeckTiming = {
    listening: Math.round(t1 - t0),
    claude: Math.round((t2 || t3) - t1),
    spotify: Math.round(t3 - (t2 || t3)),
    total: Math.round(t3 - t0),
    waited: Math.round(spotify.rateLimitWaitMs() - waited0),
  };
  const deck: Deck = { at, cards: first, asked: stats.asked, found: stats.found, ms };
  const finish = async (): Promise<Card[]> => {
    await all;
    if (cards.length < MIN_DECK) {
      const known = await knownFrom(data, listening, []);
      const artists = new Set(cards.map((c) => firstArtist(c.track.artist)));
      const more = await buildDeckByTitles(judgedData, listening, known, cards).catch(() => []);
      for (const c of more) {
        if (cards.length >= DECK_SIZE) break;
        if (artists.has(firstArtist(c.track.artist))) continue;
        artists.add(firstArtist(c.track.artist));
        cards.push(c);
      }
    }
    deck.asked = stats.asked;
    deck.found = stats.found;
    return tag(cards.slice(first.length));
  };
  if (first.length === 0) {
    const restCards = await finish();
    if (restCards.length === 0) throw new Error("None of Claude's picks were found on Spotify. Try again.");
    return { ...deck, cards: restCards, asked: stats.asked, found: stats.found };
  }
  deck.rest = finish();
  return deck;
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
      taste: buildTaste(data.history, { muted: data.muted }),
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

/**
 * Put the deck's songs into the private "Géza · Deck" playlist (created on
 * first use, recreated if you deleted it). Returns the updated data and the
 * playlist.
 */
export async function fillDeckPlaylist(
  data: TrainData,
  uris: string[],
  profile: Profile | null,
): Promise<{ data: TrainData; playlistId: string }> {
  const create = async () => {
    const me = profile ?? (await spotify.getProfile());
    return (
      await spotify.createPlaylist(
        me.id,
        DECK_PLAYLIST,
        "The songs of your current Train deck in Géza. Replaced with every new deck.",
      )
    ).id;
  };
  let playlistId = data.deckPlaylistId ?? (await create());
  try {
    await spotify.replacePlaylistTracks(playlistId, uris);
  } catch (e) {
    if (!(e instanceof spotify.SpotifyError) || ![403, 404].includes(e.status) || !data.deckPlaylistId)
      throw e;
    playlistId = await create();
    await spotify.replacePlaylistTracks(playlistId, uris);
  }
  const next = { ...data, deckPlaylistId: playlistId };
  await saveTrain(next);
  return { data: next, playlistId };
}

/** Remember how a deck went (kept for the last 50 decks). */
export async function recordDeck(data: TrainData, deck: Deck): Promise<TrainData> {
  const stat: DeckStat = {
    at: deck.at,
    asked: deck.asked,
    found: deck.found,
    size: deck.cards.length,
    ms: deck.ms,
  };
  // A deck picked up again later keeps its first entry.
  if (data.decks?.some((d) => d.at === deck.at)) return data;
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
    ...(extra.genres.length ? { genres: extra.genres.map((s) => s.toLowerCase()) } : {}),
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
    return copyToSpotify(next, "no", t, profile);
  }
  const next: TrainData = { ...withHistory, yes: [...data.yes.filter((y) => y.id !== t.id), t] };
  await saveTrain(next);
  return copyToSpotify(next, "yes", t, profile);
}

const COPIES = {
  yes: { name: YES_PLAYLIST, description: "Songs you swiped yes on in Géza's Train.", field: "playlistId" },
  no: {
    name: NO_PLAYLIST,
    description: "Songs you swiped no on in Géza's Train. Géza never suggests them again.",
    field: "noPlaylistId",
  },
} as const;

/**
 * Keep a copy of the swipe in its private Spotify playlist. The playlists are
 * also the backup: a fresh device reads them back (see restoreFromSpotify).
 * A failure here is ignored; the local list still counts.
 */
async function copyToSpotify(
  data: TrainData,
  which: "yes" | "no",
  track: Track,
  profile: Profile | null,
): Promise<TrainData> {
  const copy = COPIES[which];
  let next = data;
  try {
    let playlistId = next[copy.field] ?? null;
    if (!playlistId) {
      const me = profile ?? (await spotify.getProfile());
      playlistId = (await spotify.createPlaylist(me.id, copy.name, copy.description)).id;
      next = { ...next, [copy.field]: playlistId };
      await saveTrain(next);
    }
    await spotify.addToPlaylist(playlistId, [track.uri]);
  } catch {
    // Retried implicitly next time a playlist id is missing.
  }
  return next;
}

/**
 * On a device with no swipes yet, rebuild the yes and no lists from the
 * "Géza · Yes" / "Géza · No" playlists in Spotify. Tags and listening times
 * are gone, but the songs and artists (the strongest signals) come back.
 * Returns what was restored, or null when there was nothing to do.
 */
export async function restoreFromSpotify(
  data: TrainData,
): Promise<{ data: TrainData; yes: number; no: number } | null> {
  if (data.history.length || data.yes.length || data.no.length) return null;
  const playlists = await spotify.listMyPlaylists();
  const yesList = playlists.find((p) => p.name === YES_PLAYLIST);
  const noList = playlists.find((p) => p.name === NO_PLAYLIST);
  if (!yesList && !noList) return null;
  const yes = yesList ? await spotify.getPlaylistTracks(yesList.id) : [];
  const no = noList ? await spotify.getPlaylistTracks(noList.id) : [];
  const at = Date.now();
  const restored = (t: Track, verdict: Verdict): Judgement => ({
    ...ref(t),
    verdict,
    tags: [],
    dwellMs: 0,
    at,
  });
  const next: TrainData = {
    ...data,
    yes,
    no: no.map(ref),
    playlistId: yesList?.id ?? null,
    noPlaylistId: noList?.id ?? null,
    history: [...yes.map((t) => restored(t, "yes")), ...no.map((t) => restored(t, "no"))],
  };
  await saveTrain(next);
  return { data: next, yes: yes.length, no: no.length };
}

/** Switch a taste inference off or on again. */
export async function setMuted(data: TrainData, key: string, muted: boolean): Promise<TrainData> {
  const current = new Set(data.muted ?? []);
  if (muted) current.add(key);
  else current.delete(key);
  const next = { ...data, muted: [...current] };
  await saveTrain(next);
  return next;
}

/** Taste signals from Train, for every Claude request. */
export function trainSignals(data: TrainData): { loved: SongRef[]; blocked: SongRef[]; taste: TasteProfile } {
  return {
    loved: data.yes.slice(-25).map(ref),
    blocked: data.no.slice(-200),
    taste: buildTaste(data.history, { muted: data.muted }),
  };
}
