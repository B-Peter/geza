<script lang="ts">
import { clearPending, type MixId, type SwapEntry } from "../mixes.js";
import { applyPending } from "../prepare.js";
import { app, go } from "../state.svelte.js";
import BackButton from "../ui/BackButton.svelte";
import Icon from "../ui/Icon.svelte";

let { id }: { id: MixId } = $props();
const mix = $derived(app.mix(id));
const swap = $derived(app.pending[id]);

// Pair each removal with an addition; extra additions (filling the mix) stand alone.
const rows = $derived.by(() => {
  if (!swap) return [];
  const n = Math.max(swap.remove.length, swap.add.length);
  const out: { out?: SwapEntry; in?: SwapEntry }[] = [];
  for (let i = 0; i < n; i++) out.push({ out: swap.remove[i], in: swap.add[i] });
  return out;
});

async function apply() {
  if (!swap) return;
  const updated = await app.task("Updating the playlist…", () =>
    applyPending($state.snapshot(mix) as typeof mix, $state.snapshot(swap) as typeof swap),
  );
  if (!updated) return;
  await app.updateMix(id, { lastAppliedAt: updated.lastAppliedAt, blocked: updated.blocked });
  delete app.pending[id];
  app.notify(`${mix.name} updated in Spotify.`, "ok");
  go(`/mix/${id}`);
}

async function discard() {
  await clearPending(id);
  delete app.pending[id];
  go(`/mix/${id}`);
}
</script>

<BackButton href={`#/mix/${id}`} />

<main class="screen">
  <h1>Weekly swap</h1>
  {#if swap}
    <p class="lead">
      {mix.name} · {swap.remove.length} out, {swap.add.length} in. Locked songs stay.
    </p>
    <span class="chip found">
      <Icon name="sparkle" size={15} />
      Picked by Claude · {swap.found === swap.picked ? "all found on Spotify" : `${swap.found} of ${swap.picked} found on Spotify`}
    </span>

    <div class="card list">
      {#each rows as r, i (i)}
        <div class="pair" class:fill={!r.out}>
          {#if r.out}
            <div class="song out">
              <div class="title">{r.out.track.title}</div>
              <div class="small muted">{r.out.track.artist} · {r.out.reason}</div>
            </div>
            <span class="arrow"><Icon name="arrow" size={14} /></span>
          {/if}
          {#if r.in}
            <div class="song">
              <div class="title">{r.in.track.title}</div>
              <div class="small muted">{r.in.track.artist} · {r.in.reason}</div>
            </div>
          {/if}
        </div>
      {/each}
    </div>

    {#if swap.missing.length}
      <p class="small muted">Not on Spotify: {swap.missing.map((m) => `${m.artist} – ${m.title}`).join(", ")}</p>
    {/if}
  {:else}
    <p class="lead">No swap is waiting for this mix.</p>
  {/if}
</main>

{#if swap}
  <div class="actions two">
    <button class="btn secondary" onclick={discard} disabled={!!app.busy}>Discard</button>
    <button class="btn" onclick={apply} disabled={!!app.busy}>{app.busy ?? "Apply"}</button>
  </div>
{/if}

<style>
  .found { margin-top: 12px; }
  .list { margin-top: 12px; }
  .pair {
    display: grid; grid-template-columns: minmax(0, 1fr) 24px minmax(0, 1fr);
    gap: 8px; align-items: center; padding: 10px 14px;
  }
  .pair + .pair { border-top: 1px solid var(--line); }
  .pair.fill { grid-template-columns: minmax(0, 1fr); }
  .song { min-width: 0; }
  .out { opacity: 0.55; }
  .out .title { text-decoration: line-through; }
  .title { font-size: 14px; line-height: 18px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .small { font-size: 11px; line-height: 15px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .arrow {
    width: 24px; height: 24px; border-radius: 50%; background: var(--lime);
    display: flex; align-items: center; justify-content: center;
  }
  .two { display: grid; grid-template-columns: 1fr 1.2fr; gap: 10px; }
</style>
