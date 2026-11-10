<script lang="ts">
import type { Tune } from "../claude.js";
import { AXES, type AxisKey, clampLevel, levelPoint, pick, polygon, VIEW } from "../radar.js";

let {
  tune,
  onchange,
  label = "Sound",
}: { tune: Tune; onchange: (tune: Tune) => void; label?: string } = $props();

let selected = $state<AxisKey>("tempo");
const axis = $derived(AXES.find((a) => a.key === selected) ?? AXES[0]);

function set(key: AxisKey, level: number) {
  selected = key;
  const next = clampLevel(level);
  if (next !== tune[key]) onchange({ ...tune, [key]: next });
}

// The whole graph is one big tap area: the tap snaps to the nearest axis and
// level. Keyboard and screen-reader users use the axis chips and −/+ instead.
function tap(e: PointerEvent) {
  const svg = e.currentTarget as SVGSVGElement;
  const r = svg.getBoundingClientRect();
  const hit = pick(
    ((e.clientX - r.left) / r.width) * VIEW.width,
    ((e.clientY - r.top) / r.height) * VIEW.height,
  );
  if (hit) set(hit.axis, hit.level);
}

// Chip positions are fixed CSS classes (.axis-0..4), not inline styles: the
// production CSP forbids inline styles. They match point(i, CHIP_DISTANCE); a unit test
// keeps the two in sync.
const chips = AXES.map((a, i) => ({ key: a.key, label: a.label, index: i }));
const rings = [1, 2, 3, 4, 5].map((level) =>
  AXES.map((_, i) =>
    levelPoint(i, level)
      .map((n) => n.toFixed(1))
      .join(","),
  ).join(" "),
);
</script>

<div class="card radar" role="group" aria-label={label}>
  <div class="plot">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svg
      viewBox="0 0 {VIEW.width} {VIEW.height}"
      width="100%"
      height="100%"
      aria-hidden="true"
      onpointerup={tap}
    >
      {#each rings as points, i (i)}
        <polygon {points} class="ring" class:outer={i === 4} />
      {/each}
      {#each AXES as _, i (i)}
        {@const [x, y] = levelPoint(i, 5)}
        <line x1={VIEW.cx} y1={VIEW.cy} x2={x} y2={y} class="spoke" />
      {/each}
      <polygon points={polygon(tune)} class="shape" />
      {#each AXES as a, i (a.key)}
        {#each [1, 2, 3, 4, 5] as level (level)}
          {@const [x, y] = levelPoint(i, level)}
          {@const on = tune[a.key] === level}
          <circle cx={x} cy={y} r={on ? 9 : 3} class:dot={!on} class:on />
        {/each}
      {/each}
    </svg>
    {#each chips as c (c.key)}
      <button
        class="chip-btn axis-{c.index}"
        class:selected={selected === c.key}
        aria-pressed={selected === c.key}
        onclick={() => (selected = c.key)}>{c.label}</button
      >
    {/each}
  </div>

  <div class="stepper">
    <div class="grow">
      <div class="axis">{axis?.label}</div>
      <div class="word" aria-live="polite">{axis?.words[tune[selected] - 1]}</div>
      <div class="small muted">{axis?.words[0]} to {axis?.words[4]}</div>
    </div>
    <button
      class="step minus"
      aria-label={`Less ${axis?.label.toLowerCase()}`}
      disabled={tune[selected] <= 1}
      onclick={() => set(selected, tune[selected] - 1)}>−</button
    >
    <button
      class="step plus"
      aria-label={`More ${axis?.label.toLowerCase()}`}
      disabled={tune[selected] >= 5}
      onclick={() => set(selected, tune[selected] + 1)}>+</button
    >
  </div>
</div>

<style>
  .radar { padding: 6px 6px 12px; }
  .plot { position: relative; aspect-ratio: 350 / 330; touch-action: manipulation; }
  svg { display: block; cursor: pointer; }
  .ring { fill: none; stroke: var(--line); stroke-width: 1; }
  .ring.outer { stroke-width: 1.5; }
  .spoke { stroke: var(--line); stroke-width: 1; }
  .shape { fill: rgba(215, 247, 91, 0.6); stroke: var(--ink); stroke-width: 2.5; stroke-linejoin: round; }
  .dot { fill: #cfc9bb; }
  .on { fill: var(--ink); stroke: var(--lime); stroke-width: 4; }
  .chip-btn {
    position: absolute;
    transform: translate(-50%, -50%);
    min-height: 44px;
    min-width: 44px;
    padding: 0 12px;
    border-radius: 22px;
    border: 1.5px solid var(--line);
    background: var(--white);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
  }
  .axis-0 { left: 50%; top: 9.36%; }
  .axis-1 { left: 87.8%; top: 38.49%; }
  .axis-2 { left: 73.36%; top: 85.62%; }
  .axis-3 { left: 26.64%; top: 85.62%; }
  .axis-4 { left: 12.2%; top: 38.49%; }
  .chip-btn.selected { background: var(--ink); color: var(--white); border-color: var(--ink); }
  .stepper { display: flex; align-items: center; gap: 10px; padding: 4px 8px 0 12px; }
  .grow { flex: 1; min-width: 0; }
  .axis { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  .word { font: 800 26px/30px var(--display); }
  .step {
    width: 48px; height: 48px; flex: none; border-radius: 50%;
    font-size: 24px; font-weight: 700; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .minus { border: 1.5px solid var(--line); background: var(--white); }
  .plus { border: none; background: var(--ink); color: var(--lime); }
  .step:disabled { opacity: 0.35; cursor: default; }
</style>
