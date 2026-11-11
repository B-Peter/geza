<script lang="ts">
type Name =
  | "play"
  | "back"
  | "mixes"
  | "settings"
  | "lock"
  | "unlock"
  | "sparkle"
  | "arrow"
  | "check"
  | "undo"
  | "key"
  | "discover";
let { name, size = 20 }: { name: Name; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={name === "play" ? "currentColor" : "none"}
  stroke="currentColor"
  stroke-width={name === "play" ? 0 : 2.2}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === "play"}<path d="M8 5l11 7-11 7V5z" />
  {:else if name === "back"}<path d="M15 5l-7 7 7 7" />
  {:else if name === "mixes"}<path d="M9 18V6l10-2v12" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="16" r="2" />
  {:else if name === "settings"}<path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" />
  {:else if name === "lock"}<rect x="6" y="11" width="12" height="9" rx="2" /><path d="M9 11V8a3 3 0 0 1 6 0v3" />
  {:else if name === "unlock"}<rect x="6" y="11" width="12" height="9" rx="2" /><path d="M9 11V8a3 3 0 0 1 5.8-1" />
  {:else if name === "sparkle"}<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
  {:else if name === "arrow"}<path d="M5 12h14M13 6l6 6-6 6" />
  {:else if name === "check"}<path d="M5 12l4 4 10-10" />
  {:else if name === "undo"}<path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" />
  {:else if name === "discover"}<circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" />
  {:else if name === "key"}<circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3M14 9l2 2" />
  {/if}
</svg>
