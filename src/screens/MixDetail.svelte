<script lang="ts">
import { badge, loadLedger, type MixLedger } from "../ledger.js";
import { loadSnapshots, type MixId, type Mode, SWAP_PCT } from "../mixes.js";
import { prepareSwap, undoLastSwap } from "../prepare.js";
import type { Track } from "../spotify.js";
import * as spotify from "../spotify.js";
import { app, go } from "../state.svelte.js";
import BackButton from "../ui/BackButton.svelte";
import Cover from "../ui/Cover.svelte";
import Icon from "../ui/Icon.svelte";
import Radar from "../ui/Radar.svelte";

const now = Date.now();

let { id }: { id: MixId } = $props();
const mix = $derived(app.mix(id));

let tracks = $state<Track[] | null>(null);
let ledger = $state<MixLedger | null>(null);
let canUndo = $state(false);
let note = $state("");

async function load() {
  note = app.mix(id).note;
  canUndo = (await loadSnapshots(id)).length > 0;
  ledger = await loadLedger(id);
  const playlistId = app.mix(id).playlistId;
  if (!playlistId) return;
  try {
    tracks = await spotify.getPlaylistTracks(playlistId);
  } catch (e) {
    app.notify(e);
    tracks = [];
  }
}

// Learning may finish after this screen opens: refresh the labels then.
$effect(() => {
  void app.learned;
  void loadLedger(id).then((l) => (ledger = l));
});

$effect(() => {
  void id;
  tracks = null;
  void load();
});

const modes: { id: Mode; label: string; hint: () => string }[] = [
  { id: "keep", label: "Keep", hint: () => "Never changes" },
  { id: "tweak", label: "Tweak", hint: () => `${SWAP_PCT[id].tweak}% each week` },
  { id: "renew", label: "Renew", hint: () => `${SWAP_PCT[id].renew}% each week` },
];

const lockedIds = $derived(new Set(mix.locked.map((t) => t.id)));

async function toggleLock(track: Track) {
  const locked = lockedIds.has(track.id)
    ? mix.locked.filter((t) => t.id !== track.id)
    : [...$state.snapshot(mix.locked), $state.snapshot(track)];
  await app.updateMix(id, { locked });
}

async function prepare() {
  const swap = await app.task("Starting…", async (progress) => {
    progress("Checking what you've listened to…");
    await app.learn();
    return prepareSwap($state.snapshot(app.mix(id)) as typeof mix, progress);
  });
  if (swap) {
    app.pending[id] = swap;
    go(`/review/${id}`);
  }
}

async function undo() {
  const ok = confirm(
    "Restore the playlist to how it was before the last swap? Changes made in Spotify since then will be lost.",
  );
  if (!ok) return;
  const updated = await app.task("Restoring the previous version…", () =>
    undoLastSwap($state.snapshot(mix) as typeof mix),
  );
  if (updated) {
    await app.updateMix(id, { blocked: updated.blocked });
    app.notify("Restored the playlist from before the last swap.", "ok");
    await load();
  }
}
</script>

<BackButton href="#/" label="Back to mixes" />

<main class="page">
  <div class="hero mix-{id}">
    <div class="art"><Cover {id} /></div>
    <h1>{mix.name}</h1>
  </div>

  <div class="body">
    <div class="label">How it behaves</div>
    <div class="modes" role="radiogroup" aria-label="Mix mode">
      {#each modes as m (m.id)}
        <button
          class="mode"
          class:on={mix.mode === m.id}
          role="radio"
          aria-checked={mix.mode === m.id}
          onclick={() => app.updateMix(id, { mode: m.id })}
        >
          <strong>{m.label}</strong>
          <span class="small muted">{m.hint()}</span>
        </button>
      {/each}
    </div>

    <div class="label">Sound</div>
    <Radar tune={mix.tune} onchange={(tune) => app.updateMix(id, { tune })} label={`Sound of ${mix.name}`} />
    <p class="small muted hint">Claude aims for this sound in the next swap.</p>

    <div class="card notebox">
      <label for="note"><Icon name="sparkle" size={18} />Note for Claude</label>
      <input
        id="note"
        class="field"
        placeholder="More 90s rock, fewer ballads"
        bind:value={note}
        onchange={() => app.updateMix(id, { note: note.trim() })}
      />
      <p class="small muted">Claude reads this the next time it picks.</p>
    </div>

    <div class="label">In this mix {tracks ? `· ${tracks.length}` : ""}</div>
    <div class="card">
      {#if tracks === null}
        <div class="row muted">Loading…</div>
      {:else if tracks.length === 0}
        <div class="row muted">Empty. Prepare a swap to fill it.</div>
      {:else}
        {#each tracks as t (t.id)}
          <div class="row">
            <div class="grow">
              <div class="title">{t.title}</div>
              <div class="small muted">
                {t.artist}{#if badge(ledger?.entries[t.id], now)}<span class="badge"> · {badge(ledger?.entries[t.id], now)}</span>{/if}
              </div>
            </div>
            <button
              class="lock"
              class:on={lockedIds.has(t.id)}
              aria-pressed={lockedIds.has(t.id)}
              aria-label={lockedIds.has(t.id) ? `Unlock ${t.title}` : `Always keep ${t.title}`}
              onclick={() => toggleLock(t)}
            >
              <Icon name={lockedIds.has(t.id) ? "lock" : "unlock"} size={18} />
            </button>
          </div>
        {/each}
      {/if}
    </div>
    <p class="small muted">Locked songs always stay in the mix.</p>

    {#if canUndo}
      <button class="btn secondary undo" onclick={undo} disabled={!!app.busy}><Icon name="undo" size={18} />Undo last swap</button>
    {/if}
  </div>
</main>

<div class="actions">
  {#if app.pending[id]}
    <a class="btn" href={`#/review/${id}`}>Review swap</a>
  {:else}
    <button class="btn" onclick={prepare} disabled={!!app.busy || mix.mode === "keep" && (tracks?.length ?? 0) >= 25}>
      {app.busy ?? (tracks?.length ? "Prepare swap" : "Fill this mix")}
    </button>
  {/if}
</div>

<style>
  .page { max-width: 520px; margin: 0 auto; padding-bottom: calc(120px + var(--safe-bottom)); }
  .hero { position: relative; height: calc(214px + var(--safe-top)); border-radius: 0 0 36px 36px; overflow: hidden; }
  .art { position: absolute; inset: 0 0 auto 0; height: calc(148px + var(--safe-top)); }
  .hero h1 { position: absolute; left: 20px; bottom: 16px; font-size: 40px; line-height: 42px; }
  .body { padding: 0 20px; }
  .modes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .mode {
    text-align: left; padding: 12px; border: none; border-radius: 22px; background: var(--white);
    box-shadow: 0 0 0 1.5px var(--line); cursor: pointer; display: flex; flex-direction: column; gap: 2px;
  }
  .mode.on { box-shadow: 0 0 0 2px var(--ink); }
  .badge { color: var(--ink); font-weight: 600; }
  .hint { margin: 8px 8px 0; }
  .notebox { margin-top: 14px; padding: 14px; }
  .notebox label { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; margin-bottom: 10px; }
  .notebox p { margin: 8px 0 0; }
  .grow { flex: 1; min-width: 0; }
  .title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lock {
    width: 44px; height: 44px; flex: none; border: none; border-radius: 50%;
    background: var(--bg); color: var(--muted); display: flex; align-items: center; justify-content: center; cursor: pointer;
  }
  .lock.on { background: var(--lime); color: var(--ink); }
  .undo { margin-top: 14px; }
</style>
