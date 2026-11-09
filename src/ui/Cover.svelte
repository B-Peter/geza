<script lang="ts">
import type { MixId } from "../mixes.js";

let { id }: { id: MixId } = $props();
</script>

<svg viewBox="0 0 160 120" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true">
  {#if id === "driving"}
    <rect width="160" height="120" fill="#FF6B3D" />
    <circle cx="112" cy="40" r="24" fill="#FFF1E6" />
    <path d="M-10 120L-10 92Q50 58 170 84L170 120Z" fill="#14130F" />
    <path d="M-10 106Q50 74 170 100" fill="none" stroke="#FFB08F" stroke-width="3" stroke-dasharray="10 8" />
  {:else if id === "working"}
    <rect width="160" height="120" fill="#5B86FF" />
    <rect x="14" y="12" width="42" height="42" rx="12" fill="#14130F" />
    <circle cx="81" cy="33" r="21" fill="#B8CCFF" />
    <rect x="106" y="12" width="42" height="42" rx="12" fill="#EEF3FF" />
    <circle cx="35" cy="87" r="21" fill="#EEF3FF" />
    <rect x="60" y="66" width="42" height="42" rx="12" fill="#14130F" />
    <circle cx="127" cy="87" r="21" fill="#B8CCFF" />
  {:else if id === "cooking"}
    <rect width="160" height="120" fill="#FFC83D" />
    <circle cx="50" cy="62" r="40" fill="#FFF8E0" />
    <circle cx="104" cy="46" r="26" fill="#14130F" />
    <circle cx="116" cy="94" r="18" fill="#FFE49A" />
    <circle cx="80" cy="102" r="8" fill="#14130F" />
  {:else}
    <rect width="160" height="120" fill="#34C791" />
    <rect x="14" y="40" width="40" height="100" rx="20" fill="#14130F" />
    <rect x="60" y="20" width="40" height="120" rx="20" fill="#EAFBF3" />
    <rect x="106" y="56" width="40" height="90" rx="20" fill="#A9EBD0" />
  {/if}
</svg>

<style>
  svg { display: block; }
</style>
