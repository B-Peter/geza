// Spotify Web API: Authorization Code with PKCE (no client secret), token
// refresh, and the few endpoints the spike needs.

import { getSecret, setSecret, deleteSecret } from "./store.js";

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
const TOKEN_SECRET = "spotifyTokens";

export function redirectUri() {
  return location.origin + location.pathname;
}

export function getClientId() {
  return localStorage.getItem(CLIENT_ID_KEY) || "";
}

export function setClientId(id) {
  localStorage.setItem(CLIENT_ID_KEY, id.trim());
}

function base64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join("");
}

export async function startLogin() {
  const clientId = getClientId();
  if (!clientId) throw new Error("Set the Spotify client ID first.");
  const verifier = randomString(64);
  const state = randomString(16);
  const challenge = base64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  // localStorage, not sessionStorage: iOS home-screen apps can lose
  // sessionStorage across the OAuth round trip.
  localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
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

async function saveTokens(json, previousRefresh) {
  await setSecret(TOKEN_SECRET, {
    access_token: json.access_token,
    // Spotify may or may not rotate the refresh token.
    refresh_token: json.refresh_token || previousRefresh,
    expires_at: Date.now() + json.expires_in * 1000,
  });
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Spotify token error ${res.status}: ${json.error_description || json.error || ""}`);
  }
  return json;
}

// Call on page load. Returns true if this load was the OAuth callback.
export async function handleRedirect() {
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return false;
  const saved = JSON.parse(localStorage.getItem(PKCE_KEY) || "null");
  localStorage.removeItem(PKCE_KEY);
  history.replaceState(null, "", redirectUri());
  if (params.has("error")) throw new Error(`Spotify login failed: ${params.get("error")}`);
  if (!saved || saved.state !== params.get("state")) {
    throw new Error("Spotify login failed: state mismatch. Try again.");
  }
  const json = await tokenRequest({
    grant_type: "authorization_code",
    code: params.get("code"),
    redirect_uri: redirectUri(),
    client_id: getClientId(),
    code_verifier: saved.verifier,
  });
  await saveTokens(json);
  return true;
}

export async function isLoggedIn() {
  return Boolean(await getSecret(TOKEN_SECRET));
}

export async function logout() {
  await deleteSecret(TOKEN_SECRET);
}

async function accessToken() {
  const tokens = await getSecret(TOKEN_SECRET);
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
  constructor(status, path, message) {
    super(`Spotify ${status} on ${path}: ${message}`);
    this.status = status;
    this.path = path;
  }
}

export async function api(path, { method = "GET", body, query } = {}) {
  const url = new URL(API + path);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new SpotifyError(res.status, path, json?.error?.message || res.statusText);
  return json;
}

export function getProfile() {
  return api("/me");
}

export async function getTopTracks(limit = 10) {
  const json = await api("/me/top/tracks", { query: { limit, time_range: "medium_term" } });
  return json.items;
}

// Playlist endpoints changed for Development Mode apps over time. The spike
// tries the current path first and falls back to the older one, and reports
// which one worked.
export async function createPlaylist(userId, name, description) {
  const body = { name, description, public: false };
  try {
    return { playlist: await api("/me/playlists", { method: "POST", body }), via: "/me/playlists" };
  } catch (e) {
    if (!(e instanceof SpotifyError) || ![403, 404, 405].includes(e.status)) throw e;
    const playlist = await api(`/users/${encodeURIComponent(userId)}/playlists`, { method: "POST", body });
    return { playlist, via: "/users/{id}/playlists", firstError: e.message };
  }
}

export async function addToPlaylist(playlistId, uris) {
  const body = { uris };
  try {
    await api(`/playlists/${playlistId}/items`, { method: "POST", body });
    return { via: "/playlists/{id}/items" };
  } catch (e) {
    if (!(e instanceof SpotifyError) || ![403, 404, 405].includes(e.status)) throw e;
    await api(`/playlists/${playlistId}/tracks`, { method: "POST", body });
    return { via: "/playlists/{id}/tracks", firstError: e.message };
  }
}

const norm = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Resolve an artist/title pair from Claude to a Spotify track, or null.
export async function findTrack(artist, title) {
  const json = await api("/search", {
    query: { q: `track:${title} artist:${artist}`, type: "track", market: MARKET, limit: 5 },
  });
  const items = json?.tracks?.items || [];
  const wanted = norm(artist);
  return (
    items.find((t) => t.artists.some((a) => norm(a.name) === wanted)) ||
    items.find((t) => t.artists.some((a) => norm(a.name).includes(wanted) || wanted.includes(norm(a.name)))) ||
    null
  );
}
