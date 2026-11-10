// Spotify Web API: Authorization Code with PKCE (no client secret), token
// refresh, and the endpoints the app needs.

import { deleteSecret, getSecret, setSecret } from "./store.js";
import { normalize } from "./text.js";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
export const MARKET = "HU";

// Only what the app uses today. Milestone 4 (listening history) will add
// user-library-read and user-read-recently-played; the car release will add
// the playback scopes. Each addition means logging in again.
/** Only what the app uses. Adding one means logging in to Spotify again. */
export const REQUIRED_SCOPES = [
  "user-read-private", // /me: country and Premium status
  "user-top-read", // top tracks and artists as taste signals
  "playlist-read-private", // read the mix playlists (they are private)
  "playlist-modify-private", // create and update them
  "user-library-read", // which songs in the mixes you've hearted
  "user-read-recently-played", // which songs in the mixes you've played
  "user-read-playback-state", // Train: find your Spotify app and check what's playing
  "user-modify-playback-state", // Train: play each song in your Spotify app
];
const SCOPES = REQUIRED_SCOPES.join(" ");

const CLIENT_ID_KEY = "ps.spotifyClientId";
const PKCE_KEY = "ps.pkce";
const PLAYLIST_PATH_KEY = "ps.playlistItemsPath";
const TOKEN_SECRET = "spotifyTokens";

/** A track as the app stores it. */
export interface Track {
  id: string;
  uri: string;
  artist: string;
  title: string;
  /** Present on tracks fetched since Train was added. */
  durationMs?: number;
  /** Album cover, a medium-size image on i.scdn.co. */
  image?: string;
  album?: string;
  year?: number;
  explicit?: boolean;
  /** 0–100; Spotify may leave it out for small developer apps. */
  popularity?: number;
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  /** Permissions Spotify granted; missing in logins from before it was recorded. */
  scope?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  type?: string;
  artists: { name: string }[];
  duration_ms?: number;
  explicit?: boolean;
  popularity?: number;
  album?: { name?: string; release_date?: string; images?: { url: string; width?: number | null }[] };
}

export interface Profile {
  id: string;
  display_name: string | null;
  country?: string;
  product?: string;
}

export interface Playlist {
  id: string;
  name: string;
  uri: string;
  external_urls?: { spotify?: string };
}

/** The app's folder, e.g. https://user.github.io/repo/ — one redirect URI for every page. */
export function redirectUri(): string {
  return location.origin + location.pathname.replace(/[^/]*$/, "");
}

/** Client ID baked in at build time (public by design), or entered in the app. */
export const BUILT_IN_CLIENT_ID: string = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? "";

export function getClientId(): string {
  return localStorage.getItem(CLIENT_ID_KEY) || BUILT_IN_CLIENT_ID;
}

export function setClientId(id: string): void {
  localStorage.setItem(CLIENT_ID_KEY, id.trim());
}

function base64url(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Uniformly random string from the PKCE alphabet (rejection sampling, no modulo bias). */
function randomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const limit = 256 - (256 % chars.length);
  let out = "";
  while (out.length < length) {
    for (const v of crypto.getRandomValues(new Uint8Array(length))) {
      if (v < limit && out.length < length) out += chars[v % chars.length];
    }
  }
  return out;
}

export async function startLogin(): Promise<void> {
  const clientId = getClientId();
  if (!clientId) throw new Error("Set the Spotify client ID first.");
  const verifier = randomString(64);
  const state = randomString(16);
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  // localStorage, not sessionStorage: iOS home-screen apps can lose
  // sessionStorage across the OAuth round trip.
  localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, returnTo: location.href }));
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });
  location.assign(`${AUTH_URL}?${params}`);
}

async function saveTokens(json: TokenResponse, previous?: Tokens): Promise<void> {
  const refresh = json.refresh_token ?? previous?.refresh_token;
  if (!refresh) throw new Error("Spotify didn't return a refresh token.");
  await setSecret(TOKEN_SECRET, {
    access_token: json.access_token,
    refresh_token: refresh,
    expires_at: Date.now() + json.expires_in * 1000,
    scope: json.scope ?? previous?.scope,
  } satisfies Tokens);
}

class TokenError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Thrown when the Spotify login can't be refreshed any more; the app logs out. */
export class SessionExpiredError extends Error {
  constructor() {
    super("Your Spotify login expired. Please log in again.");
  }
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token || !json.expires_in) {
    throw new TokenError(
      res.status,
      json.error ?? "unknown",
      `Spotify login error ${res.status}: ${json.error_description ?? json.error ?? ""}`,
    );
  }
  return json as TokenResponse;
}

/**
 * Where to go after login: only another page of this app (same origin,
 * same folder). Anything else is ignored.
 */
function safeReturnTo(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const home = new URL(redirectUri());
    const sameApp = url.origin === home.origin && url.pathname.startsWith(home.pathname);
    return sameApp && url.pathname !== location.pathname ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Call on page load. Finishes the OAuth round trip if this load is the
 * callback. Returns "done" (logged in, may navigate back), or null.
 */
export async function handleRedirect(): Promise<"done" | null> {
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return null;
  const saved = JSON.parse(localStorage.getItem(PKCE_KEY) ?? "null") as {
    verifier: string;
    state: string;
    returnTo?: string;
  } | null;
  localStorage.removeItem(PKCE_KEY);
  history.replaceState(null, "", redirectUri());
  if (params.has("error")) throw new Error(`Spotify login failed: ${params.get("error")}`);
  if (!saved || saved.state !== params.get("state"))
    throw new Error("Spotify login failed: state mismatch. Try again.");
  const json = await tokenRequest({
    grant_type: "authorization_code",
    code: params.get("code") ?? "",
    redirect_uri: redirectUri(),
    client_id: getClientId(),
    code_verifier: saved.verifier,
  });
  await saveTokens(json);
  const back = safeReturnTo(saved.returnTo);
  if (back) location.assign(back);
  return "done";
}

export async function isLoggedIn(): Promise<boolean> {
  return Boolean(await getSecret<Tokens>(TOKEN_SECRET));
}

/** Permissions the app needs but the current login doesn't have. */
export async function missingScopes(): Promise<string[]> {
  const tokens = await getSecret<Tokens>(TOKEN_SECRET);
  if (!tokens) return [];
  const granted = new Set((tokens.scope ?? "").split(/\s+/).filter(Boolean));
  return REQUIRED_SCOPES.filter((s) => !granted.has(s));
}

export async function logout(): Promise<void> {
  await deleteSecret(TOKEN_SECRET);
}

let refreshing: Promise<string> | null = null;

async function refreshAccessToken(tokens: Tokens): Promise<string> {
  let json: TokenResponse;
  try {
    json = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: getClientId(),
    });
  } catch (e) {
    // Refresh token expired or revoked (spotify.com/account/apps): the stored
    // login is dead, so drop it and send the user back to Welcome.
    if (e instanceof TokenError && e.code === "invalid_grant") {
      await logout();
      throw new SessionExpiredError();
    }
    throw e;
  }
  await saveTokens(json, tokens);
  return json.access_token;
}

async function accessToken(force = false): Promise<string> {
  const tokens = await getSecret<Tokens>(TOKEN_SECRET);
  if (!tokens) throw new Error("Not logged in to Spotify.");
  if (!force && Date.now() < tokens.expires_at - 60_000) return tokens.access_token;
  // Single-flight: parallel requests near expiry share one refresh. Spotify
  // rotates refresh tokens, so two refreshes in flight would revoke one.
  refreshing ??= refreshAccessToken(tokens).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export class SpotifyError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(`Spotify ${status} on ${path}: ${message}`);
  }
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number>;
}

function request(
  path: string,
  { method = "GET", body, query }: ApiOptions,
  token: string,
): Promise<Response> {
  const url = new URL(API + path);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Longest Retry-After we wait out in place; beyond that the user is told. */
const MAX_RETRY_AFTER_S = 30;

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  let token = await accessToken();
  let retried401 = false;
  let retried429 = false;
  for (;;) {
    const res = await request(path, options, token);
    if (res.status === 401 && !retried401) {
      // Token rejected before its expiry. Another request may have refreshed
      // meanwhile; use that, else force one refresh. Never more than once.
      retried401 = true;
      const latest = await accessToken();
      token = latest !== token ? latest : await accessToken(true);
      continue;
    }
    if (res.status === 429 && !retried429) {
      retried429 = true;
      const wait = Number(res.headers.get("Retry-After") ?? "1");
      if (Number.isFinite(wait) && wait <= MAX_RETRY_AFTER_S) {
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      const when = Number.isFinite(wait) ? `in ${Math.ceil(wait / 60)} min` : "later";
      throw new SpotifyError(429, path, `rate limited, try again ${when}`);
    }
    if (res.status === 204) return null as T;
    const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (!res.ok) throw new SpotifyError(res.status, path, json?.error?.message ?? res.statusText);
    return json as T;
  }
}

function cover(t: SpotifyTrack): string | undefined {
  const images = t.album?.images ?? [];
  // Spotify lists sizes large to small; take the first one at most 300 px wide.
  const url = (images.find((i) => (i.width ?? 0) <= 300) ?? images[images.length - 1])?.url;
  return url?.startsWith("https://i.scdn.co/") ? url : undefined;
}

function releaseYear(t: SpotifyTrack): number | undefined {
  const y = Number(t.album?.release_date?.slice(0, 4));
  return y > 1900 && y < 2100 ? y : undefined;
}

const toTrack = (t: SpotifyTrack): Track => ({
  id: t.id,
  uri: t.uri,
  artist: t.artists.map((a) => a.name).join(", "),
  title: t.name,
  ...(t.duration_ms ? { durationMs: t.duration_ms } : {}),
  ...(cover(t) ? { image: cover(t) } : {}),
  ...(t.album?.name ? { album: t.album.name } : {}),
  ...(releaseYear(t) ? { year: releaseYear(t) } : {}),
  ...(typeof t.explicit === "boolean" ? { explicit: t.explicit } : {}),
  ...(typeof t.popularity === "number" ? { popularity: t.popularity } : {}),
});

export function getProfile(): Promise<Profile> {
  return api<Profile>("/me");
}

export async function getTopTracks(limit = 20): Promise<Track[]> {
  const json = await api<{ items: SpotifyTrack[] }>("/me/top/tracks", {
    query: { limit, time_range: "medium_term" },
  });
  return json.items.map(toTrack);
}

export async function getTopArtists(limit = 20): Promise<string[]> {
  const json = await api<{ items: { name: string }[] }>("/me/top/artists", {
    query: { limit, time_range: "medium_term" },
  });
  return json.items.map((a) => a.name);
}

const retryable = (e: unknown) => e instanceof SpotifyError && [403, 404, 405].includes(e.status);

// Playlist endpoints changed for Development Mode apps (".../items" vs the
// older ".../tracks"). Try the remembered one first, then the other.
async function playlistItemsCall<T>(playlistId: string, options: ApiOptions): Promise<T> {
  const paths = ["items", "tracks"];
  const remembered = localStorage.getItem(PLAYLIST_PATH_KEY);
  if (remembered === "tracks") paths.reverse();
  let lastError: unknown;
  for (const p of paths) {
    try {
      const result = await api<T>(`/playlists/${playlistId}/${p}`, options);
      localStorage.setItem(PLAYLIST_PATH_KEY, p);
      return result;
    } catch (e) {
      if (!retryable(e)) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

export async function createPlaylist(userId: string, name: string, description: string): Promise<Playlist> {
  const body = { name, description, public: false };
  try {
    return await api<Playlist>("/me/playlists", { method: "POST", body });
  } catch (e) {
    if (!retryable(e)) throw e;
    return api<Playlist>(`/users/${encodeURIComponent(userId)}/playlists`, { method: "POST", body });
  }
}

export async function getPlaylistTracks(playlistId: string): Promise<Track[]> {
  const out: Track[] = [];
  for (let offset = 0; ; offset += 50) {
    const page = await playlistItemsCall<{
      items: { track?: SpotifyTrack | null; item?: SpotifyTrack | null }[];
      next: string | null;
    }>(playlistId, { query: { limit: 50, offset, market: MARKET } });
    for (const entry of page.items) {
      const t = entry.track ?? entry.item;
      if (t?.id && (t.type ?? "track") === "track") out.push(toTrack(t));
    }
    if (!page.next) return out;
  }
}

/** Replace the playlist's contents with these tracks, in order. */
export async function replacePlaylistTracks(playlistId: string, uris: string[]): Promise<void> {
  const [first, ...rest] = chunk(uris, 100);
  await playlistItemsCall(playlistId, { method: "PUT", body: { uris: first ?? [] } });
  for (const part of rest) {
    await playlistItemsCall(playlistId, { method: "POST", body: { uris: part } });
  }
}

export async function addToPlaylist(playlistId: string, uris: string[]): Promise<void> {
  for (const part of chunk(uris, 100)) {
    await playlistItemsCall(playlistId, { method: "POST", body: { uris: part } });
  }
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Resolve an artist/title pair from Claude to a Spotify track, or null. */
export async function findTrack(artist: string, title: string): Promise<Track | null> {
  const json = await api<{ tracks?: { items: SpotifyTrack[] } }>("/search", {
    query: { q: `track:${title} artist:${artist}`, type: "track", market: MARKET, limit: 5 },
  });
  const items = json.tracks?.items ?? [];
  const wanted = normalize(artist);
  const match =
    items.find((t) => t.artists.some((a) => normalize(a.name) === wanted)) ??
    items.find((t) =>
      t.artists.some((a) => {
        const n = normalize(a.name);
        return n.includes(wanted) || wanted.includes(n);
      }),
    );
  return match ? toTrack(match) : null;
}

/** Link that opens the playlist in the Spotify app. */
export const openUri = (playlistId: string) => `spotify:playlist:${playlistId}`;

export interface RecentPlay {
  trackId: string;
  playedAt: number;
}

/**
 * Plays after `afterMs` (Spotify lists only plays of ~30 s or more, and only
 * the last 50). `complete` is false when there were more plays than Spotify
 * returns, i.e. some were missed because the app wasn't opened for a while.
 */
export async function getRecentlyPlayed(
  afterMs: number | null,
): Promise<{ plays: RecentPlay[]; complete: boolean }> {
  const json = await api<{ items: { track: SpotifyTrack | null; played_at: string }[] }>(
    "/me/player/recently-played",
    { query: { limit: 50, ...(afterMs ? { after: afterMs } : {}) } },
  );
  const plays = json.items
    .filter((i) => i.track?.id)
    .map((i) => ({ trackId: (i.track as SpotifyTrack).id, playedAt: Date.parse(i.played_at) }));
  return { plays, complete: afterMs === null || json.items.length < 50 };
}

/** Which of these track IDs are in your Liked Songs. */
export async function likedAmong(ids: string[]): Promise<Set<string>> {
  const liked = new Set<string>();
  for (const part of chunk([...new Set(ids)], 40)) {
    const flags = await api<boolean[]>("/me/tracks/contains", { query: { ids: part.join(",") } });
    part.forEach((id, i) => {
      if (flags[i]) liked.add(id);
    });
  }
  return liked;
}

// --- Playback in your Spotify app (Train) ---------------------------------

export interface Device {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
}

export async function getDevices(): Promise<Device[]> {
  const json = await api<{ devices: Device[] }>("/me/player/devices");
  return json.devices.filter((d) => d.id);
}

/** The phone's Spotify app if it's running, else whatever is active. */
export function pickDevice(devices: Device[]): Device | null {
  return (
    devices.find((d) => d.is_active) ??
    devices.find((d) => d.type.toLowerCase() === "smartphone") ??
    devices[0] ??
    null
  );
}

/**
 * Play `uris` as one list, starting with the first at `positionMs`. Spotify
 * buffers the next item in a list ahead of time, so the following swipe can
 * start quickly. One request does both the jump and the seek.
 */
export async function playList(deviceId: string, uris: string[], positionMs: number): Promise<void> {
  await api(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: "PUT",
    body: { uris, offset: { position: 0 }, position_ms: Math.max(0, Math.round(positionMs)) },
  });
}

export async function pause(deviceId: string): Promise<void> {
  await api(`/me/player/pause?device_id=${encodeURIComponent(deviceId)}`, { method: "PUT" });
}

/** The track Spotify is playing right now, or null. */
export async function nowPlaying(): Promise<{ trackId: string; isPlaying: boolean } | null> {
  const json = await api<{ is_playing?: boolean; item?: { id?: string } | null } | null>(
    "/me/player/currently-playing",
  );
  return json?.item?.id ? { trackId: json.item.id, isPlaying: Boolean(json.is_playing) } : null;
}

/** Look up each pick on Spotify, four at a time (gentle on rate limits). */
export async function findAll<P extends { artist: string; title: string }>(
  picks: P[],
): Promise<{ pick: P; track: Track | null }[]> {
  const out: { pick: P; track: Track | null }[] = new Array(picks.length);
  let next = 0;
  const worker = async () => {
    while (next < picks.length) {
      const i = next++;
      const pick = picks[i];
      if (pick) out[i] = { pick, track: await findTrack(pick.artist, pick.title) };
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}
