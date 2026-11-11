<script lang="ts">
import { countryName } from "../musicbrainz.js";
import { app } from "../state.svelte.js";
import {
  buildTaste,
  type Dimension,
  explain,
  MIN_COUNT,
  MIN_DISLIKE_COUNT,
  MIN_JUDGED,
  mutedKey,
  type Standing,
} from "../taste.js";
import { loadTrain, setMuted, type TrainData } from "../train.js";
import BackButton from "../ui/BackButton.svelte";

let data = $state<TrainData | null>(null);
$effect(() => {
  void loadTrain().then((d) => (data = d));
});

const muted = $derived(new Set(data?.muted ?? []));
const history = $derived(data?.history ?? []);
const profile = $derived(buildTaste(history, { muted: [...muted] }));
/** Every label, muted ones included (so they can be switched back on). */
const dims = $derived(explain(history));

const sections: { dim: Dimension; title: string; hint: string }[] = [
  { dim: "tag", title: "Genres and moods", hint: "From Claude's labels and MusicBrainz genres" },
  { dim: "era", title: "Eras", hint: "The decade each song first came out" },
  { dim: "artist", title: "Artists", hint: "Only artists you swiped more than once" },
  { dim: "country", title: "Where artists are from", hint: "From MusicBrainz" },
];

/** Liked first, then disliked; the strongest of each at the front. Labels near zero are left out. */
function ranked(list: Standing[]): Standing[] {
  return list.filter((s) => Math.abs(s.score) >= 0.5).sort((a, b) => b.score - a.score);
}

/** Enough no's behind it that Géza really avoids it (see buildTaste). */
const avoided = (dim: Dimension, s: Standing) =>
  s.score < 0 && s.count >= (dim === "artist" ? MIN_COUNT : MIN_DISLIKE_COUNT);

const label = (dim: Dimension, key: string) => (dim === "country" ? countryName(key.toUpperCase()) : key);

async function toggle(dim: Dimension, key: string) {
  if (!data) return;
  const k = mutedKey(dim, key);
  data = await setMuted($state.snapshot(data) as TrainData, k, !muted.has(k));
}

const readouts = $derived(
  [
    profile.explicit === "avoid"
      ? "Avoids explicit lyrics"
      : profile.explicit === "fine"
        ? "Explicit lyrics are fine"
        : "",
    profile.length === "shorter"
      ? "Prefers shorter songs"
      : profile.length === "longer"
        ? "Prefers longer songs"
        : "",
    profile.popularity === "lesser-known"
      ? "Leans to lesser-known songs"
      : profile.popularity === "well-known"
        ? "Leans to well-known songs"
        : "",
  ].filter(Boolean),
);
</script>

<BackButton href="#/train" label="Back to Discover" />

<main class="screen">
  <h1>What Géza learned</h1>
  {#if !data}
    <p class="lead">Loading…</p>
  {:else if profile.judged < MIN_JUDGED}
    <p class="lead">
      Nothing yet: Géza needs at least {MIN_JUDGED} swipes in Discover before it reads anything into them.
    </p>
    <a class="btn" href="#/train">Open Discover</a>
  {:else}
    <p class="lead">
      From {profile.judged} swipes. Green is what you keep saying yes to, red what Géza now avoids (three no's or
      more); white leans to no but isn't decided yet. Tap a label to switch it off if Géza got it wrong; tap again
      to switch it back on.
    </p>
    {#if readouts.length}
      <div class="card readouts">
        {#each readouts as line (line)}<div class="row small">{line}</div>{/each}
      </div>
    {/if}
    {#each sections as s (s.dim)}
      {@const list = ranked(dims[s.dim])}
      <div class="label">{s.title}</div>
      {#if list.length === 0}
        <p class="small muted none">Nothing clear yet. {s.hint}.</p>
      {:else}
        <div class="chips" role="group" aria-label={s.title}>
          {#each list as st (st.key)}
            {@const off = muted.has(mutedKey(s.dim, st.key))}
            <button
              class="chip"
              class:liked={st.score > 0}
              class:disliked={avoided(s.dim, st)}
              class:off
              aria-pressed={!off}
              title={st.songs.join(", ")}
              onclick={() => toggle(s.dim, st.key)}
            >
              <span class="chip-text">{label(s.dim, st.key)}</span>
              <span class="count">{st.count}</span>
            </button>
          {/each}
        </div>
        <p class="small muted none">{s.hint}. The number is how many swipes are behind it.</p>
      {/if}
    {/each}
    {#if app.profile}
      <p class="small muted none">Switched-off labels stay out of every pick until you switch them back on.</p>
    {/if}
  {/if}
</main>

<style>
  .lead { margin-top: 8px; }
  .readouts { margin-top: 12px; }
  .readouts .row { min-height: 40px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip {
    display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 12px 0 14px;
    border-radius: 22px; border: 1.5px solid var(--line); background: var(--white);
    font-size: 14px; font-weight: 700; cursor: pointer; max-width: 100%;
  }
  .chip-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chip.liked { background: var(--lime); border-color: var(--ink); }
  .chip.disliked { background: #ffe3d6; border-color: var(--danger); }
  .chip.off { background: var(--bg); border-style: dashed; color: var(--muted); text-decoration: line-through; }
  .count {
    flex: none; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px;
    background: rgba(20, 19, 15, 0.1); font-size: 11px; line-height: 20px; text-align: center;
  }
  .none { margin: 8px 8px 0; }
</style>
