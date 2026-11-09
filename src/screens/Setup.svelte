<script lang="ts">
import { ensurePlaylists } from "../prepare.js";
import * as spotify from "../spotify.js";
import { app } from "../state.svelte.js";
import Cover from "../ui/Cover.svelte";

async function create() {
  await app.task("Creating playlists…", async () => {
    app.profile ??= await spotify.getProfile();
    const profile = app.profile;
    await ensurePlaylists($state.snapshot(app.mixes) as typeof app.mixes, profile, (m) => app.setMixes(m));
    app.notify("Playlists created in your Spotify library.", "ok");
  });
}
</script>

<main class="screen">
  <h1>Your four mixes</h1>
  <p class="lead">These private playlists are created in your Spotify library. The app fills them and refreshes them each week.</p>

  <div class="card list">
    {#each app.mixes as mix (mix.id)}
      <div class="row">
        <div class="thumb"><Cover id={mix.id} /></div>
        <div class="grow">
          <div class="name">{mix.playlistName}</div>
          <div class="small muted">Say: “Hey Siri, play {mix.playlistName} on Spotify”</div>
        </div>
        {#if mix.playlistId}<span class="chip">Ready</span>{/if}
      </div>
    {/each}
  </div>
</main>

<div class="actions">
  <button class="btn" onclick={create} disabled={!!app.busy}>{app.busy ?? "Create playlists"}</button>
</div>

<style>
  .list { margin-top: 18px; }
  .thumb { width: 44px; height: 44px; flex: none; border-radius: 12px; overflow: hidden; }
  .grow { flex: 1; min-width: 0; }
  .name { font-weight: 700; }
</style>
