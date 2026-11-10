// Taste profile from Train swipes: every attribute of every judged song,
// weighted by how long you listened before deciding. Pure functions.

export type Verdict = "yes" | "no" | "later";

/** One swipe and everything known about the song at that moment. */
export interface Judgement {
  artist: string;
  title: string;
  verdict: Verdict;
  /** Claude's labels: genre, era, mood. */
  tags: string[];
  year?: number;
  durationMs?: number;
  explicit?: boolean;
  /** Spotify's 0–100 score, when Spotify still provides it. */
  popularity?: number;
  /** How long it played before you decided. */
  dwellMs: number;
  at: number;
}

export interface TasteProfile {
  judged: number;
  liked_tags: string[];
  disliked_tags: string[];
  liked_eras: string[];
  disliked_eras: string[];
  liked_artists: string[];
  disliked_artists: string[];
  explicit: "fine" | "avoid" | "unknown";
  length: "shorter" | "longer" | "any";
  popularity: "well-known" | "lesser-known" | "any";
}

/** Below this many decisions the profile says nothing (too noisy). */
export const MIN_JUDGED = 3;

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

export const decade = (year: number): string => `${Math.floor(year / 10) * 10}s`;

const norm = (s: string) => s.trim().toLowerCase();

function scores(entries: [string, number][]): Map<string, number> {
  const m = new Map<string, number>();
  for (const [k, w] of entries) if (k) m.set(k, (m.get(k) ?? 0) + w);
  return m;
}

/** Highest-scoring keys at or above `min`, and lowest at or below `-min`. */
function split(m: Map<string, number>, min: number, max = 8): [string[], string[]] {
  const sorted = [...m].sort((a, b) => b[1] - a[1]);
  const liked = sorted
    .filter(([, s]) => s >= min)
    .slice(0, max)
    .map(([k]) => k);
  const disliked = sorted
    .filter(([, s]) => s <= -min)
    .reverse()
    .slice(0, max)
    .map(([k]) => k);
  return [liked, disliked];
}

const yesRate = (js: Judgement[]) => js.filter((j) => j.verdict === "yes").length / js.length;
const avg = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;

export function buildTaste(history: Judgement[]): TasteProfile {
  const decided = history.filter((j) => j.verdict !== "later");
  const base: TasteProfile = {
    judged: decided.length,
    liked_tags: [],
    disliked_tags: [],
    liked_eras: [],
    disliked_eras: [],
    liked_artists: [],
    disliked_artists: [],
    explicit: "unknown",
    length: "any",
    popularity: "any",
  };
  if (decided.length < MIN_JUDGED) return base;

  const [likedTags, dislikedTags] = split(
    scores(decided.flatMap((j) => j.tags.map((t): [string, number] => [norm(t), weight(j)]))),
    1,
  );
  const [likedEras, dislikedEras] = split(
    scores(decided.filter((j) => j.year).map((j): [string, number] => [decade(j.year as number), weight(j)])),
    1,
    4,
  );
  const [likedArtists, dislikedArtists] = split(
    scores(decided.map((j): [string, number] => [j.artist, weight(j)])),
    1,
    10,
  );

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
    explicit,
    length,
    popularity,
  };
}
