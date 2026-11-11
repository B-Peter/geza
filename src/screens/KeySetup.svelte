<script lang="ts">
import * as claude from "../claude.js";
import { app, go } from "../state.svelte.js";
import BackButton from "../ui/BackButton.svelte";
import Icon from "../ui/Icon.svelte";

let key = $state("");
const changing = app.hasKey;

async function save() {
  const ok = await app.task("Checking your key…", async () => {
    await claude.testAndSaveKey(key);
    return true;
  });
  if (!ok) return;
  key = "";
  app.hasKey = true;
  app.notify("Claude key saved.", "ok");
  go("/");
}
</script>

{#if changing}<BackButton href="#/settings" />{/if}

<main class="screen">
  {#if !changing}<span class="chip"><Icon name="check" size={14} />Spotify linked · step 2 of 3</span>{/if}
  <h1 class="title">{changing ? "Change your Claude key" : "Add your Claude key"}</h1>
  <p class="lead">Claude picks your songs using your own Anthropic API key. Usage is billed to your Anthropic account.</p>

  <div class="label">Get a key</div>
  <ol class="card steps">
    <li class="row"><span class="n">1</span><span>Sign in at <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer">console.anthropic.com</a></span></li>
    <li class="row"><span class="n">2</span>Add credit and set a low spend limit</li>
    <li class="row"><span class="n">3</span>Create a key just for this app, paste it below</li>
  </ol>

  <form class="card keybox" onsubmit={(e) => { e.preventDefault(); void save(); }}>
    <label for="apikey"><Icon name="key" size={18} />Anthropic API key</label>
    <input id="apikey" class="field" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" bind:value={key} />
    <p class="small muted">Stored encrypted on this device only and never shown again. You can change or remove it in Settings.</p>
  </form>
</main>

<div class="actions">
  <p class="small muted center">We check the key with a free lookup. No tokens are used.</p>
  <button class="btn" onclick={save} disabled={!key.trim() || !!app.busy}>{app.busy ?? "Test and save key"}</button>
</div>

<style>
  .title { margin-top: 14px; }
  .steps { list-style: none; margin: 0; padding: 0; }
  .steps li { font-weight: 600; }
  /* Visually inline, but a 44px-tall tap area. */
  .steps a { text-decoration: underline; display: inline-block; padding: 12px 0; margin: -12px 0; }
  .n {
    width: 28px; height: 28px; flex: none; border-radius: 50%;
    background: var(--ink); color: var(--lime);
    font-size: 13px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }
  .keybox { margin-top: 14px; padding: 14px; }
  .keybox label { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; margin-bottom: 10px; }
  .keybox p { margin: 8px 0 0; }
  .center { text-align: center; margin: 0 0 10px; }
</style>
