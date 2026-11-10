<script lang="ts">
import type { Mix } from "../mixes.js";
import * as spotify from "../spotify.js";
import { openUri } from "../spotify.js";
import { app } from "../state.svelte.js";
import Cover from "../ui/Cover.svelte";
import Icon from "../ui/Icon.svelte";
import TabBar from "../ui/TabBar.svelte";

const status = (mix: Mix) =>
  app.pending[mix.id]
    ? "Swap ready"
    : { keep: "Kept as is", tweak: "Tweaks weekly", renew: "Fresh weekly" }[mix.mode];

const first = $derived(app.mixes[0]);
</script>

<main class="screen">
  <h1>Mixes</h1>
  {#if first}<p class="lead">Say: “Hey Siri, play {first.playlistName} on Spotify”</p>{/if}

  {#if app.needsReconnect}
    <div class="card reconnect" role="status">
      <div class="reconnect-title">Let Géza learn from your listening</div>
      <p class="small muted">
        Géza can now notice what you heart and play. Spotify needs you to confirm that once.
      </p>
      <button class="btn small" onclick={() => spotify.startLogin().catch((e) => app.notify(e))}>Reconnect Spotify</button>
    </div>
  {/if}

  <div class="grid">
    {#each app.mixes as mix (mix.id)}
      <div class="tile mix-{mix.id}">
        <div class="art"><Cover id={mix.id} /></div>
        <a class="hit" href={`#/mix/${mix.id}`} aria-label={`${mix.name} settings`}></a>
        <div class="meta">
          <div class="name">{mix.name}</div>
          <div class="status" class:ready={app.pending[mix.id]}>{status(mix)}</div>
        </div>
        {#if mix.playlistId}
          <a class="play" href={openUri(mix.playlistId)} aria-label={`Play ${mix.name} in Spotify`}><Icon name="play" size={18} /></a>
        {/if}
      </div>
    {/each}
  </div>

  {#if app.learned && (app.learned.plays || app.learned.liked || app.learned.removedByYou || app.learned.addedByYou || !app.learned.complete)}
    <p class="small muted learned">
      Learned from your listening: {[
        app.learned.plays ? `${app.learned.plays} play${app.learned.plays === 1 ? "" : "s"}` : "",
        app.learned.liked ? `${app.learned.liked} liked` : "",
        app.learned.addedByYou ? `${app.learned.addedByYou} added by you` : "",
        app.learned.removedByYou ? `${app.learned.removedByYou} removed by you` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "nothing new"}.
      {#if !app.learned.complete}Some plays were missed; open Géza every day or two.{/if}
    </p>
  {/if}

  <a class="card row random" href="#/random">
    <span class="ico"><Icon name="sparkle" size={20} /></span>
    <span class="grow">
      <span class="title">Play something random</span>
      <span class="small muted">Set a sound, Claude picks songs for right now</span>
    </span>
    <Icon name="arrow" size={20} />
  </a>
</main>

<TabBar active="mixes" />

<style>
  .grid { margin-top: 14px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .tile { position: relative; height: 176px; border-radius: 28px; overflow: hidden; }
  /* Art and text never overlap: the text block is at most 42px tall and sits
     below the art with room to spare. */
  .art { position: absolute; inset: 0 0 auto 0; height: 92px; }
  .hit { position: absolute; inset: 0; }
  .meta { position: absolute; left: 14px; right: 64px; bottom: 14px; pointer-events: none; }
  .name {
    font: 800 22px/24px var(--display); letter-spacing: -0.01em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .status {
    margin-top: 2px; font-size: 12px; line-height: 16px; font-weight: 600; opacity: 0.85;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
  }
  .status.ready {
    display: inline-block; opacity: 1; background: var(--lime); color: var(--ink);
    padding: 1px 8px; border-radius: 10px;
  }
  .reconnect { margin-top: 14px; padding: 16px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .reconnect-title { font-weight: 700; }
  .reconnect p { margin: 0 0 6px; }
  .learned { margin: 12px 8px 0; }
  .random { margin-top: 12px; min-height: 72px; }
  .random .ico {
    width: 40px; height: 40px; flex: none; border-radius: 12px; background: var(--lime);
    display: flex; align-items: center; justify-content: center;
  }
  .random .grow { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .random .title { font-weight: 700; }
  .play {
    position: absolute; right: 12px; bottom: 12px; width: 44px; height: 44px; border-radius: 50%;
    background: var(--ink); color: var(--white); display: flex; align-items: center; justify-content: center;
  }
</style>
