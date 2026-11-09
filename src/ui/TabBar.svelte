<script lang="ts">
import Icon from "./Icon.svelte";

let { active }: { active: "mixes" | "settings" } = $props();
const tabs = [
  { id: "mixes", label: "Mixes", href: "#/" },
  { id: "settings", label: "Settings", href: "#/settings" },
] as const;
</script>

<nav aria-label="Main">
  {#each tabs as tab (tab.id)}
    <a href={tab.href} class:on={active === tab.id} aria-label={tab.label} aria-current={active === tab.id ? "page" : undefined}>
      <Icon name={tab.id} size={22} />
      {#if active === tab.id}<span>{tab.label}</span>{/if}
    </a>
  {/each}
</nav>

<style>
  nav {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(20px + var(--safe-bottom));
    width: min(480px, calc(100% - 40px));
    height: 64px;
    padding: 8px;
    border-radius: 32px;
    background: var(--ink);
    box-shadow: 0 14px 32px rgba(20, 19, 15, 0.3);
    display: flex;
    justify-content: space-around;
    z-index: 10;
  }
  a {
    height: 48px;
    min-width: 72px;
    padding: 0 22px;
    border-radius: 24px;
    color: rgba(255, 255, 255, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-weight: 700;
  }
  a.on { background: var(--lime); color: var(--ink); }
</style>
