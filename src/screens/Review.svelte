<script lang="ts">
import { clearPending, type MixId, type SwapEntry, savePending } from "../mixes.js";
import { applyPending } from "../prepare.js";
import { app, go } from "../state.svelte.js";
import { addBlocked } from "../swap.js";
import BackButton from "../ui/BackButton.svelte";
import Icon from "../ui/Icon.svelte";

let { id }: { id: MixId } = $props();
const mix = $derived(app.mix(id));
const swap = $derived(app.pending[id]);

async function apply() {
  if (!swap) return;
  const updated = await app.task("Updating the playlist…", () =>
    applyPending($state.snapshot(mix) as typeof mix, $state.snapshot(swap) as typeof swap),
  );
  if (!updated) return;
  await app.updateMix(id, {
    lastAppliedAt: updated.lastAppliedAt,
    blocked: updated.blocked,
    reasons: updated.reasons,
  });
  delete app.pending[id];
  app.notify(`${mix.name} updated in Spotify.`, "ok");
  go(`/mix/${id}`);
}

/** Keep the old song after all: it's taken out of the swap and locked. */
async function keepOld(entry: SwapEntry) {
  if (!swap) return;
  const next = { ...$state.snapshot(swap), remove: swap.remove.filter((r) => r.track.id !== entry.track.id) };
  app.pending[id] = next as typeof swap;
  await savePending($state.snapshot(next) as typeof swap);
  const track = $state.snapshot(entry.track);
  if (!mix.locked.some((t) => t.id === track.id)) {
    await app.updateMix(id, { locked: [...$state.snapshot(mix.locked), track] });
  }
}

/** Not this new song: it's dropped from the swap and never suggested for this mix again. */
async function vetoNew(entry: SwapEntry) {
  if (!swap) return;
  const next = { ...$state.snapshot(swap), add: swap.add.filter((a) => a.track.id !== entry.track.id) };
  app.pending[id] = next as typeof swap;
  await savePending($state.snapshot(next) as typeof swap);
  await app.updateMix(id, {
    blocked: addBlocked($state.snapshot(mix.blocked), [$state.snapshot(entry.track)]),
  });
}

async function discard() {
  await clearPending(id);
  delete app.pending[id];
  go(`/mix/${id}`);
}
</script>

<BackButton href={`#/mix/${id}`} />

<main class="screen">
  <h1>Swap</h1>
  {#if swap}
    <p class="lead">
      {mix.name} · {swap.remove.length} out, {swap.add.length} in. Nothing changes in Spotify until you tap Apply.
    </p>
    <span class="chip found">
      <Icon name="sparkle" size={15} />
      Picked by Claude · {swap.found === swap.picked ? "all found on Spotify" : `${swap.found} of ${swap.picked} found on Spotify`}
    </span>

    {#if swap.remove.length}
      <div class="label">Going out · {swap.remove.length}</div>
      <div class="card">
        {#each swap.remove as r (r.track.id)}
          <div class="row">
            <div class="song">
              <div class="title out">{r.track.title}</div>
              <div class="small muted">{r.track.artist}</div>
              {#if r.reason}<div class="small why">{r.reason}</div>{/if}
            </div>
            <button class="veto" aria-label={`Keep ${r.track.title}`} onclick={() => keepOld(r)}>Keep</button>
          </div>
        {/each}
      </div>
      <p class="small muted hint">Keep leaves a song in the mix and locks it, so later swaps leave it alone too.</p>
    {/if}

    {#if swap.add.length}
      <div class="label">Coming in · {swap.add.length}</div>
      <div class="card">
        {#each swap.add as r (r.track.id)}
          <div class="row">
            <div class="song">
              <div class="title">{r.track.title}</div>
              <div class="small muted">{r.track.artist}</div>
              {#if r.reason}<div class="small why"><Icon name="sparkle" size={12} />{r.reason}</div>{/if}
            </div>
            <button class="veto" aria-label={`Skip ${r.track.title}`} onclick={() => vetoNew(r)}>Skip</button>
          </div>
        {/each}
      </div>
      <p class="small muted hint">Skip drops a song from this swap and never suggests it for this mix again.</p>
    {/if}

    {#if swap.missing.length}
      <p class="small muted hint">Not on Spotify: {swap.missing.map((m) => `${m.artist} – ${m.title}`).join(", ")}</p>
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
  .row { align-items: flex-start; padding: 12px 12px 12px 16px; }
  .song { flex: 1; min-width: 0; }
  /* Whole titles: this is the screen where you decide by them. */
  .title { font-size: 15px; line-height: 20px; font-weight: 600; overflow-wrap: anywhere; }
  .title.out { text-decoration: line-through; text-decoration-color: var(--muted); }
  .why { display: flex; align-items: flex-start; gap: 4px; margin-top: 3px; color: var(--ink); }
  .why :global(svg) { flex: none; margin-top: 2px; }
  .veto {
    flex: none; min-width: 60px; min-height: 44px; padding: 0 12px; border: 1.5px solid var(--line); border-radius: 22px;
    background: var(--white); font-size: 13px; font-weight: 700; cursor: pointer;
  }
  .hint { margin: 8px 8px 0; }
  .two { display: grid; grid-template-columns: 1fr 1.2fr; gap: 10px; }
</style>
