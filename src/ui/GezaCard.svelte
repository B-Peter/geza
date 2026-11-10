<script lang="ts">
import { gezaSays } from "../geza/say.js";
import type { LevelInfo } from "../geza/xp.js";
import type { TasteProfile } from "../taste.js";
import GezaSprite from "./GezaSprite.svelte";

let { info, taste }: { info: LevelInfo; taste: TasteProfile | null } = $props();

const SEGMENTS = 10;
const filled = $derived(Math.round(info.progress * SEGMENTS));
</script>

<section class="geza" aria-label="Géza">
  <div class="panel top">
    <GezaSprite level={info.level.n} scale={4} />
    <div class="grow">
      <div class="title">
        <span class="lv">LV {info.level.n}</span>
        <span class="name">{info.level.name.toUpperCase()}</span>
      </div>
      <div
        class="bar"
        role="progressbar"
        aria-label={info.next ? `Experience towards ${info.next.name}` : "Experience"}
        aria-valuemin={info.level.from}
        aria-valuemax={info.next?.from ?? info.xp}
        aria-valuenow={info.xp}
      >
        {#each Array(SEGMENTS) as _, i (i)}<span class:on={i < filled}></span>{/each}
      </div>
      <div class="xp">
        <span>{info.xp} XP</span>
        <span>{info.next ? `NEXT ${info.next.from}` : "MAX"}</span>
      </div>
    </div>
  </div>
  <p class="panel says" aria-live="polite"><span class="prompt">GÉZA&gt;</span> {gezaSays(info, taste)}</p>
</section>

<style>
  .geza { margin-bottom: 18px; }
  .panel {
    background-color: #0d0f1e;
    background-image: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.035) 0 1px, transparent 1px 3px);
    color: #e8f7ff;
    border: 2px solid #2ef2ff;
    border-radius: 14px;
    box-shadow: 0 0 0 2px #0d0f1e, 0 0 22px rgba(46, 242, 255, 0.35);
  }
  .top { display: flex; align-items: center; gap: 12px; padding: 10px 14px 10px 8px; }
  .grow { flex: 1; min-width: 0; }
  .title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .lv, .name, .xp, .prompt { font-family: "Press Start 2P", ui-monospace, monospace; }
  .lv {
    font-size: 10px; line-height: 10px; padding: 6px 8px; border-radius: 4px;
    background: #ff2e88; color: #fff; box-shadow: 0 0 10px rgba(255, 46, 136, 0.6);
  }
  .name { font-size: 9px; line-height: 14px; color: #2ef2ff; text-shadow: 0 0 8px rgba(46, 242, 255, 0.7); }
  .bar { margin-top: 10px; display: flex; gap: 3px; }
  .bar span { flex: 1; height: 10px; border-radius: 2px; background: #20233d; }
  .bar span.on { background: #2ef2ff; box-shadow: 0 0 6px #2ef2ff; }
  .xp { margin-top: 6px; display: flex; justify-content: space-between; font-size: 8px; line-height: 10px; color: #a9b3d6; }
  .says {
    margin: 10px 0 0 26px; padding: 9px 12px; font-size: 13px; line-height: 18px;
    box-shadow: 0 0 14px rgba(46, 242, 255, 0.25);
  }
  .prompt { font-size: 8px; color: #ff2e88; }
</style>
