<script lang="ts">
import * as spotify from "../spotify.js";
import { SpotifyError } from "../spotify.js";
import { app } from "../state.svelte.js";
import {
  buildDeck,
  type Card,
  judge,
  loadTrain,
  startPosition,
  type TrainData,
  type Verdict,
  YES_PLAYLIST,
} from "../train.js";
import BackButton from "../ui/BackButton.svelte";
import Icon from "../ui/Icon.svelte";

let data = $state<TrainData | null>(null);
let deck = $state<Card[]>([]);
let index = $state(0);
let device = $state<spotify.Device | null>(null);
/** "spotify": Spotify isn't running; "premium": playback needs Premium. */
let blocked = $state<"spotify" | "premium" | null>(null);
let startedIn = $state<number | null>(null);
let leaving = $state<Verdict | null>(null);
let cardEl = $state<HTMLElement | null>(null);

const card = $derived(deck[index] ?? null);
const done = $derived(deck.length > 0 && index >= deck.length);

$effect(() => {
  void loadTrain().then((d) => (data = d));
  // Stop the music when you leave Train.
  return () => {
    if (device) void spotify.pause(device.id).catch(() => {});
  };
});

async function findDevice(): Promise<boolean> {
  device = spotify.pickDevice(await spotify.getDevices());
  blocked = device ? null : "spotify";
  return Boolean(device);
}

/** Play the deck from card i; measure how long until Spotify plays it. */
async function playFrom(i: number) {
  const current = deck[i];
  if (!current || !device) return;
  startedIn = null;
  const t0 = performance.now();
  try {
    await spotify.playList(
      device.id,
      deck.slice(i).map((c) => c.track.uri),
      startPosition(current.track),
    );
  } catch (e) {
    if (e instanceof SpotifyError && e.status === 404) {
      blocked = "spotify";
      return;
    }
    if (e instanceof SpotifyError && e.status === 403) {
      blocked = "premium";
      return;
    }
    app.notify(e);
    return;
  }
  // Ask Spotify what's playing until it's this song (at most ~3 s).
  for (let n = 0; n < 20 && deck[index]?.track.id === current.track.id; n++) {
    const now = await spotify.nowPlaying().catch(() => null);
    if (now?.trackId === current.track.id && now.isPlaying) {
      startedIn = (performance.now() - t0) / 1000;
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function start() {
  if (!data) return;
  const current = $state.snapshot(data) as TrainData;
  const cards = await app.task("Starting…", (progress) => buildDeck(current, progress));
  if (!cards) return;
  deck = cards;
  index = 0;
  if (await findDevice()) void playFrom(0);
}

async function retrySpotify() {
  if (await findDevice()) void playFrom(index);
}

function decide(verdict: Verdict) {
  if (!card || !data || leaving) return;
  const judged = card;
  leaving = verdict;
  // Start the next song right away; the card animation covers the wait.
  const next = index + 1;
  if (next < deck.length) void playFrom(next);
  else if (device) void spotify.pause(device.id).catch(() => {});
  void judge($state.snapshot(data) as TrainData, judged, verdict, app.profile).then((d) => (data = d));
  setTimeout(() => {
    index = next;
    leaving = null;
    if (cardEl) cardEl.style.transform = "";
  }, 260);
}

// --- Dragging the card ------------------------------------------------------
// The card's position is set through element.style (CSSOM), which the strict
// CSP allows; inline style attributes in markup would be blocked.
let start0: { x: number; y: number } | null = null;
const THRESHOLD = 90;

function down(e: PointerEvent) {
  if (leaving) return;
  start0 = { x: e.clientX, y: e.clientY };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function move(e: PointerEvent) {
  if (!start0 || !cardEl) return;
  const dx = e.clientX - start0.x;
  const dy = Math.min(0, e.clientY - start0.y);
  cardEl.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
}

function up(e: PointerEvent) {
  if (!start0) return;
  const dx = e.clientX - start0.x;
  const dy = e.clientY - start0.y;
  start0 = null;
  if (dx > THRESHOLD) decide("yes");
  else if (dx < -THRESHOLD) decide("no");
  else if (dy < -THRESHOLD) decide("later");
  else if (cardEl) cardEl.style.transform = "";
}

$effect(() => {
  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") decide("yes");
    else if (e.key === "ArrowLeft") decide("no");
    else if (e.key === "ArrowUp") decide("later");
  };
  addEventListener("keydown", key);
  return () => removeEventListener("keydown", key);
});
</script>

<BackButton href="#/" label="Back to mixes" />

<main class="screen">
  <h1>Train Géza</h1>
  <p class="lead">Swipe right if you like it, left if you don't. Songs play in your Spotify app.</p>

  {#if blocked === "spotify"}
    <div class="card notice" role="status">
      <strong>Open Spotify on this phone</strong>
      <p class="small muted">Start any song there, then come back. Géza plays the deck through it.</p>
      <div class="two">
        <a class="btn secondary small" href="spotify:">Open Spotify</a>
        <button class="btn small" onclick={retrySpotify}>Try again</button>
      </div>
    </div>
  {:else if blocked === "premium"}
    <div class="card notice" role="status">
      <strong>Spotify Premium needed</strong>
      <p class="small muted">Spotify only lets apps start songs on Premium accounts.</p>
    </div>
  {/if}

  {#if card && !done}
    <div class="deck">
      <div class="count small muted">{index + 1} / {deck.length}</div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="card swipe"
        class:fly-yes={leaving === "yes"}
        class:fly-no={leaving === "no"}
        class:fly-later={leaving === "later"}
        bind:this={cardEl}
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={up}
      >
        {#if card.track.image}
          <img class="art" src={card.track.image} alt="" draggable="false" />
        {:else}
          <div class="art placeholder" aria-hidden="true"><Icon name="mixes" size={48} /></div>
        {/if}
        <div class="info">
          <div class="title">{card.track.title}</div>
          <div class="artist">{card.track.artist}</div>
          <div class="reason small muted">{card.reason}</div>
        </div>
      </div>
      <div class="latency small muted" aria-live="polite">
        {#if startedIn !== null}Started in {startedIn.toFixed(1)} s{:else if device}Starting…{/if}
      </div>
    </div>

    <div class="choices">
      <button class="choice no" aria-label="No, never suggest it" onclick={() => decide("no")}>
        <span aria-hidden="true">✕</span>
      </button>
      <button class="choice later" aria-label="Not now" onclick={() => decide("later")}>
        <span aria-hidden="true">↑</span>
      </button>
      <button class="choice yes" aria-label="Yes, I like it" onclick={() => decide("yes")}>
        <span aria-hidden="true">♥</span>
      </button>
    </div>
  {:else}
    <div class="card notice">
      {#if done}
        <strong>Deck done</strong>
        <p class="small muted">Your choices now shape every mix and random pick.</p>
      {:else}
        <strong>How it works</strong>
        <p class="small muted">
          Claude picks {15} songs, mostly new to you. Each plays from its catchy part. Yes songs go to “{YES_PLAYLIST}”
          and steer future picks; no songs are never suggested again.
        </p>
      {/if}
      <button class="btn" onclick={start} disabled={!data || !!app.busy}>{done ? "New deck" : "Start"}</button>
    </div>
  {/if}

  {#if data && (data.yes.length || data.no.length)}
    <p class="small muted tally">So far: {data.yes.length} yes · {data.no.length} no</p>
  {/if}
</main>

<style>
  .notice { margin-top: 16px; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .notice p { margin: 0 0 4px; }
  .two { display: flex; gap: 10px; flex-wrap: wrap; }
  .deck { margin-top: 16px; display: flex; flex-direction: column; align-items: center; }
  .count { align-self: flex-end; margin-bottom: 6px; }
  .swipe {
    width: 100%;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: grab;
    transition: transform 0.25s ease-out, opacity 0.25s ease-out;
  }
  .swipe:active { transition: none; }
  .fly-yes { transform: translateX(130%) rotate(18deg) !important; opacity: 0; }
  .fly-no { transform: translateX(-130%) rotate(-18deg) !important; opacity: 0; }
  .fly-later { transform: translateY(-120%) !important; opacity: 0; }
  .art { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
  .placeholder { display: flex; align-items: center; justify-content: center; background: var(--line); }
  .info { padding: 14px 16px 16px; }
  .title { font: 800 22px/26px var(--display); }
  .artist { margin-top: 2px; font-weight: 600; }
  .reason { margin-top: 6px; }
  .latency { margin-top: 8px; min-height: 17px; }
  .choices { margin-top: 14px; display: flex; justify-content: center; align-items: center; gap: 22px; }
  .choice {
    width: 64px; height: 64px; border-radius: 50%; border: none; cursor: pointer;
    font-size: 26px; font-weight: 700; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 6px 16px rgba(20, 19, 15, 0.14);
  }
  .choice.later { width: 52px; height: 52px; font-size: 20px; background: var(--white); color: var(--muted); }
  .no { background: var(--white); color: var(--danger); }
  .yes { background: var(--lime); color: var(--ink); }
  .tally { margin: 16px 8px 0; text-align: center; }
  @media (prefers-reduced-motion: reduce) {
    .swipe { transition: opacity 0.15s linear; }
    .fly-yes, .fly-no, .fly-later { transform: none !important; }
  }
</style>
