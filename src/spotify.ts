// Spotify Web API: Authorization Code with PKCE (no client secret), token
// refresh, and the endpoints the app needs.

import { deleteSecret, getSecret, setSecret } from "./store.js";
import { normalize } from "./text.js";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
export const MARKET = "HU";

const SCOPES = [
  "user-read-private",
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-library-read",
  "user-top-read",
  "user-read-recently-played",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
].join(" ");

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
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  type?: string;
  artists: { name: string }[];
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

function randomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join("");
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

async function saveTokens(json: TokenResponse, previousRefresh?: string): Promise<void> {
  const refresh = json.refresh_token ?? previousRefresh;
  if (!refresh) throw new Error("Spotify didn't return a refresh token.");
  await setSecret(TOKEN_SECRET, {
    access_token: json.access_token,
    refresh_token: refresh,
    expires_at: Date.now() + json.expires_in * 1000,
  } satisfies Tokens);
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
    throw new Error(`Spotify login error ${res.status}: ${json.error_description ?? json.error ?? ""}`);
  }
  return json as TokenResponse;
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
  if (saved.returnTo && new URL(saved.returnTo).pathname !== location.pathname) {
    location.assign(saved.returnTo);
  }
  return "done";
}

export async function isLoggedIn(): Promise<boolean> {
  return Boolean(await getSecret<Tokens>(TOKEN_SECRET));
}

export async function logout(): Promise<void> {
  await deleteSecret(TOKEN_SECRET);
}

async function accessToken(): Promise<string> {
  const tokens = await getSecret<Tokens>(TOKEN_SECRET);
  if (!tokens) throw new Error("Not logged in to Spotify.");
  if (Date.now() < tokens.expires_at - 60_000) return tokens.access_token;
  const json = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: getClientId(),
  });
  await saveTokens(json, tokens.refresh_token);
  return json.access_token;
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

export async function api<T>(path: string, { method = "GET", body, query }: ApiOptions = {}): Promise<T> {
  const url = new URL(API + path);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null as T;
  const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) throw new SpotifyError(res.status, path, json?.error?.message ?? res.statusText);
  return json as T;
}

const toTrack = (t: SpotifyTrack): Track => ({
  id: t.id,
  uri: t.uri,
  artist: t.artists.map((a) => a.name).join(", "),
  title: t.name,
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
