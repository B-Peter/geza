<script lang="ts">
// Full-screen "working on it" overlay for long tasks: a little equalizer in
// the mix colours, the real progress message, and a rotating playful line.
// It fades in after a short delay, so quick tasks never flash it.

let { message }: { message: string } = $props();

const QUIPS = [
  "Digging through the crates…",
  "Tuning the guitars…",
  "Bribing the drummer…",
  "Warming up the speakers…",
  "Checking the B-sides…",
  "Flipping the record…",
  "Asking the bassist (she knows things)…",
];

let quip = $state(0);
$effect(() => {
  const timer = setInterval(() => {
    quip = (quip + 1) % QUIPS.length;
  }, 2600);
  return () => clearInterval(timer);
});
</script>

<div class="overlay" role="status" aria-live="polite" aria-busy="true">
  <div class="card loader">
    <div class="eq" aria-hidden="true">
      {#each [0, 1, 2, 3, 4] as n (n)}
        <span class="bar bar-{n}"></span>
      {/each}
    </div>
    <div class="message">{message}</div>
    {#key quip}
      <div class="quip small muted">{QUIPS[quip]}</div>
    {/key}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: rgba(244, 241, 234, 0.72);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    /* Invisible for the first 250 ms: quick tasks finish before it shows. */
    animation: appear 0.2s ease-out 0.25s both;
  }
  .loader {
    width: min(320px, 100%);
    padding: 28px 22px 22px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    box-shadow: 0 18px 40px rgba(20, 19, 15, 0.16);
    animation: pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) 0.25s both;
  }
  .eq {
    height: 64px;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    margin-bottom: 18px;
  }
  .bar {
    width: 16px;
    height: 64px;
    border-radius: 8px;
    /* Height, not scaleY: scaling would squash the rounded ends. */
    animation: dance 1s ease-in-out infinite;
  }
  .bar-0 { background: #ff6b3d; animation-duration: 0.9s; }
  .bar-1 { background: #5b86ff; animation-duration: 1.15s; animation-delay: -0.3s; }
  .bar-2 { background: #ffc83d; animation-duration: 0.8s; animation-delay: -0.5s; }
  .bar-3 { background: #34c791; animation-duration: 1.25s; animation-delay: -0.2s; }
  .bar-4 { background: var(--lime); box-shadow: inset 0 0 0 2px var(--ink); animation-duration: 1s; animation-delay: -0.7s; }
  .message {
    font: 800 20px/24px var(--display);
    letter-spacing: -0.01em;
  }
  .quip {
    margin-top: 6px;
    min-height: 17px;
    animation: slide 0.35s ease-out both;
  }

  @keyframes appear {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes pop {
    from { transform: scale(0.85) translateY(12px); opacity: 0; }
    to { transform: none; opacity: 1; }
  }
  @keyframes dance {
    0%, 100% { height: 18px; }
    35% { height: 64px; }
    60% { height: 35px; }
    80% { height: 54px; }
  }
  @keyframes slide {
    from { transform: translateY(6px); opacity: 0; }
    to { transform: none; opacity: 1; }
  }

  /* Reduce Motion: a still equalizer, no bounce. */
  @media (prefers-reduced-motion: reduce) {
    .overlay { animation: appear 0.01s linear 0.25s both; }
    .loader, .quip { animation: none; }
    .bar { animation: none; }
    .bar-0 { height: 35px; }
    .bar-1 { height: 54px; }
    .bar-2 { height: 26px; }
    .bar-3 { height: 64px; }
    .bar-4 { height: 45px; }
  }
</style>
