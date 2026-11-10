<script lang="ts">
import KeySetup from "./screens/KeySetup.svelte";
import MixDetail from "./screens/MixDetail.svelte";
import Mixes from "./screens/Mixes.svelte";
import Random from "./screens/Random.svelte";
import Review from "./screens/Review.svelte";
import Settings from "./screens/Settings.svelte";
import Setup from "./screens/Setup.svelte";
import Train from "./screens/Train.svelte";
import Welcome from "./screens/Welcome.svelte";
import { app } from "./state.svelte.js";
import LevelUp from "./ui/LevelUp.svelte";
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
{:else}
  <Mixes />
{/if}

{#if app.levelUp && app.geza}
  <LevelUp level={app.levelUp} xp={app.geza.xp} onclose={() => app.dismissLevelUp()} />
{/if}

{#if app.busy}
  <Loader message={app.busy} />
{/if}

{#if app.toast}
  <div class="toast" class:error={app.toast.kind === "error"} role="status" aria-live="polite">
    {app.toast.text}
    <button aria-label="Dismiss" onclick={() => (app.toast = null)}>×</button>
  </div>
{/if}

<style>
  .splash { min-height: 100dvh; }
  .toast {
    position: fixed;
    z-index: 40;
    left: 50%;
    transform: translateX(-50%);
    top: calc(12px + var(--safe-top));
    width: min(480px, calc(100% - 32px));
    padding: 12px 8px 12px 16px;
    border-radius: 18px;
    background: var(--ink);
    color: var(--white);
    font-size: 14px;
    line-height: 19px;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 10px 28px rgba(20, 19, 15, 0.25);
  }
  .toast.error { background: var(--danger); }
  .toast button {
    margin-left: auto; flex: none; width: 36px; height: 36px; border: none; border-radius: 50%;
    background: rgba(255, 255, 255, 0.15); color: inherit; font-size: 20px; cursor: pointer;
  }
</style>
