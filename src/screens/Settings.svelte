<script lang="ts">
import * as claude from "../claude.js";
import { forgetDecks } from "../deckCache.js";
import * as spotify from "../spotify.js";
import { app, go } from "../state.svelte.js";
import { forgetListening } from "../train.js";
import Icon from "../ui/Icon.svelte";
import TabBar from "../ui/TabBar.svelte";

let masked = $state<string | null>(null);
$effect(() => {
  void app.hasKey;
  void claude.maskedKey().then((k) => (masked = k));
});

async function removeKey() {
  if (!confirm("Remove your Claude key from this device?")) return;
  await claude.removeKey();
  app.hasKey = false;
  go("/key");
}

async function logout() {
  if (!confirm("Log out of Spotify on this device? Your playlists stay in Spotify.")) return;
  await spotify.logout();
  // The next account has its own listening; nothing prepared for this one is kept.
  await Promise.all([forgetListening(), forgetDecks()]).catch(() => {});
  app.loggedIn = false;
  app.profile = null;
}
</script>

<main class="screen">
  <h1>Settings</h1>

  <div class="label">Curator</div>
  <div class="card">
    <div class="row">
      <span class="ico peach"><Icon name="sparkle" size={18} /></span>
      <div class="grow">
        <div class="name">Claude</div>
        <div class="small muted">{claude.MODEL}</div>
      </div>
    </div>
    <div class="row">
      <span class="ico blue"><Icon name="key" size={18} /></span>
      <div class="grow">
        <div class="name">API key</div>
        <div class="small muted">Ends in {masked ? masked.slice(-4) : "…"}</div>
      </div>
      <a class="btn secondary small" href="#/key">Change</a>
      <button class="btn danger small" onclick={removeKey}>Remove</button>
    </div>
  </div>
  <p class="small muted note">
    Runs on your own Anthropic API key, billed to your Anthropic account. Stored encrypted and used only for your picks.
    Removing it here only deletes it from this device; to cancel the key itself, delete it at
    <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a>.
  </p>

  <div class="label">Spotify</div>
  <div class="card">
    <div class="row">
      <span class="ico mint"><Icon name="check" size={18} /></span>
      <div class="grow">
        <div class="name">Linked as {app.profile?.display_name ?? app.profile?.id ?? "…"}</div>
        <div class="small muted">{app.profile?.product === "premium" ? "Premium" : (app.profile?.product ?? "")}</div>
      </div>
      <button class="btn secondary small" onclick={logout}>Log out</button>
    </div>
  </div>
  <p class="small muted note">
    Logging out deletes the login from this device. To take away the app's access completely, remove Géza at
    <a href="https://www.spotify.com/account/apps/" target="_blank" rel="noopener noreferrer">spotify.com/account/apps</a>.
  </p>

  <div class="label">More</div>
  <div class="card">
    <a class="row" href="spike.html">
      <span class="ico yellow"><Icon name="settings" size={18} /></span>
      <div class="grow">
        <div class="name">Diagnostics</div>
        <div class="small muted">Spotify and Claude connection checks</div>
      </div>
    </a>
  </div>
  <p class="small muted version"><strong>Version {__APP_VERSION__}</strong><br />{__APP_BUILD__}</p>
</main>

<TabBar active="settings" />

<style>
  .grow { flex: 1; min-width: 0; }
  .name { font-weight: 600; }
  .note a { text-decoration: underline; }
  .version { margin: 14px 8px 0; text-align: center; }
  .note { margin: 8px 8px 0; }
  .ico { width: 34px; height: 34px; flex: none; border-radius: 11px; display: flex; align-items: center; justify-content: center; }
  .peach { background: #ffb08f; }
  .blue { background: #b8ccff; }
  .mint { background: #a9ebd0; }
  .yellow { background: #ffe49a; }
</style>
