// One Spotify player for a whole Train deck. iOS lets an embedded player make
// sound only after a tap inside it, and a new player (new card) needs a new
// tap. So the deck goes into one playlist, one player plays it, and Géza
// steers that player with the embed's postMessage commands: a swipe skips to
// the next song by seeking to the end of the current one.
//
// The embed doesn't say which song it is on, only position and duration, so
// DeckSync counts song changes (the position jumping back to the start) and
// keeps that count in step with the card you're looking at. Pure: it returns
// the commands to send.

export interface Playback {
  isPaused?: boolean;
  /** ms */
  position?: number;
  /** ms */
  duration?: number;
}

export type Command = { command: "seek"; timestamp: number } | { command: "pause" } | { command: "resume" };

/** Previews are 30 s; anything clearly longer is a full song worth skipping into. */
const FULL_SONG_MS = 60_000;

export class DeckSync {
  /** The song the player is on (0 = the deck's first). */
  playerIndex = 0;
  /** The card you're on. */
  wanted = 0;
  /** You've pressed play at least once (iOS needs that one tap). */
  started = false;
  /** A skip was sent and the player hasn't moved yet (since this time, ms). */
  skippingSince: number | null = null;
  private last: Playback | null = null;
  private seekedFor = -1;
  private resumeOnArrive = false;

  /** @param catchySeconds where song i should start when it's a full song. */
  constructor(private catchySeconds: (i: number) => number) {}

  /** A playback update from the player. */
  update(p: Playback, now = Date.now()): Command[] {
    const prev = this.last;
    if (prev && typeof p.position === "number" && typeof prev.position === "number") {
      const jumpedBack = p.position + 1500 < prev.position;
      const newLength = !!prev.duration && !!p.duration && p.duration !== prev.duration;
      if (jumpedBack || newLength) {
        this.playerIndex++;
        this.skippingSince = null;
      }
    }
    this.last = p;
    if (p.isPaused === false) this.started = true;
    return this.sync(now);
  }

  /** You moved to card i. */
  goTo(i: number, now = Date.now()): Command[] {
    this.wanted = i;
    this.resumeOnArrive = true;
    return this.sync(now);
  }

  /** The player was asked to skip but didn't move: autoplay of the next song isn't working. */
  stuck(now = Date.now(), afterMs = 4000): boolean {
    return this.skippingSince !== null && now - this.skippingSince > afterMs;
  }

  private sync(now: number): Command[] {
    const p = this.last;
    if (!p || !this.started) return [];
    if (this.playerIndex < this.wanted) {
      if (this.skippingSince !== null) return [];
      this.skippingSince = now;
      const end = Math.max(0, Math.floor((p.duration ?? 0) / 1000) - 1);
      return [{ command: "seek", timestamp: end }, { command: "resume" }];
    }
    if (this.playerIndex > this.wanted) {
      // The song ended by itself and the player moved on ahead of the card:
      // hold the next song until you swipe.
      return p.isPaused ? [] : [{ command: "pause" }];
    }
    const out: Command[] = [];
    if (this.resumeOnArrive && p.isPaused) out.push({ command: "resume" });
    this.resumeOnArrive = false;
    if (!p.isPaused && (p.duration ?? 0) > FULL_SONG_MS && this.seekedFor !== this.playerIndex) {
      this.seekedFor = this.playerIndex;
      out.push({ command: "seek", timestamp: this.catchySeconds(this.playerIndex) });
    }
    return out;
  }
}
