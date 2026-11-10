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
  <h1>Weekly swap</h1>
  {#if swap}
    <p class="lead">
      {mix.name} · {swap.remove.length} out, {swap.add.length} in. Locked songs stay. Tap Keep or Skip to change
      Claude's mind on any row.
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
            <button class="veto" aria-label={`Keep ${r.out.track.title}`} onclick={() => keepOld(r.out as SwapEntry)}>Keep</button>
            <span class="arrow"><Icon name="arrow" size={14} /></span>
          {/if}
          {#if r.in}
            <div class="song">
              <div class="title">{r.in.track.title}</div>
              <div class="small muted">{r.in.track.artist} · {r.in.reason}</div>
            </div>
            <button class="veto" aria-label={`Skip ${r.in.track.title}`} onclick={() => vetoNew(r.in as SwapEntry)}>Skip</button>
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
    display: grid; grid-template-columns: minmax(0, 1fr) auto 24px minmax(0, 1fr) auto;
    gap: 6px; align-items: center; padding: 6px 10px 6px 14px;
  }
  .pair + .pair { border-top: 1px solid var(--line); }
  .pair.fill { grid-template-columns: minmax(0, 1fr) auto; }
  .veto {
    min-width: 44px; min-height: 44px; padding: 0 8px; border: 1.5px solid var(--line); border-radius: 14px;
    background: var(--white); font-size: 12px; font-weight: 700; cursor: pointer;
  }
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
