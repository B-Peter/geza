<script lang="ts">
import * as claude from "../claude.js";
import * as spotify from "../spotify.js";
import { app, go } from "../state.svelte.js";
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
        <div class="small muted">Your API key · {masked ?? "…"}</div>
      </div>
      <a class="btn secondary small" href="#/key">Change key</a>
    </div>
    <div class="row">
      <span class="ico blue"><Icon name="key" size={18} /></span>
      <div class="grow">
        <div class="name">Model</div>
        <div class="small muted">{claude.MODEL}</div>
      </div>
      <button class="btn secondary small" onclick={removeKey}>Remove</button>
    </div>
  </div>
  <p class="small muted note">
    Runs on your own Anthropic API key, billed to your Anthropic account. Stored encrypted and used only for your picks.
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
</main>

<TabBar active="settings" />

<style>
  .grow { flex: 1; min-width: 0; }
  .name { font-weight: 600; }
  .note { margin: 8px 8px 0; }
  .ico { width: 34px; height: 34px; flex: none; border-radius: 11px; display: flex; align-items: center; justify-content: center; }
  .peach { background: #ffb08f; }
  .blue { background: #b8ccff; }
  .mint { background: #a9ebd0; }
  .yellow { background: #ffe49a; }
</style>
