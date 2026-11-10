import { describe, expect, it } from "vitest";
import { DeckSync } from "../src/deckPlayer.js";

const preview = (position: number, isPaused = false) => ({ isPaused, position, duration: 30_000 });

describe("DeckSync", () => {
  it("does nothing until you've pressed play once", () => {
    const s = new DeckSync(() => 60);
    expect(s.update(preview(0, true))).toEqual([]);
    expect(s.goTo(1)).toEqual([]);
  });

  it("skips to the next song on a swipe, then plays it", () => {
    const s = new DeckSync(() => 60);
    s.update(preview(0));
    s.update(preview(5_000));
    expect(s.goTo(1, 100)).toEqual([{ command: "seek", timestamp: 29 }, { command: "resume" }]);
    // No second skip while the first is under way.
    expect(s.update(preview(29_000), 200)).toEqual([]);
    // The player moved on: position back at the start.
    expect(s.update(preview(0), 300)).toEqual([]);
    expect(s.playerIndex).toBe(1);
    expect(s.skippingSince).toBeNull();
  });

  it("catches up after quick swipes, one song at a time", () => {
    const s = new DeckSync(() => 60);
    s.update(preview(3_000));
    s.goTo(1);
    s.goTo(2);
    // On song 1, but you're on card 2: skip again right away.
    expect(s.update(preview(0))).toEqual([{ command: "seek", timestamp: 29 }, { command: "resume" }]);
    s.update(preview(29_000));
    s.update(preview(0)); // on song 2
    expect(s.playerIndex).toBe(2);
  });

  it("holds the next song when one ends before you swiped", () => {
    const s = new DeckSync(() => 60);
    s.update(preview(29_000));
    // Ended by itself: the player is on song 1, you're still on card 0.
    expect(s.update(preview(0))).toEqual([{ command: "pause" }]);
    expect(s.update(preview(0, true))).toEqual([]);
    // Your swipe arrives at the song that is already waiting.
    expect(s.goTo(1)).toEqual([{ command: "resume" }]);
  });

  it("starts a full song at its catchy part, once", () => {
    const s = new DeckSync((i) => (i === 0 ? 77 : 0));
    expect(s.update({ isPaused: false, position: 0, duration: 222_000 })).toEqual([
      { command: "seek", timestamp: 77 },
    ]);
    expect(s.update({ isPaused: false, position: 77_000, duration: 222_000 })).toEqual([]);
  });

  it("notices when skipping doesn't work", () => {
    const s = new DeckSync(() => 60);
    s.update(preview(1_000));
    s.goTo(1, 1_000);
    expect(s.stuck(3_000)).toBe(false);
    expect(s.stuck(6_000)).toBe(true);
  });
});
