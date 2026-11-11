import { describe, expect, it } from "vitest";
import { defaultMixes, type Mix } from "../src/mixes.js";
import type { Track } from "../src/spotify.js";
import {
  addBlocked,
  applySwap,
  balance,
  capAdditions,
  filterAdditions,
  matchRemovals,
  swapCounts,
  unblock,
} from "../src/swap.js";
import { songKey } from "../src/text.js";

const track = (n: number, artist = `Artist ${n}`, title = `Song ${n}`): Track => ({
  id: `id${n}`,
  uri: `spotify:track:id${n}`,
  artist,
  title,
});
const tracks = (count: number) => Array.from({ length: count }, (_, i) => track(i + 1));
const mixOf = (id: Mix["id"], patch: Partial<Mix> = {}): Mix => ({
  ...defaultMixes().find((m) => m.id === id)!,
  ...patch,
});

describe("songKey", () => {
  it("ignores case, accents, version suffixes and featured artists", () => {
    expect(songKey("Beyoncé, Jay-Z", "Crazy in Love - Remastered 2011")).toBe(
      songKey("beyonce", "Crazy In Love"),
    );
    expect(songKey("Queen", "Bohemian Rhapsody (Live)")).toBe(songKey("Queen", "Bohemian Rhapsody"));
  });
});

describe("songKey in other scripts", () => {
  it("keeps songs with non-Latin names apart", () => {
    expect(songKey("Земфира", "Хочешь?")).not.toBe(songKey("Кино", "Группа крови"));
    expect(songKey("宇多田ヒカル", "First Love")).not.toBe(songKey("椎名林檎", "First Love"));
    expect(songKey("Земфира", "Хочешь?")).toBe(songKey("ЗЕМФИРА", "хочешь"));
  });
});

describe("a mix never grows past its size", () => {
  const entry = (n: number) => ({ track: track(n), reason: "" });
  it("lets in no more songs than go out", () => {
    const add = [101, 102, 103, 104].map(entry);
    expect(capAdditions(add, [entry(1), entry(2)], tracks(25), 25)).toHaveLength(2);
  });
  it("still fills what is missing", () => {
    const add = [101, 102, 103, 104].map(entry);
    expect(capAdditions(add, [entry(1)], tracks(23), 25)).toHaveLength(3);
  });
  it("brings an oversized mix back down at the next swap", () => {
    // 28 songs: 30% is 8, plus the 3 too many go out; 8 come in.
    expect(swapCounts(mixOf("driving", { mode: "tweak" }), tracks(28), 25)).toEqual({ remove: 11, add: 8 });
    const remove = Array.from({ length: 11 }, (_, i) => entry(i + 1));
    const add = Array.from({ length: 8 }, (_, i) => entry(i + 101));
    expect(balance(remove, add, tracks(28), 25)).toHaveLength(11);
  });
});

describe("swapCounts", () => {
  it("fills an empty mix", () => {
    expect(swapCounts(mixOf("driving"), [], 25)).toEqual({ remove: 0, add: 25 });
  });
  it("swaps the tweak percentage of a full mix", () => {
    expect(swapCounts(mixOf("driving", { mode: "tweak" }), tracks(25), 25)).toEqual({ remove: 8, add: 8 });
  });
  it("only tops up in keep mode", () => {
    expect(swapCounts(mixOf("working", { mode: "keep" }), tracks(20), 25)).toEqual({ remove: 0, add: 5 });
  });
  it("never removes more than the unlocked songs", () => {
    const current = tracks(10);
    const mix = mixOf("cooking", { mode: "renew", locked: current.slice(0, 8) });
    expect(swapCounts(mix, current, 10).remove).toBe(2);
  });
});

describe("matchRemovals", () => {
  it("maps picks to tracks and skips locked, unknown and duplicate songs", () => {
    const current = tracks(5);
    const picks = [
      { artist: "Artist 1", title: "Song 1", reason: "a" },
      { artist: "Artist 2", title: "Song 2", reason: "locked" },
      { artist: "Nobody", title: "Nothing", reason: "unknown" },
      { artist: "artist 1", title: "SONG 1", reason: "dupe" },
      { artist: "Artist 3", title: "Song 3", reason: "b" },
    ];
    const out = matchRemovals(picks, current, [current[1]!], 5);
    expect(out.map((r) => r.track.id)).toEqual(["id1", "id3"]);
  });
  it("respects the limit", () => {
    const current = tracks(5);
    const picks = current.map((t) => ({ artist: t.artist, title: t.title, reason: "" }));
    expect(matchRemovals(picks, current, [], 2)).toHaveLength(2);
  });
});

describe("filterAdditions", () => {
  it("drops missing, duplicate, blocked and already-present songs", () => {
    const current = tracks(3);
    const pick = (t: Track) => ({ pick: { artist: t.artist, title: t.title, reason: "r" }, track: t });
    const resolved = [
      pick(track(10)),
      { pick: { artist: "Ghost", title: "Not Real", reason: "r" }, track: null },
      pick(track(10)), // duplicate
      pick(current[0]!), // already in the mix
      pick(track(11)), // blocked
      pick(track(12)),
    ];
    const { add, missing } = filterAdditions(
      resolved,
      current,
      [],
      [{ artist: "Artist 11", title: "Song 11" }],
      10,
    );
    expect(add.map((a) => a.track.id)).toEqual(["id10", "id12"]);
    expect(missing).toEqual([{ artist: "Ghost", title: "Not Real", reason: "r" }]);
  });
  it("does not re-add a song that is being removed", () => {
    const current = tracks(3);
    const removing = [{ track: current[0]!, reason: "" }];
    const resolved = [{ pick: { artist: "Artist 1", title: "Song 1", reason: "" }, track: current[0]! }];
    expect(filterAdditions(resolved, current, removing, [], 5).add).toHaveLength(0);
  });
});

describe("balance and applySwap", () => {
  it("removes no more than were added, so the mix never shrinks", () => {
    const current = tracks(25);
    const remove = current.slice(0, 8).map((t) => ({ track: t, reason: "" }));
    const add = [track(100), track(101), track(102)].map((t) => ({ track: t, reason: "" }));
    const kept = balance(remove, add, current, 25);
    expect(kept).toHaveLength(3);
    expect(applySwap(current, kept, add)).toHaveLength(25);
  });
  it("fills the gap first when the mix is short", () => {
    const current = tracks(20);
    const remove = current.slice(0, 5).map((t) => ({ track: t, reason: "" }));
    const add = tracks(8).map((_, i) => ({ track: track(200 + i), reason: "" }));
    expect(balance(remove, add, current, 25)).toHaveLength(3);
  });
  it("keeps order and appends new songs", () => {
    const current = tracks(3);
    const result = applySwap(
      current,
      [{ track: current[1]!, reason: "" }],
      [{ track: track(9), reason: "" }],
    );
    expect(result.map((t) => t.id)).toEqual(["id1", "id3", "id9"]);
  });
});

describe("addBlocked and unblock", () => {
  const ref = (n: number) => ({ artist: `Artist ${n}`, title: `Song ${n}` });
  it("appends removed songs without duplicates", () => {
    const out = addBlocked([ref(1)], [ref(2), { artist: "artist 1", title: "SONG 1 (Live)" }, ref(2)]);
    expect(out).toEqual([ref(1), ref(2)]);
  });
  it("keeps only the newest entries past the cap", () => {
    const out = addBlocked([ref(1), ref(2)], [ref(3), ref(4)], 3);
    expect(out).toEqual([ref(2), ref(3), ref(4)]);
  });
  it("unblocks songs an undo brought back", () => {
    expect(unblock([ref(1), ref(2), ref(3)], [ref(2)])).toEqual([ref(1), ref(3)]);
  });
});
