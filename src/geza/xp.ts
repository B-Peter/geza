// Géza's XP: one point for everything he has learned about your taste.

import { LEVELS, type Level } from "./sprite.js";

export interface XpSources {
  /** Train swipes (yes, no and later). */
  swipes: number;
  /** Plays of mix songs counted by the ledger. */
  plays: number;
  /** Songs in the mixes you've hearted. */
  hearts: number;
}

export const xpFrom = (s: XpSources): number => s.swipes + s.plays + s.hearts;

export interface LevelInfo {
  level: Level;
  next: Level | null;
  xp: number;
  /** Progress towards the next level, 0..1 (1 at the top level). */
  progress: number;
}

export function levelFor(xp: number): LevelInfo {
  const reached = LEVELS.filter((l) => xp >= l.from);
  const level = reached[reached.length - 1] ?? (LEVELS[0] as Level);
  const next = LEVELS.find((l) => l.from > xp) ?? null;
  const progress = next ? (xp - level.from) / (next.from - level.from) : 1;
  return { level, next, xp, progress: Math.max(0, Math.min(1, progress)) };
}
