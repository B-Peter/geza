<script lang="ts">
import type { Level } from "../geza/sprite.js";
import GezaSprite from "./GezaSprite.svelte";

let { level, xp, onclose }: { level: Level; xp: number; onclose: () => void } = $props();

let button = $state<HTMLButtonElement | null>(null);
$effect(() => {
  button?.focus();
  const esc = (e: KeyboardEvent) => {
    if (e.key === "Escape") onclose();
  };
  addEventListener("keydown", esc);
  return () => removeEventListener("keydown", esc);
});
</script>

<div class="scrim">
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="levelup-title">
    <div class="sparks" aria-hidden="true">
      {#each [0, 1, 2, 3, 4, 5, 6, 7] as n (n)}<span class="spark spark-{n}"></span>{/each}
    </div>
    <h2 id="levelup-title" class="banner">LEVEL UP!</h2>
    <div class="stage"><GezaSprite level={level.n} scale={8} /></div>
    <div class="title"><span class="lv">LV {level.n}</span><span class="name">{level.name.toUpperCase()}</span></div>
    <p class="muted-light">{xp} XP learned from your swipes, plays and hearts.</p>
    <div class="gear">
      <div class="gear-label">NEW GEAR UNLOCKED</div>
      <div>{level.look}</div>
    </div>
    <button class="go" bind:this={button} onclick={onclose}>CONTINUE &gt;</button>
  </div>
</div>

<style>
  .scrim {
    position: fixed; inset: 0; z-index: 35; background: rgba(5, 6, 12, 0.72);
    display: flex; align-items: center; justify-content: center; padding: 16px;
    animation: fade 0.2s ease-out both;
  }
  .sheet {
    position: relative; width: min(380px, 100%); overflow: hidden; text-align: center;
    padding: 24px 20px 20px; border-radius: 20px; color: #e8f7ff;
    background-color: #0d0f1e;
    background-image: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.035) 0 1px, transparent 1px 3px);
    border: 2px solid #2ef2ff; box-shadow: 0 0 0 2px #0d0f1e, 0 0 28px rgba(46, 242, 255, 0.45);
    animation: pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
    display: flex; flex-direction: column; align-items: center;
  }
  .banner, .lv, .name, .gear-label, .go { font-family: "Press Start 2P", ui-monospace, monospace; }
  .banner {
    position: relative; margin: 0; font-size: 18px; line-height: 24px; font-weight: 400;
    color: #ff2e88; text-shadow: 0 0 12px rgba(255, 46, 136, 0.9), 0 0 2px #fff;
  }
  .stage { position: relative; margin-top: 14px; padding: 8px; border-radius: 14px; border: 2px solid #20233d; background: #090a15; }
  .title { position: relative; margin-top: 14px; display: flex; align-items: center; gap: 10px; }
  .lv { font-size: 10px; line-height: 10px; padding: 6px 8px; border-radius: 4px; background: #ff2e88; color: #fff; }
  .name { font-size: 12px; line-height: 18px; color: #2ef2ff; text-shadow: 0 0 8px rgba(46, 242, 255, 0.8); }
  .muted-light { position: relative; margin: 10px 8px 0; font-size: 14px; line-height: 20px; color: #a9b3d6; }
  .gear {
    position: relative; margin-top: 12px; align-self: stretch; text-align: left; padding: 10px 14px;
    border: 2px solid #20233d; border-radius: 12px; background: #090a15; font-size: 13px; line-height: 19px;
  }
  .gear-label { font-size: 8px; color: #ff2e88; margin-bottom: 6px; }
  .go {
    position: relative; margin-top: 18px; align-self: stretch; height: 56px; border: none; border-radius: 12px;
    background: #2ef2ff; color: #0d0f1e; font-size: 12px; cursor: pointer; box-shadow: 0 0 18px rgba(46, 242, 255, 0.6);
  }
  .sparks { position: absolute; inset: 0; pointer-events: none; }
  .spark { position: absolute; width: 9px; height: 9px; animation: twinkle 1.4s steps(2) infinite; }
  .spark::before, .spark::after { content: ""; position: absolute; background: currentColor; }
  .spark::before { left: 3px; top: 0; width: 3px; height: 9px; }
  .spark::after { left: 0; top: 3px; width: 9px; height: 3px; }
  .spark-0 { left: 8%; top: 12%; color: #2ef2ff; }
  .spark-1 { right: 9%; top: 10%; color: #ff2e88; animation-delay: -0.4s; }
  .spark-2 { left: 14%; top: 46%; color: #ffe14d; animation-delay: -0.8s; }
  .spark-3 { right: 12%; top: 40%; color: #2ef2ff; animation-delay: -0.2s; }
  .spark-4 { left: 30%; top: 6%; color: #ff2e88; animation-delay: -1s; }
  .spark-5 { right: 7%; top: 60%; color: #2ef2ff; animation-delay: -0.6s; }
  .spark-6 { left: 6%; top: 30%; color: #7b3ff2; animation-delay: -1.2s; }
  .spark-7 { right: 6%; top: 28%; color: #ff2e88; animation-delay: -0.3s; }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes pop { from { transform: scale(0.85) translateY(14px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes twinkle { 50% { opacity: 0.2; } }
  @media (prefers-reduced-motion: reduce) {
    .scrim, .sheet, .spark { animation: none; }
  }
</style>
