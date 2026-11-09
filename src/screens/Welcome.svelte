<script lang="ts">
import * as spotify from "../spotify.js";
import { app } from "../state.svelte.js";
import Cover from "../ui/Cover.svelte";

let clientId = $state(spotify.getClientId());
const needsClientId = !spotify.BUILT_IN_CLIENT_ID;

async function login() {
  if (needsClientId) spotify.setClientId(clientId);
  try {
    await spotify.startLogin();
  } catch (e) {
    app.notify(e);
  }
}
</script>

<main class="screen welcome">
  <div class="tiles" aria-hidden="true">
    <div class="col">
      <div class="tile tall"><Cover id="driving" /></div>
      <div class="tile"><Cover id="cooking" /></div>
    </div>
    <div class="col offset">
      <div class="tile"><Cover id="working" /></div>
      <div class="tile tall"><Cover id="home" /></div>
    </div>
  </div>
  <h1 class="headline">Your music, tuned every week.</h1>
  <p class="lead">Spotify keeps your playlists. Claude picks the songs, fresh every week.</p>

  {#if needsClientId}
    <label class="label" for="client-id">Spotify client ID</label>
    <input id="client-id" class="field" bind:value={clientId} autocomplete="off" spellcheck="false" />
    <p class="small muted hint">Redirect URI to register: <code>{spotify.redirectUri()}</code></p>
  {/if}

  <div class="cta">
    <button class="btn" onclick={login} disabled={needsClientId && !clientId.trim()}>Continue with Spotify</button>
    <p class="small muted center">
      Invite-only. It edits your playlists and never sees your password. Claude only gets song names, never your account.
    </p>
  </div>
</main>

<style>
  .welcome { padding-top: calc(40px + var(--safe-top)); padding-bottom: calc(24px + var(--safe-bottom)); }
  .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .col { display: flex; flex-direction: column; gap: 12px; }
  .offset { margin-top: 32px; }
  .tile { height: 124px; border-radius: 28px; overflow: hidden; }
  .tile.tall { height: 176px; }
  .headline { margin-top: 28px; font-size: 42px; line-height: 44px; letter-spacing: -0.025em; }
  .cta { margin-top: 28px; }
  .center { text-align: center; margin-top: 12px; }
  code { word-break: break-all; }
  .hint { margin: 8px 0 0; }
</style>
