<script lang="ts">
import type { Tune } from "../claude.js";
import { PRESETS } from "../radar.js";
import { loadRandom, prepareRandom, RANDOM_SIZE, type RandomSettings, saveRandom } from "../random.js";
import * as spotify from "../spotify.js";
import { openUri } from "../spotify.js";
import { app } from "../state.svelte.js";
import BackButton from "../ui/BackButton.svelte";
import Icon from "../ui/Icon.svelte";
import Radar from "../ui/Radar.svelte";

let settings = $state<RandomSettings | null>(null);
/** Set after a successful pick; cleared when the graph or note changes. */
let ready = $state<{ found: number; picked: number } | null>(null);

$effect(() => {
  void loadRandom().then((s) => (settings = s));
});

async function update(patch: Partial<RandomSettings>) {
  if (!settings) return;
  settings = { ...settings, ...patch };
  ready = null;
  await saveRandom($state.snapshot(settings) as RandomSettings);
}

const samePreset = (t: Tune) =>
  PRESETS.find((p) => (Object.keys(p.tune) as (keyof Tune)[]).every((k) => p.tune[k] === t[k]))?.name;

async function pick() {
  if (!settings) return;
  const current = $state.snapshot(settings) as RandomSettings;
  const result = await app.task("Starting…", async (progress) => {
    app.profile ??= await spotify.getProfile();
    return prepareRandom(current, app.profile, progress);
  });
  if (result) {
    settings = result.settings;
    ready = { found: result.found, picked: result.picked };
  }
}
</script>

<BackButton href="#/" label="Back to mixes" />

<main class="screen">
  <h1>Play something</h1>
  <p class="lead">Set the sound, and Claude picks {RANDOM_SIZE} songs for right now. Your weekly mixes stay as they are.</p>

  {#if settings}
    <div class="label">Start from</div>
    <div class="presets">
      {#each PRESETS as p (p.name)}
        <button
          class="preset"
          class:on={samePreset(settings.tune) === p.name}
          aria-pressed={samePreset(settings.tune) === p.name}
          onclick={() => update({ tune: { ...p.tune } })}>{p.name}</button
        >
      {/each}
    </div>

    <div class="label">Sound</div>
    <Radar tune={settings.tune} onchange={(tune) => update({ tune })} label="Sound for the random playlist" />

    <div class="card notebox">
      <label for="random-note"><Icon name="sparkle" size={18} />Anything else?</label>
      <input
        id="random-note"
        class="field"
        placeholder="80s synth pop, no ballads"
        value={settings.note}
        onchange={(e) => update({ note: (e.currentTarget as HTMLInputElement).value.trim() })}
      />
    </div>
  {/if}
</main>

<div class="actions">
  {#if ready && settings?.playlistId}
    <p class="small muted center">
      {ready.found} songs ready in “Studio Random”{ready.found < ready.picked
        ? ` (${ready.picked - ready.found} not on Spotify)`
        : ""}.
    </p>
    <div class="two">
      <button class="btn secondary" onclick={pick} disabled={!!app.busy}>Pick again</button>
      <a class="btn" href={openUri(settings.playlistId)}><Icon name="play" size={18} />Play in Spotify</a>
    </div>
  {:else}
    <button class="btn" onclick={pick} disabled={!settings || !!app.busy}>
      {app.busy ?? `Pick ${RANDOM_SIZE} songs`}
    </button>
  {/if}
</div>

<style>
  .presets { display: flex; flex-wrap: wrap; gap: 8px; }
  .preset {
    min-height: 44px; padding: 0 14px; border-radius: 22px;
    border: 1.5px solid var(--line); background: var(--white);
    font-size: 14px; font-weight: 700; cursor: pointer;
  }
  .preset.on { background: var(--lime); border-color: var(--ink); }
  .notebox { margin-top: 14px; padding: 14px; }
  .notebox label { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; margin-bottom: 10px; }
  .center { text-align: center; margin: 0 0 10px; }
  .two { display: grid; grid-template-columns: 1fr 1.3fr; gap: 10px; }
</style>
