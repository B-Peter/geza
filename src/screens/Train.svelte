<script lang="ts">
import { prefetchDeck, takeDeck } from "../deckCache.js";
import { countryName, type Enrichment, enrich } from "../musicbrainz.js";
import * as spotify from "../spotify.js";
import { SpotifyError } from "../spotify.js";
import { app } from "../state.svelte.js";
import { songKey } from "../text.js";
import {
  type Card,
  DECK_SIZE,
  type Deck,
  deckOutcome,
  fillDeckPlaylist,
  judge,
  loadTrain,
  NO_PLAYLIST,
  recordDeck,
  restoreFromSpotify,
  startPosition,
  type TrainData,
  unjudge,
  type Verdict,
  YES_PLAYLIST,
} from "../train.js";
import BackButton from "../ui/BackButton.svelte";
import Icon from "../ui/Icon.svelte";
import TabBar from "../ui/TabBar.svelte";

let data = $state<TrainData | null>(null);
let deck = $state<Card[]>([]);
/** The current deck's id (its "at"), for the Deck done stats. */
let deckAt = $state(0);
/**
 * The deck as the "Géza · Deck" playlist: Spotify plays it as one list, and
 * when the app is asleep, it opens straight on it (one tap to play there).
 */
let deckPlaylist = $state<string | null>(null);
/** Resolves once the deck playlist is filled (or failed; then plain song lists are used). */
let deckPlaylistReady: Promise<void> = Promise.resolve();
/** Cards that arrived later, being added to the deck playlist in order. */
let playlistWrites: Promise<void> = Promise.resolve();
let index = $state(0);
let device = $state<spotify.Device | null>(null);
/** "spotify": Spotify isn't running or is asleep; "premium": playback needs Premium. */
let blocked = $state<"spotify" | "premium" | null>(null);
let startedIn = $state<number | null>(null);
/** When the current song started playing (for listening time / dwell). */
let playingSince = $state<number | null>(null);
let now = $state(Date.now());
let leaving = $state<Verdict | null>(null);
let cardEl = $state<HTMLElement | null>(null);
let sessionYes = $state(0);
let sessionNo = $state(0);
/** More cards on their way (the deck starts before Claude has finished). */
let more = $state(false);
/** The swipe that can still be taken back (only the latest one). */
let last = $state<{ card: Card; verdict: Verdict; at: number } | null>(null);
/** Swipes are saved one after the other, each on top of the one before. */
let saving: Promise<void> = Promise.resolve();
/** MusicBrainz details per track id, filled in the background. */
let details = $state<Record<string, Enrichment>>({});

/** One MusicBrainz lookup at a time, also when cards keep arriving. */
let enriching: Promise<void> = Promise.resolve();
/** Enrich cards in the background, one song at a time. */
function enrichDeck(cards: Card[]) {
  enriching = enriching.then(async () => {
    for (const c of cards) {
      if (details[c.track.id]) continue;
      details[c.track.id] = await enrich(c.track).catch(() => ({ genres: [] }));
    }
  });
}

const card = $derived(deck[index] ?? null);
const done = $derived(deck.length > 0 && index >= deck.length && !more);
/** A deck is on the screen: the tab bar makes way for the card and its buttons. */
const swiping = $derived(deck.length > 0 && !done);
const extra = $derived(card ? details[card.track.id] : undefined);
/** The album's first release year, when this is a later version. */
const firstYear = $derived(
  extra?.originalYear && card && extra.originalYear < (card.track.year ?? 9999) ? extra.originalYear : null,
);
const statusLine = $derived(
  [
    startedIn !== null && device ? `Playing on ${device.name} · started in ${startedIn.toFixed(1)} s` : "",
    `${sessionYes} yes · ${sessionNo} no`,
  ]
    .filter(Boolean)
    .join(" · "),
);
const listened = $derived(playingSince ? Math.max(0, Math.floor((now - playingSince) / 1000)) : 0);
/** How the previous deck went, for the start screen. */
const lastDeck = $derived.by(() => {
  const stat = data?.decks?.at(-1);
  if (!stat || !data) return null;
  return { ...stat, ...deckOutcome(data, stat.at) };
});
const skipped = $derived(deck.length - sessionYes - sessionNo);
/** Opens the Spotify app on the deck (or just the app before the playlist exists). */
const openDeckHref = $derived(deckPlaylist ? spotify.openUri(deckPlaylist) : "spotify:");

const mmss = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const TAG_TONES = ["tone-genre", "tone-era", "tone-mood", "tone-extra"];

$effect(() => {
  void loadTrain().then(async (d) => {
    data = d;
    // A fresh device: your swipes come back from the Spotify playlists.
    const restored = await restoreFromSpotify(d).catch(() => null);
    if (restored) {
      data = restored.data;
      app.notify(`Restored ${restored.yes} yes and ${restored.no} no from your Spotify playlists.`, "ok");
    }
    // Get a deck ready while you read the screen, so Start is instant.
    prefetchDeck($state.snapshot(data) as TrainData);
  });
  const tick = setInterval(() => (now = Date.now()), 1000);
  return () => {
    clearInterval(tick);
    // Stop the music when you leave Train.
    if (device) void spotify.pause(device.id).catch(() => {});
  };
});

const DEVICE_KEY = "ps.trainDevice";
/** Plain words for what went wrong, above Spotify's own reply. */
let hint = $state("");
/** All Spotify devices, for the picker. */
let devices = $state<spotify.Device[]>([]);
/** The picker is open (no remembered device, or you tapped Change). */
let choosing = $state(false);
/** Spotify's last answer to a play command, shown when something goes wrong. */
let lastReply = $state("");

async function loadDevices(): Promise<void> {
  devices = await spotify.getDevices().catch(() => []);
}

/**
 * Use the device you picked before if Spotify still lists it; with exactly
 * one usable device, use that; otherwise open the picker. After a failed
 * start (`awake`), the device that is active right now wins instead: it's
 * the one you just pressed play on, and the remembered one didn't answer.
 */
async function findDevice(awake = false): Promise<boolean> {
  await loadDevices();
  const usable = devices.filter((d) => !d.is_restricted);
  const saved = usable.find((d) => d.id === localStorage.getItem(DEVICE_KEY));
  const active = usable.find((d) => d.is_active);
  const only = usable.length === 1 ? usable[0] : undefined;
  device = (awake ? (active ?? saved) : (saved ?? active)) ?? only ?? null;
  // No saved choice yet and several devices: you pick (once).
  if (!awake && !saved && usable.length > 1) device = null;
  blocked = devices.length === 0 ? "spotify" : null;
  choosing = devices.length > 0 && !device;
  return Boolean(device);
}

function choose(d: spotify.Device) {
  device = d;
  localStorage.setItem(DEVICE_KEY, d.id);
  choosing = false;
  blocked = null;
  if (deck.length && !done) void wakeAndPlay(index);
}

async function changeDevice() {
  await loadDevices();
  blocked = devices.length === 0 ? "spotify" : null;
  choosing = devices.length > 0;
}

const deviceKind = (d: spotify.Device) =>
  ({
    smartphone: "Phone",
    computer: "Computer",
    speaker: "Speaker",
    tv: "TV",
    castaudio: "Cast speaker",
    castvideo: "Cast TV",
    tablet: "Tablet",
    avr: "Receiver",
    stb: "TV box",
    gameconsole: "Console",
    automobile: "Car",
  })[d.type.toLowerCase()] ?? d.type;

/** Bumped on every play, so an older play's check stops when a newer one starts. */
let playToken = 0;
/** Spotify accepted the command but no sound was confirmed within ~3 s. */
let noSound = $state(false);

/** Play the deck from card i; measure how long until Spotify plays it. */
async function playFrom(i: number) {
  const current = deck[i];
  if (!current || !device) return;
  const token = ++playToken;
  startedIn = null;
  playingSince = null;
  noSound = false;
  hint = "";
  const t0 = performance.now();
  await deckPlaylistReady;
  // A card that just arrived must be in the playlist before Spotify can play it there.
  await playlistWrites;
  if (token !== playToken) return;
  try {
    if (deckPlaylist) {
      await spotify.playInPlaylist(device.id, deckPlaylist, i, startPosition(current.track));
    } else {
      await spotify.playList(
        device.id,
        deck.slice(i).map((c) => c.track.uri),
        startPosition(current.track),
      );
    }
    lastReply = "Spotify accepted the play command.";
  } catch (e) {
    lastReply = e instanceof Error ? e.message : String(e);
    if (spotify.unreachable(e) || (e instanceof SpotifyError && e.status === 404)) {
      // The Spotify app is asleep (iOS suspends it) or gone: open it on the deck.
      blocked = "spotify";
      return;
    }
    if (e instanceof SpotifyError && e.status === 403 && /premium/i.test(e.message)) {
      blocked = "premium";
      return;
    }
    noSound = true;
    return;
  }
  playingSince = Date.now();
  // Ask Spotify what's playing until it's this song (about 3 s at most).
  for (let n = 0; n < 20 && token === playToken; n++) {
    const playing = await spotify.nowPlaying().catch(() => null);
    if (token !== playToken) return;
    if (spotify.isPlayingTrack(playing, current.track)) {
      startedIn = (performance.now() - t0) / 1000;
      playingSince = Date.now();
      // The device that really plays is the one to remember.
      const actual = devices.find((d) => d.id === playing?.deviceId);
      if (actual && actual.id !== device.id) device = actual;
      localStorage.setItem(DEVICE_KEY, device.id);
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  // Spotify said yes, but nothing is playing: the device is asleep or gone
  // (a closed laptop stays on Spotify's list for a while). Starting the deck
  // in the Spotify app is the way out.
  if (token === playToken) {
    const state = await spotify.nowPlaying().catch(() => null);
    lastReply = `${lastReply} But nothing started on “${device.name}”. ${spotify.describePlayback(state)}`;
    playingSince = null;
    blocked = "spotify";
  }
}

/** Wake the chosen Spotify app, then play from card i. */
async function wakeAndPlay(i: number) {
  if (!device) return;
  // Already the active device: nothing to wake, play straight away.
  if (device.is_active) return playFrom(i);
  const token = playToken;
  await spotify.transferTo(device.id).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  // You swiped while Spotify was waking: that newer play wins.
  if (token !== playToken) return;
  await playFrom(i);
}

/** Put the deck into "Géza · Deck"; if that fails, Spotify gets plain song lists. */
function prepareDeckPlaylist(cards: Card[]) {
  deckPlaylist = null;
  if (!data) return;
  const snapshot = $state.snapshot(data) as TrainData;
  deckPlaylistReady = fillDeckPlaylist(
    snapshot,
    cards.map((c) => c.track.uri),
    app.profile,
  )
    .then((filled) => {
      data = { ...(data ?? filled.data), deckPlaylistId: filled.playlistId };
      deckPlaylist = filled.playlistId;
    })
    .catch(() => {});
}

/**
 * The deck keeps growing while you listen: each card joins the moment it is
 * found, and goes into the deck playlist behind the ones before it.
 */
function addRest(built: Deck, at: number) {
  more = true;
  const add = (c: Card) => {
    if (deckAt !== at || deck.length >= DECK_SIZE) return;
    const key = songKey(c.track.artist, c.track.title);
    if (deck.some((d) => songKey(d.track.artist, d.track.title) === key)) return;
    // You already swiped past the last card and are waiting for this one.
    const waiting = index >= deck.length && !leaving;
    deck = [...deck, c];
    enrichDeck([c]);
    playlistWrites = playlistWrites.then(async () => {
      await deckPlaylistReady;
      if (deckPlaylist && deckAt === at)
        await spotify.addToPlaylist(deckPlaylist, [c.track.uri]).catch(() => {});
    });
    if (waiting && device && !blocked) void playFrom(index);
  };
  built.onCard?.(add);
  void built.rest
    ?.then((extraCards) => {
      for (const c of extraCards) add(c);
    })
    .catch(() => {})
    .finally(async () => {
      await playlistWrites;
      if (deckAt !== at) return;
      more = false;
      if (data) data = await recordDeck($state.snapshot(data) as TrainData, { ...built, cards: deck });
      // Swiped past the last card while the rest was on its way.
      if (index >= deck.length && device) void spotify.pause(device.id).catch(() => {});
      else if (index < deck.length && !playingSince && device && !blocked) void playFrom(index);
    });
}

async function start() {
  if (!data) return;
  const current = $state.snapshot(data) as TrainData;
  // Find where to play while the deck is being built, not after.
  const deviceFound = findDevice();
  const built = await app.task("Starting…", (progress) => takeDeck(current, progress));
  if (!built) return;
  deck = built.cards;
  deckAt = built.at;
  prepareDeckPlaylist(built.cards);
  enrichDeck(built.cards);
  index = 0;
  last = null;
  sessionYes = 0;
  sessionNo = 0;
  if (built.rest) addRest(built, built.at);
  else data = await recordDeck(current, built);
  if (await deviceFound) void wakeAndPlay(0);
}

async function retrySpotify() {
  if (await findDevice(true)) void playFrom(index);
}

// Coming back from the Spotify app: try again on its own.
$effect(() => {
  const back = () => {
    if (document.visibilityState === "visible" && (blocked === "spotify" || noSound) && deck.length)
      void retrySpotify();
  };
  document.addEventListener("visibilitychange", back);
  return () => document.removeEventListener("visibilitychange", back);
});

function decide(verdict: Verdict) {
  if (!card || !data || leaving) return;
  // A plain copy: IndexedDB can't store Svelte's reactive proxies.
  const judged = $state.snapshot(card) as Card;
  const dwell = playingSince ? Date.now() - playingSince : 0;
  leaving = verdict;
  if (verdict === "yes") sessionYes++;
  if (verdict === "no") sessionNo++;
  // Start the next song right away; the card animation covers the wait.
  const next = index + 1;
  if (next < deck.length) void playFrom(next);
  else if (device) {
    playingSince = null;
    void spotify.pause(device.id).catch(() => {});
  }
  const extra = $state.snapshot(details[judged.track.id] ?? { genres: [] }) as Enrichment;
  last = { card: judged, verdict, at: index };
  // In a chain: a swipe saved from stale data would wipe out the one before it.
  saving = saving
    .then(async () => {
      if (!data) return;
      const d = await judge($state.snapshot(data) as TrainData, judged, verdict, app.profile, dwell, extra);
      data = { ...d, deckPlaylistId: data?.deckPlaylistId ?? d.deckPlaylistId };
      // Near the end of a deck, prepare the next one with your latest swipes.
      if (!more && deck.length - next <= 5)
        prefetchDeck(d, { at: deckAt, cards: $state.snapshot(deck.slice(next)) as Card[] });
    })
    .catch(() => {});
  setTimeout(() => {
    index = next;
    leaving = null;
    if (cardEl) cardEl.style.transform = "";
  }, 260);
}

/** Take the latest swipe back: the song is the current card again, and it plays. */
function undo() {
  if (!last || leaving) return;
  const { card: song, verdict, at } = last;
  last = null;
  if (verdict === "yes") sessionYes--;
  if (verdict === "no") sessionNo--;
  index = at;
  if (device && !blocked) void playFrom(at);
  saving = saving
    .then(async () => {
      if (!data) return;
      const d = await unjudge($state.snapshot(data) as TrainData, song, verdict);
      data = { ...d, deckPlaylistId: data?.deckPlaylistId ?? d.deckPlaylistId };
    })
    .catch(() => {});
}
const VERDICT_WORD: Record<Verdict, string> = { yes: "yes", no: "no", later: "skip" };

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

/** Which verdict a drag is heading for, and how far along it is (1 = far enough). */
function leaning(dx: number, dy: number): { verdict: Verdict | null; pull: number } {
  const up = Math.max(0, -dy);
  if (Math.abs(dx) >= up)
    return { verdict: dx > 0 ? "yes" : dx < 0 ? "no" : null, pull: Math.abs(dx) / THRESHOLD };
  return { verdict: "later", pull: up / THRESHOLD };
}

let stampYes = $state<HTMLElement | null>(null);
let stampNo = $state<HTMLElement | null>(null);
let stampLater = $state<HTMLElement | null>(null);
/** Fade in the word for the verdict the drag is heading for (through CSSOM: the CSP allows that). */
function showStamp(verdict: Verdict | null, pull: number) {
  const stamps = { yes: stampYes, no: stampNo, later: stampLater };
  for (const [v, el] of Object.entries(stamps)) {
    if (el) el.style.opacity = v === verdict ? String(Math.min(1, pull)) : "0";
  }
}

function move(e: PointerEvent) {
  if (!start0 || !cardEl) return;
  const dx = e.clientX - start0.x;
  const dy = Math.min(0, e.clientY - start0.y);
  cardEl.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
  const { verdict, pull } = leaning(dx, dy);
  showStamp(verdict, pull);
}

function up(e: PointerEvent) {
  if (!start0) return;
  const dx = e.clientX - start0.x;
  const dy = e.clientY - start0.y;
  start0 = null;
  const { verdict, pull } = leaning(dx, dy);
  showStamp(null, 0);
  if (verdict && pull >= 1) decide(verdict);
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

{#if swiping}<BackButton href="#/" label="Leave the deck, back to mixes" />{/if}

<main class="screen train" class:swiping>
  {#if card && !done && !choosing}<div class="counter">{index + 1} / {deck.length}</div>{/if}
  {#if !swiping}<h1>Discover</h1>{/if}

  {#if choosing}
    <section class="card picker" aria-label="Where should the deck play?">
      <div class="picker-title">Where should the deck play?</div>
      <p class="small muted">Your Spotify devices right now. Géza remembers your choice.</p>
      <ul class="device-list">
        {#each devices as d (d.id)}
          <li>
            <button class="device" class:current={device?.id === d.id} disabled={d.is_restricted} onclick={() => choose(d)}>
              <span class="device-name">{d.name}</span>
              <span class="small muted">
                {deviceKind(d)}{d.is_active ? " · active now" : ""}{d.is_restricted ? " · Spotify doesn't allow remote control" : ""}
              </span>
            </button>
          </li>
        {/each}
      </ul>
      <p class="small muted">Not listed? Open Spotify on that device and play anything for a second.</p>
      <div class="two">
        <a class="btn secondary small" href="spotify:">Open Spotify</a>
        <button class="btn secondary small" onclick={changeDevice}>Refresh list</button>
      </div>
    </section>
  {/if}

  {#if blocked === "spotify"}
    <div class="card notice" role="status">
      <div class="wake" aria-hidden="true">
        <span class="phone"><span class="dot"></span></span>
        <span class="eq"><span></span><span></span><span></span><span></span></span>
      </div>
      <div class="notice-title">Start the deck in Spotify</div>
      <p class="small muted">
        {device ? `Spotify on “${device.name}” isn't answering` : "Spotify isn't running"}, so Géza can't start it from
        here. Tap below, press play in Spotify once, then come back: every swipe then moves it to the next song.
      </p>
      <div class="two">
        <a class="btn small" href={openDeckHref}>Open the deck in Spotify</a>
        <button class="btn secondary small" onclick={retrySpotify}>I'm back</button>
        {#if devices.length > 0}
          <button class="btn secondary small" onclick={changeDevice}>Change device</button>
        {/if}
      </div>
      {#if lastReply}
        <details class="small muted said">
          <summary>What Spotify said</summary>
          {lastReply}
        </details>
      {/if}
    </div>
  {:else if blocked === "premium"}
    <div class="card notice" role="status">
      <div class="notice-title">Spotify Premium needed</div>
      <p class="small muted">Spotify only lets apps start songs on Premium accounts.</p>
    </div>
  {/if}

  {#if card && !done && !choosing}
    <div class="deck">
      <div class="behind" aria-hidden="true"></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <article
        class="card swipe"
        class:fly-yes={leaving === "yes"}
        class:fly-no={leaving === "no"}
        class:fly-later={leaving === "later"}
        aria-label={`${card.track.title} by ${card.track.artist}`}
        bind:this={cardEl}
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={up}
      >
        <div class="art">
          <span class="stamp yes" bind:this={stampYes} aria-hidden="true">Yes</span>
          <span class="stamp no" bind:this={stampNo} aria-hidden="true">No</span>
          <span class="stamp later" bind:this={stampLater} aria-hidden="true">Skip</span>
          {#if card.track.image}
            <img src={card.track.image} alt="" draggable="false" />
          {:else}
            <div class="placeholder" aria-hidden="true"><Icon name="mixes" size={48} /></div>
          {/if}
          <div class="playing small">
            <span class="mini-eq" aria-hidden="true"><span></span><span></span><span></span></span>
            In Spotify · from {mmss(startPosition(card.track))}{#if playingSince} · listening {mmss(listened * 1000)}{/if}
          </div>
        </div>
        <div class="info">
          <div class="title-row">
            <div class="title">{card.track.title}</div>
            {#if card.track.explicit}<span class="explicit" aria-label="Explicit">E</span>{/if}
          </div>
          <div class="artist">{card.track.artist}</div>
          <div class="meta small muted">
            {[
              card.track.album,
              firstYear ? `${firstYear} (this version ${card.track.year})` : card.track.year,
              card.track.durationMs ? mmss(card.track.durationMs) : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {#if extra?.country || extra?.artistType}
            <div class="origin small muted">
              {extra.artistType === "Person" ? "Solo artist" : (extra.artistType ?? "Artist")}{extra.country
                ? ` from ${countryName(extra.country)}`
                : ""}
            </div>
          {/if}
          {#if card.tags.length || extra?.genres.length}
            <div class="tags">
              {#each card.tags as tag, i (tag)}<span class="tag {TAG_TONES[i] ?? 'tone-extra'}">{tag}</span>{/each}
              {#each (extra?.genres ?? []).filter((g) => !card.tags.includes(g)).slice(0, 2) as g (g)}<span
                  class="tag tone-genre">{g}</span
                >{/each}
            </div>
          {/if}
          {#if card.track.popularity !== undefined}
            {@const filled = Math.max(1, Math.round(card.track.popularity / 20))}
            <div class="pop small muted">
              Popularity
              <span class="meter" role="img" aria-label={`Popularity ${filled} of 5`}>
                {#each [1, 2, 3, 4, 5] as n (n)}<span class:on={n <= filled}></span>{/each}
              </span>
            </div>
          {/if}
          <div class="reason small"><Icon name="sparkle" size={14} /><span>{card.reason}</span></div>
        </div>
      </article>
    </div>

    <div class="choices">
      <button class="choice no" aria-label="No, never suggest it" onclick={() => decide("no")}>
        <span aria-hidden="true">✕</span>
      </button>
      <button class="choice later" aria-label="Skip for now" onclick={() => decide("later")}>
        <span aria-hidden="true">↑</span>
      </button>
      <button class="choice yes" aria-label="Yes, I like it" onclick={() => decide("yes")}>
        <span aria-hidden="true">♥</span>
      </button>
    </div>
    {#if last}
      <button class="undo-chip small" onclick={undo}>
        <Icon name="undo" size={16} /><span>Undo {VERDICT_WORD[last.verdict]}: {last.card.track.title}</span>
      </button>
    {/if}
    {#if noSound}
      <div class="card nosound" role="alert">
        <strong>No sound?</strong>
        <p class="small muted">
          Spotify on “{device?.name ?? "your device"}” didn't start. Open Spotify there, tap play on any song once, then
          come back and try again, or pick another device.
        </p>
        {#if hint}<p class="small hint">{hint}</p>{/if}
        {#if lastReply}<p class="reply small">Spotify said: {lastReply}</p>{/if}
        <div class="two">
          <button class="btn secondary small" onclick={changeDevice}>Change device</button>
          <a class="btn secondary small" href={openDeckHref}>Open the deck in Spotify</a>
          <button class="btn small" onclick={retrySpotify}>Try again</button>
        </div>
      </div>
    {/if}
    {#if device && !choosing}
      <button class="device-chip small" onclick={changeDevice}>Play on: {device.name} · Change</button>
    {/if}
    <p class="status small muted" aria-live="polite">{statusLine}</p>
  {:else if more && deck.length > 0 && index >= deck.length}
    <div class="card notice center" role="status">
      <div class="notice-title">More songs on the way…</div>
      <p class="small muted">Claude is still picking the rest of this deck.</p>
    </div>
  {:else if done}
    <div class="card notice center">
      <div class="notice-title big">Deck done</div>
      <p class="small muted">Your choices now steer every mix and every random pick.</p>
      <div class="stats">
        <div class="stat yes"><strong>{sessionYes}</strong>Yes</div>
        <div class="stat"><strong class="red">{sessionNo}</strong>No</div>
        <div class="stat"><strong class="muted">{skipped}</strong>Skipped</div>
      </div>
      {#if skipped > 0}<p class="small muted">Skipped songs don't count either way.</p>{/if}
      <div class="two">
        {#if last}
          <button class="btn secondary small" onclick={undo}><Icon name="undo" size={16} />Undo last swipe</button>
        {/if}
        {#if data?.playlistId}
          <a class="btn secondary small" href={spotify.openUri(data.playlistId)}>Play “{YES_PLAYLIST}”</a>
        {/if}
        <button class="btn small" onclick={start} disabled={!!app.busy}>New deck</button>
      </div>
    </div>
  {:else if !blocked && !choosing}
    <p class="lead">
      Claude names artists you probably don't know; Spotify supplies a real song by each. {DECK_SIZE} per deck, each
      starting at its catchy part. You stay in Géza; the sound comes from your Spotify app.
    </p>
    <div class="card rules">
      <div class="row"><span class="badge keep">→</span><span><strong>Swipe right: keep</strong><br /><span class="small muted">Goes to “{YES_PLAYLIST}” and steers every mix</span></span></div>
      <div class="row"><span class="badge drop">←</span><span><strong>Swipe left: drop</strong><br /><span class="small muted">Goes to “{NO_PLAYLIST}”, never suggested again</span></span></div>
      <div class="row"><span class="badge later">↑</span><span><strong>Swipe up: skip for now</strong><br /><span class="small muted">Doesn't count either way</span></span></div>
    </div>
    <button class="btn start" onclick={start} disabled={!data || !!app.busy}>Start a deck</button>
    <a class="card row learned" href="#/taste">
      <span class="badge keep"><Icon name="check" size={18} /></span>
      <span class="grow">
        <strong>What Géza learned</strong><br />
        <span class="small muted">Genres, eras, artists it thinks you like; switch off any it got wrong</span>
      </span>
      <Icon name="arrow" size={18} />
    </a>
    {#if data && (data.yes.length || data.no.length)}
      <p class="small muted tally">So far: {data.yes.length} yes · {data.no.length} no</p>
    {/if}
    {#if data?.playlistId}
      <a class="btn secondary small yes-link" href={spotify.openUri(data.playlistId)}>
        <Icon name="play" size={16} />Play “{YES_PLAYLIST}” in Spotify · {data.yes.length} songs
      </a>
    {/if}
    {#if lastDeck}
      <p class="small muted tally">
        Last deck: you kept {lastDeck.yes} of {lastDeck.size} song{lastDeck.size === 1 ? "" : "s"}
      </p>
      <details class="small muted timing">
        <summary>How it was built</summary>
        <span data-testid="last-deck">
          Last deck: {lastDeck.found} of {lastDeck.asked} artists on Spotify · {lastDeck.size} songs · {lastDeck.yes} yes,
          {lastDeck.no} no
          {#if lastDeck.ms}
            · first cards in {(lastDeck.ms.total / 1000).toFixed(1)} s (Claude {(lastDeck.ms.claude / 1000).toFixed(1)} s,
            Spotify {((lastDeck.ms.listening + lastDeck.ms.spotify) / 1000).toFixed(1)} s{lastDeck.ms.waited
              ? `, of which ${(lastDeck.ms.waited / 1000).toFixed(0)} s waiting for Spotify's rate limit`
              : ""})
          {/if}
        </span>
      </details>
    {/if}
  {/if}
</main>

{#if !swiping}<TabBar active="discover" />{/if}

<style>
  .train { position: relative; }
  .counter {
    position: absolute; right: 20px; top: calc(26px + var(--safe-top));
    font-size: 13px; font-weight: 700; padding: 6px 12px; border-radius: 14px;
    background: var(--white); box-shadow: 0 1px 0 var(--line);
  }
  .lead { margin-top: 8px; }
  .notice { margin-top: 16px; padding: 22px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .notice.center { align-items: center; text-align: center; }
  .notice p { margin: 0 0 6px; }
  .notice-title { font: 800 22px/26px var(--display); }
  .notice-title.big { font-size: 32px; line-height: 36px; }
  .two { display: flex; gap: 10px; flex-wrap: wrap; }
  .said { margin-top: 4px; word-break: break-word; }
  .said summary { cursor: pointer; padding: 6px 0; }
  .wake { position: relative; width: 132px; height: 96px; margin: 4px auto 6px; }
  .wake .phone {
    position: absolute; left: 0; top: 10px; width: 58px; height: 84px; border-radius: 14px; background: var(--ink);
    display: flex; align-items: center; justify-content: center;
  }
  .wake .dot { width: 30px; height: 30px; border-radius: 50%; background: #34c791; }
  .wake .eq {
    position: absolute; right: 0; top: 0; width: 58px; height: 94px; border-radius: 14px; background: var(--white);
    box-shadow: 0 0 0 2px var(--ink); display: flex; align-items: flex-end; justify-content: center; gap: 3px;
    padding-bottom: 20px; box-sizing: border-box;
  }
  .wake .eq span { width: 6px; border-radius: 3px; }
  .wake .eq span:nth-child(1) { height: 16px; background: #ff6b3d; }
  .wake .eq span:nth-child(2) { height: 28px; background: #5b86ff; }
  .wake .eq span:nth-child(3) { height: 20px; background: #ffc83d; }
  .wake .eq span:nth-child(4) { height: 34px; background: #34c791; }
  .rules { margin-top: 16px; }
  .rules .row { gap: 12px; }
  .badge {
    width: 32px; height: 32px; flex: none; border-radius: 10px; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
  }
  .badge.keep { background: var(--lime); }
  .badge.drop { background: #ffe3d6; color: var(--danger); }
  .badge.later { background: var(--bg); color: var(--muted); }
  .start { margin-top: 16px; }
  .learned { margin-top: 12px; min-height: 72px; }
  .learned .grow { flex: 1; min-width: 0; }
  .undo-chip {
    display: flex; align-items: center; gap: 8px; margin: 14px auto 0; max-width: 100%; min-height: 44px;
    padding: 0 16px; border-radius: 22px; border: 1.5px solid var(--line); background: var(--white);
    font-weight: 600; cursor: pointer;
  }
  .undo-chip span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tally { text-align: center; margin: 12px 8px 0; }
  .yes-link { display: flex; justify-content: center; margin: 12px auto 0; width: fit-content; }
  .deck { position: relative; margin-top: 12px; }
  /* No tab bar while a deck is on screen: no room kept for it. */
  .swiping { padding-bottom: calc(24px + var(--safe-bottom)); }
  .swiping .deck { margin-top: 0; }
  .timing { text-align: center; margin: 2px 8px 0; }
  .timing summary { cursor: pointer; min-height: 44px; display: inline-flex; align-items: center; }
  .behind {
    position: absolute; left: 14px; right: 14px; top: 14px; bottom: -10px;
    border-radius: 28px; background: var(--white); opacity: 0.7; box-shadow: 0 1px 0 var(--line);
  }
  .swipe {
    position: relative; touch-action: none; user-select: none; -webkit-user-select: none; cursor: grab;
    box-shadow: 0 14px 34px rgba(20, 19, 15, 0.14);
    transition: transform 0.25s ease-out, opacity 0.25s ease-out;
  }
  .swipe:active { transition: none; }
  .fly-yes { transform: translateX(130%) rotate(18deg) !important; opacity: 0; }
  .fly-no { transform: translateX(-130%) rotate(-18deg) !important; opacity: 0; }
  .fly-later { transform: translateY(-120%) !important; opacity: 0; }
  /* Short enough that the card, its three buttons and the undo fit one screen. */
  .art { position: relative; height: clamp(120px, 26dvh, 250px); background: var(--line); }
  .stamp {
    position: absolute; z-index: 1; top: 14px; padding: 6px 14px; border-radius: 14px; opacity: 0;
    font: 800 22px/26px var(--display); text-transform: uppercase; pointer-events: none;
    border: 2px solid var(--ink); background: var(--white);
  }
  .stamp.yes { left: 14px; background: var(--lime); transform: rotate(-8deg); }
  .stamp.no { right: 14px; background: #ffe3d6; color: var(--danger); border-color: var(--danger); transform: rotate(8deg); }
  .stamp.later { left: 50%; transform: translateX(-50%); }
  .art img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .hint { margin: 0 0 4px; font-weight: 600; }
  .placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
  .playing {
    position: absolute; left: 12px; bottom: 12px; display: flex; align-items: center; gap: 8px;
    padding: 7px 12px 7px 10px; border-radius: 16px; background: rgba(20, 19, 15, 0.8); color: var(--white);
    font-weight: 600;
  }
  .mini-eq { display: flex; align-items: flex-end; gap: 2px; height: 14px; }
  .mini-eq span { width: 3px; border-radius: 2px; background: var(--lime); animation: mini 0.9s ease-in-out infinite; }
  .mini-eq span:nth-child(2) { animation-delay: -0.3s; }
  .mini-eq span:nth-child(3) { animation-delay: -0.6s; }
  @keyframes mini { 0%, 100% { height: 5px; } 50% { height: 14px; } }
  .info { padding: 14px 18px 18px; }
  .title-row { display: flex; align-items: flex-start; gap: 8px; }
  .title { flex: 1; min-width: 0; font: 800 24px/28px var(--display); letter-spacing: -0.01em; }
  .explicit {
    margin-top: 4px; flex: none; width: 20px; height: 20px; border-radius: 4px; background: var(--muted);
    color: var(--white); font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center;
  }
  .artist { margin-top: 2px; font-weight: 600; }
  .meta { margin-top: 4px; }
  .origin { margin-top: 2px; }
  .tags { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
  .tag { font-size: 12px; line-height: 16px; font-weight: 700; padding: 5px 10px; border-radius: 12px; }
  .tone-genre { background: #ffe3d6; }
  .tone-era { background: #eef3ff; }
  .tone-mood { background: #eafbf3; }
  .tone-extra { background: var(--bg); }
  .pop { margin-top: 10px; display: flex; align-items: center; gap: 8px; }
  .meter { display: flex; gap: 3px; }
  .meter span { width: 14px; height: 6px; border-radius: 3px; background: var(--line); }
  .meter span.on { background: var(--ink); }
  .reason { margin-top: 10px; display: flex; align-items: flex-start; gap: 6px; }
  .choices { margin-top: 18px; display: flex; justify-content: center; align-items: center; gap: 22px; }
  .choice {
    width: 64px; height: 64px; border-radius: 50%; border: none; cursor: pointer;
    font-size: 26px; font-weight: 700; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 6px 16px rgba(20, 19, 15, 0.14);
  }
  .choice.later { width: 52px; height: 52px; font-size: 20px; background: var(--white); color: var(--muted); }
  .no { background: var(--white); color: var(--danger); }
  .yes { background: var(--lime); color: var(--ink); border: 2px solid var(--ink); }
  .status { text-align: center; margin: 12px 0 0; }
  .nosound { margin-top: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }
  .nosound p { margin: 0 0 4px; }
  .reply {
    font-family: ui-monospace, Menlo, monospace; font-size: 12px; line-height: 17px;
    background: var(--bg); border-radius: 10px; padding: 8px 10px; word-break: break-word;
  }
  .picker { margin-top: 16px; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .picker p { margin: 0; }
  .picker-title { font: 800 20px/24px var(--display); }
  .device-list { list-style: none; margin: 4px 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .device {
    width: 100%; min-height: 56px; padding: 8px 14px; border-radius: 16px; border: 1.5px solid var(--line);
    background: var(--white); text-align: left; cursor: pointer; display: flex; flex-direction: column; justify-content: center;
  }
  .device.current { border-color: var(--ink); background: var(--lime); }
  .device:disabled { opacity: 0.5; cursor: default; }
  .device-name { font-weight: 700; }
  .device-chip {
    display: block; margin: 12px auto 0; min-height: 44px; padding: 0 16px; border-radius: 22px;
    border: 1.5px solid var(--line); background: var(--white); font-weight: 600; cursor: pointer;
  }
  .stats { width: 100%; margin: 8px 0 6px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .stat { border-radius: 22px; padding: 12px; background: var(--bg); font-size: 13px; font-weight: 700; }
  .stat.yes { background: var(--lime); }
  .stat strong { display: block; font: 800 30px/34px var(--display); }
  .red { color: var(--danger); }
  @media (prefers-reduced-motion: reduce) {
    .swipe { transition: opacity 0.15s linear; }
    .fly-yes, .fly-no, .fly-later { transform: none !important; }
    .mini-eq span { animation: none; height: 10px; }
  }
</style>
