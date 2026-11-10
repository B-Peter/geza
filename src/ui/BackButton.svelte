<script lang="ts">
import Icon from "./Icon.svelte";

let { href, label = "Back" }: { href: string; label?: string } = $props();

// Once the page scrolls, a fade appears behind the button so it never sits
// on top of text or fields.
let scrolled = $state(false);
$effect(() => {
  const update = () => {
    scrolled = scrollY > 8;
  };
  update();
  addEventListener("scroll", update, { passive: true });
  return () => removeEventListener("scroll", update);
});
</script>

<div class="fade" class:on={scrolled} aria-hidden="true"></div>
<a {href} aria-label={label}><Icon name="back" size={22} /></a>

<style>
  .fade {
    position: fixed;
    z-index: 9;
    inset: 0 0 auto 0;
    height: calc(72px + var(--safe-top));
    background: linear-gradient(var(--bg) 70%, transparent);
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .fade.on {
    opacity: 1;
  }
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
