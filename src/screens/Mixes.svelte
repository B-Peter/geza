<script lang="ts">
import { loadLedger } from "../ledger.js";
import type { Mix, MixId } from "../mixes.js";
import * as spotify from "../spotify.js";
import { openUri } from "../spotify.js";
import { app } from "../state.svelte.js";
import { loadTrain } from "../train.js";
import Cover from "../ui/Cover.svelte";
import Icon from "../ui/Icon.svelte";
import TabBar from "../ui/TabBar.svelte";

const DAY_MS = 24 * 3_600_000;
/** After this many days a mix that changes is due for a swap. */
const DUE_DAYS = 7;

/** How many swipes Géza has to go on; null while loading. */
let swipes = $state<number | null>(null);
$effect(() => {
  void loadTrain().then((d) => (swipes = d.history.length));
});

/** Songs in each mix as Géza last saw it; missing while that isn't known yet. */
let sizes = $state<Partial<Record<MixId, number>>>({});
async function loadSizes() {
  const next: Partial<Record<MixId, number>> = {};
  for (const m of app.mixes) {
    const known = (await loadLedger(m.id)).known;
    if (known) next[m.id] = known.length;
  }
  sizes = next;
}
// Learning reads the playlists: the sizes are fresh after it.
$effect(() => {
  void app.learned;
  void app.mixesChanged;
  void loadSizes();
});

const empty = $derived(app.mixes.filter((m) => sizes[m.id] === 0));

// The clock is read each time: a swap can finish after this screen opened.
const daysSince = (mix: Mix) =>
  mix.lastAppliedAt ? Math.max(0, Math.floor((Date.now() - mix.lastAppliedAt) / DAY_MS)) : null;
const due = (mix: Mix) => mix.mode !== "keep" && sizes[mix.id] !== 0 && (daysSince(mix) ?? 0) >= DUE_DAYS;

function status(mix: Mix): string {
  if (app.preparing[mix.id]) return sizes[mix.id] === 0 ? "Filling…" : "Preparing a swap…";
  if (app.pending[mix.id]) return "Swap ready";
  if (sizes[mix.id] === 0) return "Empty";
  if (mix.mode === "keep") return "Kept as is";
  const days = daysSince(mix);
  if (days === null) return "No swap yet";
  if (days >= DUE_DAYS) return "Swap due";
  return days === 0 ? "Swapped today" : days === 1 ? "Swapped yesterday" : `Swapped ${days} days ago`;
}

/** Mixes being filled right now, with what each is doing. */
const filling = $derived(app.mixes.filter((m) => sizes[m.id] === 0 && app.preparing[m.id]));
/** Empty mixes nobody is filling yet. */
const waiting = $derived(empty.filter((m) => !app.preparing[m.id]));

const first = $derived(app.mixes[0]);
</script>

<main class="screen">
  <h1>Mixes</h1>
  {#if first}<p class="lead">Say: “Hey Siri, play {first.playlistName} on Spotify”</p>{/if}

  {#if app.needsReconnect}
    <div class="card reconnect" role="status">
      <div class="reconnect-title">Reconnect Spotify</div>
      <p class="small muted">
        Géza needs a new Spotify permission: he can now learn from what you heart and play. Spotify needs you to
        confirm that once.
      </p>
      <button class="btn small" onclick={() => spotify.startLogin().catch((e) => app.notify(e))}>Reconnect Spotify</button>
    </div>
  {/if}

  {#if swipes === 0}
    <a class="card row random nudge" href="#/train">
      <span class="ico"><Icon name="discover" size={20} /></span>
      <span class="grow">
        <span class="title">Start with Discover</span>
        <span class="small">No swipes yet: do one deck first, so Géza knows your taste, not just your top tracks</span>
      </span>
      <Icon name="arrow" size={20} />
    </a>
  {/if}

  {#if filling.length > 0}
    <div class="card reconnect" role="status" aria-live="polite">
      <div class="reconnect-title">
        Filling {filling.length === 1 ? filling[0]?.name : `${filling.length} mixes`}…
      </div>
      <ul class="progress small">
        {#each filling as m (m.id)}
          <li><span class="dot mix-{m.id}" aria-hidden="true"></span><strong>{m.name}</strong> · {app.preparing[m.id]}</li>
        {/each}
      </ul>
      <p class="small muted">Keep using Géza: swipe a deck meanwhile. Each tile says when its mix is ready.</p>
    </div>
  {:else if waiting.length > 0}
    <div class="card reconnect" role="status">
      <div class="reconnect-title">
        {waiting.length === app.mixes.length ? "Your mixes are empty" : waiting.length === 1 ? `${waiting[0]?.name} is empty` : `${waiting.length} mixes are empty`}
      </div>
      <p class="small muted">
        Géza picks 25 songs for {waiting.length === 1 ? "it" : "each"}, from your listening and your swipes. It runs in
        the background.
      </p>
      <button class="btn small" onclick={() => app.fillEmpty(waiting.map((m) => m.id))}>
        {waiting.length === 1 ? "Fill it" : `Fill all ${waiting.length}`}
      </button>
    </div>
  {/if}

  <div class="grid">
    {#each app.mixes as mix (mix.id)}
      <div class="tile mix-{mix.id}">
        <div class="art"><Cover id={mix.id} /></div>
        <a class="hit" href={`#/mix/${mix.id}`} aria-label={`${mix.name} settings`}></a>
        <div class="meta">
          <div class="name">{mix.name}</div>
          <div class="status" class:ready={app.pending[mix.id] || due(mix)}>{status(mix)}</div>
        </div>
        {#if mix.playlistId && sizes[mix.id] !== 0}
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
      <span class="small muted">Set a sound, Géza picks songs for right now</span>
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
  .progress { list-style: none; margin: 2px 0 4px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .progress li { display: flex; align-items: center; gap: 8px; }
  .dot { width: 10px; height: 10px; flex: none; border-radius: 50%; }
  .random { margin-top: 12px; min-height: 72px; }
  .random.nudge { background: var(--lime); }
  .random.nudge .ico { background: var(--white); }
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
