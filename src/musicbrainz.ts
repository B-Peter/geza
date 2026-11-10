// Song details from MusicBrainz, the open music database: the album's
// original release year (Spotify often shows a remaster's year), and the
// artist's country, type (group or person) and community genres.
//
// MusicBrainz asks for at most 1 request per second, so lookups go through a
// queue, and results are cached on the device (artists forever, albums too).
// Failures are quiet: enrichment is a bonus, never a blocker.

import * as store from "./store.js";
import { normalize } from "./text.js";

const API = "https://musicbrainz.org/ws/2";
const GAP_MS = 1100;

export interface ArtistInfo {
  country?: string;
  type?: string;
  genres: string[];
}

export interface Enrichment {
  /** First release year of the album (not of a later remaster). */
  originalYear?: number;
  country?: string;
  artistType?: string;
  genres: string[];
}

// --- Parsing (pure, tested) ---------------------------------------------

/** Tags that aren't genres, or are too vague to learn from. */
const NOT_GENRES =
  /^(seen live|favou?rites?|british|english|american|uk|usa|us|male vocalists?|female vocalists?|\d{2,4}s|\d{4}|awesome|love)$/;

export function pickArtist(json: unknown, name: string): ArtistInfo | null {
  const artists = (json as { artists?: unknown[] })?.artists ?? [];
  const wanted = normalize(name);
  const hit = artists.find((a) => {
    const x = a as { score?: number; name?: string };
    return (x.score ?? 0) >= 90 && normalize(x.name ?? "") === wanted;
  }) as { country?: string; type?: string; tags?: { name: string; count: number }[] } | undefined;
  if (!hit) return null;
  const genres = (hit.tags ?? [])
    .filter((t) => t.count > 0 && !NOT_GENRES.test(t.name.toLowerCase()))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map((t) => t.name.toLowerCase());
  return {
    ...(hit.country ? { country: hit.country } : {}),
    ...(hit.type ? { type: hit.type } : {}),
    genres,
  };
}

/** "A Night at the Opera (2011 Remaster)" → "A Night at the Opera". */
export const cleanAlbum = (title: string): string =>
  title
    .replace(
      /\s*[([][^)\]]*(remaster|deluxe|edition|anniversary|expanded|version|mono|stereo|bonus)[^)\]]*[)\]]/gi,
      "",
    )
    .replace(/\s+-\s+.*(remaster|deluxe|edition|anniversary).*$/i, "")
    .trim();

export function pickYear(json: unknown, album: string): number | undefined {
  const groups = (json as { "release-groups"?: unknown[] })?.["release-groups"] ?? [];
  const wanted = normalize(album);
  const hit = groups.find((g) => {
    const x = g as { score?: number; title?: string; "secondary-types"?: string[] };
    return (
      (x.score ?? 0) >= 90 &&
      normalize(x.title ?? "") === wanted &&
      !(x["secondary-types"] ?? []).some((t) => /compilation|live|remix/i.test(t))
    );
  }) as { "first-release-date"?: string } | undefined;
  const y = Number(hit?.["first-release-date"]?.slice(0, 4));
  return y > 1900 && y < 2100 ? y : undefined;
}

// --- Network, rate-limited and cached -----------------------------------

let last = 0;
let chain: Promise<unknown> = Promise.resolve();

/** One request at a time, at least GAP_MS apart. */
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run;
}

async function get(path: string, query: string): Promise<unknown> {
  return queued(async () => {
    const res = await fetch(`${API}${path}?query=${encodeURIComponent(query)}&limit=5&fmt=json`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`MusicBrainz ${res.status}`);
    return res.json();
  });
}

const quote = (s: string) => `"${s.replace(/["\\]/g, " ")}"`;

export async function artistInfo(name: string): Promise<ArtistInfo | null> {
  const key = `mb:artist:${normalize(name)}`;
  const cached = await store.get<ArtistInfo | "none">(key);
  if (cached) return cached === "none" ? null : cached;
  const info = pickArtist(await get("/artist", `artist:${quote(name)}`), name);
  await store.set(key, info ?? "none");
  return info;
}

export async function albumYear(album: string, artist: string): Promise<number | undefined> {
  const title = cleanAlbum(album);
  const key = `mb:album:${normalize(artist)}|${normalize(title)}`;
  const cached = await store.get<number | "none">(key);
  if (cached) return cached === "none" ? undefined : cached;
  const year = pickYear(
    await get("/release-group", `releasegroup:${quote(title)} AND artist:${quote(artist)}`),
    title,
  );
  await store.set(key, year ?? "none");
  return year;
}

/** Everything MusicBrainz knows that helps; never throws. */
export async function enrich(t: { artist: string; album?: string }): Promise<Enrichment> {
  const mainArtist = t.artist.split(",")[0]?.trim() ?? t.artist;
  const [artist, year] = await Promise.all([
    artistInfo(mainArtist).catch(() => null),
    t.album ? albumYear(t.album, mainArtist).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  return {
    genres: artist?.genres ?? [],
    ...(artist?.country ? { country: artist.country } : {}),
    ...(artist?.type ? { artistType: artist.type } : {}),
    ...(year ? { originalYear: year } : {}),
  };
}

/** "GB" → "United Kingdom" (falls back to the code). */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
