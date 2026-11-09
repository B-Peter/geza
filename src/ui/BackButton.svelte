<script lang="ts">
import Icon from "./Icon.svelte";

let { href, label = "Back" }: { href: string; label?: string } = $props();
</script>

<a {href} aria-label={label}><Icon name="back" size={22} /></a>

<style>
  a {
    position: fixed;
    z-index: 10;
    left: 16px;
    top: calc(14px + var(--safe-top));
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--white);
    box-shadow: 0 4px 14px rgba(20, 19, 15, 0.18);
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
