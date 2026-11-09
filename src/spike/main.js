import "./spike.css";
// Milestone 1 spike: go / no-go checks for Spotify and Claude from an
// installed PWA. Each check logs what worked and what failed.

import * as spotify from "../spotify.js";
import * as claude from "../claude.js";
import { requestPersistence } from "../store.js";

const $ = (id) => document.getElementById(id);

function log(message, kind = "info") {
  const li = document.createElement("li");
  li.className = kind;
  li.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  $("log").prepend(li);
}

async function run(button, fn) {
  button.disabled = true;
  try {
    await fn();
  } catch (e) {
    log(e.message || String(e), "fail");
  } finally {
    button.disabled = false;
    await refreshStatus();
  }
}

async function refreshStatus() {
  $("client-id").value = spotify.getClientId();
  $("redirect-uri").textContent = spotify.redirectUri();
  const loggedIn = await spotify.isLoggedIn();
  $("spotify-status").textContent = loggedIn ? "Logged in" : "Not logged in";
  $("spotify-status").className = `chip ${loggedIn ? "ok" : ""}`;
  for (const id of ["btn-profile", "btn-playlist", "btn-logout"]) $(id).disabled = !loggedIn;
  const masked = await claude.maskedKey();
  $("claude-status").textContent = masked ? `Key saved · ${masked}` : "No key";
  $("claude-status").className = `chip ${masked ? "ok" : ""}`;
  $("btn-remove-key").disabled = !masked;
  $("btn-tune").disabled = !(masked && loggedIn);
}

// --- Spotify ---------------------------------------------------------------

$("btn-save-client").addEventListener("click", () => {
  spotify.setClientId($("client-id").value);
  log("Spotify client ID saved.", "ok");
});

$("btn-login").addEventListener("click", (e) =>
  run(e.currentTarget, async () => {
    spotify.setClientId($("client-id").value);
    await spotify.startLogin();
  }),
);

$("btn-logout").addEventListener("click", (e) =>
  run(e.currentTarget, async () => {
    await spotify.logout();
    log("Logged out of Spotify (tokens deleted).", "ok");
  }),
);

$("btn-profile").addEventListener("click", (e) =>
  run(e.currentTarget, async () => {
    const me = await spotify.getProfile();
    log(
      `Profile: ${me.display_name || me.id} · id ${me.id} · country ${me.country ?? "?"} · product ${me.product ?? "?"}`,
      "ok",
    );
    if (me.product && me.product !== "premium") log("Account is not Premium: playback control won't work.", "warn");
  }),
);

$("btn-playlist").addEventListener("click", (e) =>
  run(e.currentTarget, async () => {
    const me = await spotify.getProfile();
    const playlist = await spotify.createPlaylist(
      me.id,
      "Playlist Studio test",
      "Created by the Playlist Studio spike. Safe to delete.",
    );
    log(`Created playlist "${playlist.name}".`, "ok");

    const samples = [
      ["Queen", "Bohemian Rhapsody"],
      ["Daft Punk", "Get Lucky"],
    ];
    const uris = [];
    for (const [artist, title] of samples) {
      const track = await spotify.findTrack(artist, title);
      if (track) {
        uris.push(track.uri);
        log(`Search found: ${track.artist} – ${track.title}`, "ok");
      } else {
        log(`Search found nothing for ${artist} – ${title}`, "warn");
      }
    }
    if (!uris.length) throw new Error("No tracks to add.");
    await spotify.addToPlaylist(playlist.id, uris);
    log(`Added ${uris.length} tracks via /playlists/{id}/${localStorage.getItem("ps.playlistItemsPath")}. Playlist writes work.`, "ok");
    log(`Open it: ${playlist.external_urls?.spotify ?? playlist.uri}`, "info");
  }),
);

// --- Claude ----------------------------------------------------------------

$("btn-save-key").addEventListener("click", (e) =>
  run(e.currentTarget, async () => {
    await claude.testAndSaveKey($("api-key").value);
    $("api-key").value = "";
    log(`Claude key works with ${claude.MODEL} and is saved encrypted on this device.`, "ok");
  }),
);

$("btn-remove-key").addEventListener("click", (e) =>
  run(e.currentTarget, async () => {
    await claude.removeKey();
    log("Claude key removed from this device.", "ok");
  }),
);

// --- Tune check: does Tempo 2 vs 5 change the picks? -------------------------

async function pickAndResolve(seed, tempo) {
  const input = {
    mix: "Driving",
    mode: "renew",
    remove_count: 0,
    add_count: 6,
    tune: { mood: 4, tempo, energy: tempo, fresh: 3, vocals: 4 },
    loved: seed,
    blocked: [],
    locked: [],
    current: [],
    top_artists: [...new Set(seed.map((t) => t.artist))],
    note: "",
  };
  const picks = await claude.curate(input);
  const rows = [];
  for (const p of picks.add) {
    const track = await spotify.findTrack(p.artist, p.title);
    rows.push({ ...p, found: Boolean(track) });
  }
  return { rows };
}

function renderPicks(container, title, rows) {
  const found = rows.filter((r) => r.found).length;
  const section = document.createElement("section");
  const h = document.createElement("h3");
  h.textContent = `${title} · ${rows.length} picks, ${found} on Spotify`;
  const ol = document.createElement("ol");
  for (const r of rows) {
    const li = document.createElement("li");
    li.className = r.found ? "" : "missing";
    const strong = document.createElement("strong");
    strong.textContent = `${r.artist} – ${r.title}`;
    const span = document.createElement("span");
    span.textContent = r.found ? r.reason : `${r.reason} (not found on Spotify)`;
    li.append(strong, span);
    ol.append(li);
  }
  section.append(h, ol);
  container.append(section);
}

$("btn-tune").addEventListener("click", (e) =>
  run(e.currentTarget, async () => {
    const out = $("tune-results");
    out.replaceChildren();
    const top = await spotify.getTopTracks(10);
    const seed = top.map((t) => ({ artist: t.artist, title: t.title }));
    log(`Using ${seed.length} of your top tracks as loved songs.`, "info");
    for (const tempo of [2, 5]) {
      log(`Asking Claude for Driving picks at Tempo ${tempo}…`, "info");
      const { rows } = await pickAndResolve(seed, tempo);
      renderPicks(out, `Tempo ${tempo}`, rows);
      log(
        `Tempo ${tempo}: ${rows.length} picks, ${rows.filter((r) => r.found).length} on Spotify`,
        "ok",
      );
    }
    log("Compare the two lists: Tempo 5 should be clearly faster.", "info");
  }),
);

// --- Startup ---------------------------------------------------------------

(async () => {
  if ("serviceWorker" in navigator) {
    Promise.resolve().catch((e) => log(`Service worker: ${e.message}`, "warn"));
  }
  const persisted = await requestPersistence();
  log(persisted ? "Persistent storage granted." : "Persistent storage not granted (data may be evicted).", persisted ? "ok" : "warn");
  log(
    navigator.standalone || matchMedia("(display-mode: standalone)").matches
      ? "Running as installed app."
      : "Running in the browser tab (not installed).",
    "info",
  );
  try {
    if (await spotify.handleRedirect()) log("Spotify login complete. Tokens saved encrypted.", "ok");
  } catch (e) {
    log(e.message, "fail");
  }
  await refreshStatus();
})();
