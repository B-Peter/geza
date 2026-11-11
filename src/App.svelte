<script lang="ts">
import KeySetup from "./screens/KeySetup.svelte";
import MixDetail from "./screens/MixDetail.svelte";
import Mixes from "./screens/Mixes.svelte";
import Random from "./screens/Random.svelte";
import Review from "./screens/Review.svelte";
import Settings from "./screens/Settings.svelte";
import Setup from "./screens/Setup.svelte";
import Taste from "./screens/Taste.svelte";
import Train from "./screens/Train.svelte";
import Welcome from "./screens/Welcome.svelte";
import { app } from "./state.svelte.js";
import Icon from "./ui/Icon.svelte";
import Loader from "./ui/Loader.svelte";
</script>

{#if !app.ready}
  <div class="splash" aria-busy="true"></div>
{:else if !app.loggedIn}
  <Welcome />
{:else if !app.hasKey || app.route.name === "key"}
  <KeySetup />
{:else if app.needsPlaylists}
  <Setup />
{:else if app.route.name === "mix"}
  <MixDetail id={app.route.id} />
{:else if app.route.name === "review"}
  <Review id={app.route.id} />
{:else if app.route.name === "train"}
  <Train />
{:else if app.route.name === "random"}
  <Random />
{:else if app.route.name === "settings"}
  <Settings />
{:else if app.route.name === "taste"}
  <Taste />
{:else}
  <Mixes />
{/if}

{#if app.busy}
  <Loader message={app.busy} />
{/if}

{#if app.asking}
  <div class="scrim">
    <div class="card sheet" role="alertdialog" aria-modal="true" aria-label={app.asking.title}>
      <div class="sheet-title">{app.asking.title}</div>
      {#if app.asking.text}<p class="small muted">{app.asking.text}</p>{/if}
      <div class="sheet-actions">
        <button class="btn secondary" onclick={() => app.answer(false)}>Cancel</button>
        <button class="btn" class:go-danger={app.asking.danger} onclick={() => app.answer(true)}>{app.asking.action}</button>
      </div>
    </div>
  </div>
{/if}

{#if app.toast}
  {@const error = app.toast.kind === "error"}
  <div class="toast" class:error role="status" aria-live="polite">
    <span class="ico" aria-hidden="true">
      {#if error}!{:else}<Icon name="check" size={18} />{/if}
    </span>
    <span class="text">{app.toast.text}</span>
    <button aria-label="Dismiss" onclick={() => (app.toast = null)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </div>
{/if}

<style>
  .splash { min-height: 100dvh; }
  /* A notice is a card like every other: white, round, with the same icon
     tile as the rows on Mixes and Settings. */
  .toast {
    position: fixed;
    z-index: 40;
    left: 16px;
    right: 16px;
    /* Above the tab bar and the action bar; never over the back button or the title. */
    bottom: calc(104px + var(--safe-bottom));
    max-width: 480px;
    margin: 0 auto;
    min-height: 60px;
    padding: 10px;
    border-radius: 28px;
    background: var(--white);
    color: var(--ink);
    font-size: 14px;
    line-height: 19px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 12px;
    box-shadow: 0 0 0 1.5px var(--line), 0 14px 34px rgba(20, 19, 15, 0.16);
    animation: drop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  .ico {
    width: 40px; height: 40px; flex: none; border-radius: 14px; background: var(--lime);
    display: flex; align-items: center; justify-content: center;
    font: 800 20px/1 var(--display);
  }
  .text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .toast.error { box-shadow: 0 0 0 1.5px #e9b5a8, 0 14px 34px rgba(20, 19, 15, 0.16); }
  .toast.error .ico { background: #ffe3d6; color: var(--danger); }
  .toast button {
    flex: none; width: 40px; height: 40px; border: none; border-radius: 50%;
    background: var(--bg); color: var(--muted); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .scrim {
    position: fixed; inset: 0; z-index: 35; display: flex; align-items: flex-end; justify-content: center;
    padding: 16px 16px calc(24px + var(--safe-bottom));
    background: rgba(20, 19, 15, 0.35);
  }
  .sheet {
    width: min(480px, 100%); padding: 22px 20px 20px; box-shadow: 0 18px 40px rgba(20, 19, 15, 0.25);
    animation: drop 0.3s ease-out both;
  }
  .sheet-title { font: 800 22px/26px var(--display); letter-spacing: -0.01em; }
  .sheet p { margin: 8px 0 0; font-size: 14px; line-height: 20px; }
  .sheet-actions { margin-top: 18px; display: grid; grid-template-columns: 1fr 1.2fr; gap: 10px; }
  .go-danger { background: var(--danger); }
  @keyframes drop {
    from { transform: translateY(16px) scale(0.96); opacity: 0; }
    to { transform: none; opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .toast, .sheet { animation: none; }
  }
</style>
