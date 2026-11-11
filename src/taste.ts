// Taste profile from Train swipes: every attribute of every judged song,
// weighted by how long you listened before deciding, fading with age, and
// normalised so a label counts for how you feel about it, not how often it
// turns up. Pure functions.

export type Verdict = "yes" | "no" | "later";

/** One swipe and everything known about the song at that moment. */
export interface Judgement {
  artist: string;
  title: string;
  verdict: Verdict;
  /** Claude's labels (genre, era, mood), plus MusicBrainz genres in older entries. */
  tags: string[];
  /** The artist's community genres from MusicBrainz, when known. */
  genres?: string[];
  year?: number;
  durationMs?: number;
  explicit?: boolean;
  /** Spotify's 0–100 score, when Spotify still provides it. */
  popularity?: number;
  /** Artist's country (ISO code), from MusicBrainz. */
  country?: string;
  /** How long it played before you decided. */
  dwellMs: number;
  at: number;
  /** The deck it was in (the deck's "at"). */
  deck?: number;
}

export interface TasteProfile {
  judged: number;
  liked_tags: string[];
  disliked_tags: string[];
  liked_eras: string[];
  disliked_eras: string[];
  liked_artists: string[];
  disliked_artists: string[];
  /** Artists' countries (ISO codes), from MusicBrainz. */
  liked_countries: string[];
  disliked_countries: string[];
  explicit: "fine" | "avoid" | "unknown";
  length: "shorter" | "longer" | "any";
  popularity: "well-known" | "lesser-known" | "any";
}

export type Dimension = "tag" | "era" | "artist" | "country";

export interface TasteOptions {
  /** "Now" for the age of each swipe; defaults to the clock. */
  now?: number;
  /** Inferences you've switched off, as "<dimension>:<key>" (see mutedKey). */
  muted?: string[];
}

/** Below this many decisions the profile says nothing (too noisy). */
export const MIN_JUDGED = 3;
/** A swipe counts half as much after this long. */
export const HALF_LIFE_MS = 60 * 24 * 3600 * 1000;
/** A label needs at least this many swipes behind it to mean anything. */
export const MIN_COUNT = 2;
/**
 * A dislike needs more behind it than a like: a disliked label is avoided
 * from then on, so no new swipes arrive that could prove it wrong.
 */
export const MIN_DISLIKE_COUNT = 3;
/** MusicBrainz genres are community labels: worth more than Claude's own tags. */
const GENRE_BONUS = 0.5;

/**
 * How much one swipe counts. A no within 6 s is a strong no (didn't even
 * need to hear it); a no after 30 s is a weak one (it almost worked). A yes
 * after 20 s of listening is a slightly stronger yes. "Later" counts 0.
 */
export function weight(j: Pick<Judgement, "verdict" | "dwellMs">): number {
  if (j.verdict === "later") return 0;
  if (j.verdict === "yes") return j.dwellMs >= 20_000 ? 1.3 : 1;
  if (j.dwellMs < 6_000) return -1.5;
  if (j.dwellMs > 30_000) return -0.6;
  return -1;
}

/** The swipe's weight, faded by its age: half after HALF_LIFE_MS. */
export function agedWeight(j: Pick<Judgement, "verdict" | "dwellMs" | "at">, now: number): number {
  const age = Math.max(0, now - j.at);
  return weight(j) * 0.5 ** (age / HALF_LIFE_MS);
}

export const decade = (year: number): string => `${Math.floor(year / 10) * 10}s`;
export const mutedKey = (dimension: Dimension, key: string): string => `${dimension}:${norm(key)}`;

const norm = (s: string) => s.trim().toLowerCase();

/** One label's standing: its normalised score and the songs behind it. */
export interface Standing {
  key: string;
  /** Σ weights / √count: positive liked, negative disliked. */
  score: number;
  count: number;
  /** "Artist – Title" of the swipes behind it, strongest first, up to 3. */
  songs: string[];
}

interface Vote {
  key: string;
  w: number;
  /** How much of a swipe this still is after fading (1 when fresh). */
  n: number;
  song: string;
}

function standings(votes: Vote[]): Standing[] {
  const m = new Map<
    string,
    { sum: number; count: number; faded: number; songs: { song: string; w: number }[] }
  >();
  for (const { key, w, n, song } of votes) {
    if (!key) continue;
    const e = m.get(key) ?? { sum: 0, count: 0, faded: 0, songs: [] };
    e.sum += w;
    e.count++;
    e.faded += n;
    e.songs.push({ song, w });
    m.set(key, e);
  }
  return [...m].map(([key, e]) => ({
    key,
    // Faded swipes count less in the denominator too, so old noise can't drown new signal.
    score: e.faded > 0 ? e.sum / Math.sqrt(e.faded) : 0,
    count: e.count,
    songs: [...new Set(e.songs.sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).map((s) => s.song))].slice(0, 3),
  }));
}

/**
 * Highest-scoring keys at or above `min`, and lowest at or below `-min`
 * (those with at least `minDislike` swipes behind them).
 */
function split(list: Standing[], min: number, max = 8, minDislike = MIN_DISLIKE_COUNT): [string[], string[]] {
  const sorted = [...list].sort((a, b) => b.score - a.score);
  const liked = sorted
    .filter((s) => s.score >= min)
    .slice(0, max)
    .map((s) => s.key);
  const disliked = sorted
    .filter((s) => s.score <= -min && s.count >= minDislike)
    .reverse()
    .slice(0, max)
    .map((s) => s.key);
  return [liked, disliked];
}

const yesRate = (js: Judgement[]) => js.filter((j) => j.verdict === "yes").length / js.length;
const avg = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;
const songOf = (j: Judgement) => `${j.artist} – ${j.title}`;

/** Every label's standing, per dimension, from the decided swipes. */
export function explain(history: Judgement[], options: TasteOptions = {}): Record<Dimension, Standing[]> {
  const now = options.now ?? Date.now();
  const muted = new Set(options.muted ?? []);
  const decided = history.filter((j) => j.verdict !== "later");
  const w = (j: Judgement) => agedWeight(j, now);
  const fade = (j: Judgement) => 0.5 ** (Math.max(0, now - j.at) / HALF_LIFE_MS);
  const vote = (j: Judgement, key: string, boost = 1): Vote => ({
    key,
    w: w(j) * boost,
    n: fade(j),
    song: songOf(j),
  });

  const tagVotes = decided.flatMap((j) => {
    const genres = new Set((j.genres ?? []).map(norm));
    return [...new Set(j.tags.map(norm))].map((key) => vote(j, key, genres.has(key) ? 1 + GENRE_BONUS : 1));
  });
  // A tag on most of the songs still counts: mixed swipes score near zero by
  // themselves, and "no" to most of it is exactly what must not be lost.
  const keep = (dimension: Dimension) => (s: Standing) =>
    s.count >= MIN_COUNT && !muted.has(mutedKey(dimension, s.key));

  return {
    tag: standings(tagVotes).filter(keep("tag")),
    era: standings(decided.filter((j) => j.year).map((j) => vote(j, decade(j.year as number)))).filter(
      keep("era"),
    ),
    artist: standings(decided.map((j) => vote(j, j.artist))).filter(keep("artist")),
    country: standings(decided.filter((j) => j.country).map((j) => vote(j, j.country as string))).filter(
      keep("country"),
    ),
  };
}

export function buildTaste(history: Judgement[], options: TasteOptions = {}): TasteProfile {
  const decided = history.filter((j) => j.verdict !== "later");
  const base: TasteProfile = {
    judged: decided.length,
    liked_tags: [],
    disliked_tags: [],
    liked_eras: [],
    disliked_eras: [],
    liked_artists: [],
    disliked_artists: [],
    liked_countries: [],
    disliked_countries: [],
    explicit: "unknown",
    length: "any",
    popularity: "any",
  };
  if (decided.length < MIN_JUDGED) return base;

  const dims = explain(history, options);
  const [likedTags, dislikedTags] = split(dims.tag, 1);
  const [likedEras, dislikedEras] = split(dims.era, 1, 4);
  // Two songs by one artist is already a lot of that artist.
  const [likedArtists, dislikedArtists] = split(dims.artist, 1, 10, MIN_COUNT);
  // Countries need a clear pattern (three songs' worth), not a couple.
  const [likedCountries, dislikedCountries] = split(dims.country, 1.5, 4);

  // Explicit lyrics: only judge with at least 3 explicit songs decided.
  const explicitOnes = decided.filter((j) => j.explicit === true);
  const cleanOnes = decided.filter((j) => j.explicit === false);
  let explicit: TasteProfile["explicit"] = "unknown";
  if (explicitOnes.length >= 3) {
    explicit = cleanOnes.length >= 3 && yesRate(explicitOnes) + 0.3 < yesRate(cleanOnes) ? "avoid" : "fine";
  }

  // Length and popularity: compare yes against no, needing a few of each.
  const yes = decided.filter((j) => j.verdict === "yes");
  const no = decided.filter((j) => j.verdict === "no");
  let length: TasteProfile["length"] = "any";
  const yesLen = yes.flatMap((j) => (j.durationMs ? [j.durationMs] : []));
  const noLen = no.flatMap((j) => (j.durationMs ? [j.durationMs] : []));
  if (yesLen.length >= 3 && noLen.length >= 3) {
    const diff = avg(yesLen) - avg(noLen);
    if (diff <= -45_000) length = "shorter";
    else if (diff >= 45_000) length = "longer";
  }
  let popularity: TasteProfile["popularity"] = "any";
  const yesPop = yes.flatMap((j) => (j.popularity !== undefined ? [j.popularity] : []));
  const noPop = no.flatMap((j) => (j.popularity !== undefined ? [j.popularity] : []));
  if (yesPop.length >= 3 && noPop.length >= 3) {
    const diff = avg(yesPop) - avg(noPop);
    if (diff >= 15) popularity = "well-known";
    else if (diff <= -15) popularity = "lesser-known";
  }

  return {
    ...base,
    liked_tags: likedTags,
    disliked_tags: dislikedTags,
    liked_eras: likedEras,
    disliked_eras: dislikedEras,
    liked_artists: likedArtists,
    disliked_artists: dislikedArtists,
    liked_countries: likedCountries,
    disliked_countries: dislikedCountries,
    explicit,
    length,
    popularity,
  };
}
