<script lang="ts">
import type { Mix } from "../mixes.js";
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
  .play {
    position: absolute; right: 12px; bottom: 12px; width: 44px; height: 44px; border-radius: 50%;
    background: var(--ink); color: var(--white); display: flex; align-items: center; justify-content: center;
  }
</style>
