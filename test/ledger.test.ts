import { describe, expect, it } from "vitest";
import {
  badge,
  effectiveScore,
  emptyLedger,
  type MixLedger,
  NEVER_PLAYED_AFTER_MS,
  SCORE,
  signals,
  syncMix,
} from "../src/ledger.js";
import type { Track } from "../src/spotify.js";

const t = (n: number): Track => ({
  id: `t${n}`,
  uri: `spotify:track:t${n}`,
  artist: `A${n}`,
  title: `S${n}`,
});
const NOW = 1_800_000_000_000;
const base = { now: NOW, plays: [], liked: null, locked: [] as Track[] };

describe("syncMix", () => {
  it("first sync only records the playlist: no adds or removes are inferred", () => {
    const r = syncMix(emptyLedger(), { ...base, current: [t(1), t(2)] });
    expect(r.block).toEqual([]);
    expect(r.lock).toEqual([]);
    expect(r.ledger.known).toEqual([t(1), t(2)]);
    expect(Object.keys(r.ledger.entries)).toEqual(["t1", "t2"]);
  });

  it("a song you removed in Spotify is blocked and scored down", () => {
    const ledger = syncMix(emptyLedger(), { ...base, current: [t(1), t(2)] }).ledger;
    const r = syncMix(ledger, { ...base, current: [t(1)] });
    expect(r.block).toEqual([t(2)]);
    expect(r.ledger.entries.t2?.score).toBe(SCORE.userRemove);
  });

  it("a song you added in Spotify is locked and scored up", () => {
    const ledger = syncMix(emptyLedger(), { ...base, current: [t(1)] }).ledger;
    const r = syncMix(ledger, { ...base, current: [t(1), t(9)] });
    expect(r.lock).toEqual([t(9)]);
    expect(r.ledger.entries.t9).toMatchObject({ score: SCORE.userAdd, autoLocked: true });
  });

  it("counts plays of songs in the mix only", () => {
    const ledger = syncMix(emptyLedger(), { ...base, current: [t(1)] }).ledger;
    const r = syncMix(ledger, {
      ...base,
      current: [t(1)],
      plays: [
        { trackId: "t1", playedAt: NOW - 1000 },
        { trackId: "t1", playedAt: NOW - 500 },
        { trackId: "elsewhere", playedAt: NOW },
      ],
    });
    expect(r.ledger.entries.t1).toMatchObject({ plays: 2, score: 2 * SCORE.play, lastPlayed: NOW - 500 });
    expect(r.ledger.entries.elsewhere).toBeUndefined();
  });

  it("a heart locks the song once; un-hearting unlocks it again", () => {
    let ledger: MixLedger = syncMix(emptyLedger(), { ...base, current: [t(1)] }).ledger;
    let r = syncMix(ledger, { ...base, current: [t(1)], liked: new Set(["t1"]) });
    expect(r.lock).toEqual([t(1)]);
    expect(r.ledger.entries.t1?.score).toBe(SCORE.like);
    ledger = r.ledger;
    // Still liked next time: no double counting.
    r = syncMix(ledger, { ...base, current: [t(1)], liked: new Set(["t1"]), locked: [t(1)] });
    expect(r.lock).toEqual([]);
    expect(r.ledger.entries.t1?.score).toBe(SCORE.like);
    ledger = r.ledger;
    r = syncMix(ledger, { ...base, current: [t(1)], liked: new Set(), locked: [t(1)] });
    expect(r.unlock).toEqual([t(1)]);
    expect(r.ledger.entries.t1?.score).toBe(0);
  });

  it("never unlocks a song you locked yourself", () => {
    const ledger = syncMix(emptyLedger(), { ...base, current: [t(1)] }).ledger;
    // You locked t1 by hand, then liked and un-liked it.
    let r = syncMix(ledger, { ...base, current: [t(1)], liked: new Set(["t1"]), locked: [t(1)] });
    expect(r.lock).toEqual([]);
    r = syncMix(r.ledger, { ...base, current: [t(1)], liked: new Set(), locked: [t(1)] });
    expect(r.unlock).toEqual([]);
  });

  it("does not change likes when Spotify couldn't say (liked = null)", () => {
    const ledger = syncMix(emptyLedger(), { ...base, current: [t(1)], liked: new Set(["t1"]) }).ledger;
    const r = syncMix(ledger, { ...base, current: [t(1)], liked: null, locked: [t(1)] });
    expect(r.unlock).toEqual([]);
    expect(r.ledger.entries.t1?.liked).toBe(true);
  });
});

describe("scores and signals", () => {
  const week = NEVER_PLAYED_AFTER_MS + 1;

  it("applies the never-played penalty only after a week", () => {
    const e = { score: 0, plays: 0, liked: false, autoLocked: false, firstSeen: NOW, lastPlayed: null };
    expect(effectiveScore(e, NOW)).toBe(0);
    expect(effectiveScore(e, NOW + week)).toBe(SCORE.neverPlayed);
  });

  it("tells Claude what was liked, played often, never played, and what to remove first", () => {
    const current = [t(1), t(2), t(3), t(4)];
    let ledger = syncMix(emptyLedger(), { ...base, current }).ledger;
    ledger = syncMix(ledger, {
      ...base,
      now: NOW + week,
      current,
      liked: new Set(["t1"]),
      plays: [
        { trackId: "t2", playedAt: NOW + 1 },
        { trackId: "t2", playedAt: NOW + 2 },
        { trackId: "t3", playedAt: NOW + 3 },
      ],
    }).ledger;
    const s = signals(ledger, current, NOW + week);
    expect(s.liked).toEqual([{ artist: "A1", title: "S1" }]);
    expect(s.played_often).toEqual([{ artist: "A2", title: "S2", plays: 2 }]);
    expect(s.never_played).toEqual([{ artist: "A4", title: "S4" }]);
    expect(s.remove_first[0]).toEqual({ artist: "A4", title: "S4" });
    expect(s.remove_first).not.toContainEqual({ artist: "A1", title: "S1" });
  });

  it("labels track rows", () => {
    const e = { score: 3, plays: 3, liked: true, autoLocked: true, firstSeen: NOW, lastPlayed: NOW };
    expect(badge(e, NOW)).toBe("Liked · played 3×");
    expect(badge({ ...e, liked: false, plays: 0 }, NOW + week)).toBe("not played yet");
    expect(badge(undefined, NOW)).toBe("");
  });
});
