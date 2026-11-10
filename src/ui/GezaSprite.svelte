<script lang="ts">
import { GLOW, H, LEVELS, sprite, W } from "../geza/sprite.js";

let { level, scale = 4 }: { level: number; scale?: number } = $props();

// One <rect> per horizontal run of the same colour.
const runs = $derived.by(() => {
  const grid = sprite(level);
  const out: { x: number; y: number; w: number; c: string; glow: boolean }[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < W) {
      const c = row[x];
      if (!c) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < W && row[x + w] === c) w++;
      out.push({ x, y, w, c, glow: GLOW.has(c) });
      x += w;
    }
  });
  return out;
});

const id = $props.id();
const name = $derived(LEVELS[level - 1]?.name ?? "");
</script>

<svg
  class="sprite"
  viewBox="-1 -1 {W + 2} {H + 2}"
  width={(W + 2) * scale}
  height={(H + 2) * scale}
  role="img"
  aria-label={`Géza, level ${level}: ${name}`}
>
  <defs>
    <filter id="glow-{id}" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="0.6" />
    </filter>
  </defs>
  <!-- Neon glow: the glowing pixels again, blurred, underneath. -->
  <g filter="url(#glow-{id})" opacity="0.9" class="soft">
    {#each runs.filter((r) => r.glow) as r, i (i)}
      <rect x={r.x} y={r.y} width={r.w} height="1" fill={r.c} />
    {/each}
  </g>
  {#each runs as r, i (i)}
    <rect x={r.x} y={r.y} width={r.w} height="1" fill={r.c} />
  {/each}
</svg>

<style>
  .sprite {
    display: block;
    shape-rendering: crispEdges;
    image-rendering: pixelated;
  }
  .soft {
    shape-rendering: auto;
  }
</style>
