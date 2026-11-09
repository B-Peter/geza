// The four mixes, their defaults, and persistence.

import type { Pick, Tune } from "./claude.js";
import type { Track } from "./spotify.js";
import * as store from "./store.js";

export type MixId = "driving" | "working" | "cooking" | "home";
export type Mode = "keep" | "tweak" | "renew";

export interface Mix {
  id: MixId;
  name: string;
  playlistName: string;
  playlistId: string | null;
  mode: Mode;
  note: string;
  tune: Tune;
  /** Loved tracks are never swapped out. */
  locked: Track[];
  /** Removed tracks are never suggested again. */
  blocked: { artist: string; title: string }[];
  lastAppliedAt: number | null;
}

export interface SwapEntry {
  track: Track;
  reason: string;
}

export interface PendingSwap {
  mixId: MixId;
  createdAt: number;
  remove: SwapEntry[];
  add: SwapEntry[];
  /** Picks Claude made vs. how many were found on Spotify. */
  picked: number;
  found: number;
  /** Claude picks that couldn't be found on Spotify. */
  missing: Pick[];
}

export interface Snapshot {
  takenAt: number;
  tracks: Track[];
}

export const MIX_SIZE = 25;

export const SWAP_PCT: Record<MixId, { tweak: number; renew: number }> = {
  driving: { tweak: 30, renew: 70 },
  working: { tweak: 15, renew: 50 },
  cooking: { tweak: 35, renew: 80 },
  home: { tweak: 25, renew: 60 },
};

const DEFAULTS: Omit<Mix, "playlistId" | "locked" | "blocked" | "lastAppliedAt">[] = [
  {
    id: "driving",
    name: "Driving",
    playlistName: "Studio Driving",
    mode: "tweak",
    note: "",
    tune: { mood: 4, tempo: 4, energy: 4, fresh: 3, vocals: 4 },
  },
  {
    id: "working",
    name: "Working",
    playlistName: "Studio Working",
    mode: "keep",
    note: "",
    tune: { mood: 3, tempo: 2, energy: 2, fresh: 2, vocals: 1 },
  },
  {
    id: "cooking",
    name: "Cooking",
    playlistName: "Studio Cooking",
    mode: "renew",
    note: "",
    tune: { mood: 4, tempo: 3, energy: 3, fresh: 3, vocals: 4 },
  },
  {
    id: "home",
    name: "At home",
    playlistName: "Studio Home",
    mode: "tweak",
    note: "",
    tune: { mood: 3, tempo: 2, energy: 2, fresh: 3, vocals: 3 },
  },
];

export function defaultMixes(): Mix[] {
  return DEFAULTS.map((d) => ({ ...d, playlistId: null, locked: [], blocked: [], lastAppliedAt: null }));
}

export async function loadMixes(): Promise<Mix[]> {
  return (await store.get<Mix[]>("mixes")) ?? defaultMixes();
}

export async function saveMixes(mixes: Mix[]): Promise<void> {
  await store.set("mixes", mixes);
}

export async function loadPending(mixId: MixId): Promise<PendingSwap | null> {
  return (await store.get<PendingSwap>(`pending:${mixId}`)) ?? null;
}

export async function savePending(swap: PendingSwap): Promise<void> {
  await store.set(`pending:${swap.mixId}`, swap);
}

export async function clearPending(mixId: MixId): Promise<void> {
  await store.remove(`pending:${mixId}`);
}

const MAX_SNAPSHOTS = 10;

export async function pushSnapshot(mixId: MixId, tracks: Track[]): Promise<void> {
  const list = (await store.get<Snapshot[]>(`snapshots:${mixId}`)) ?? [];
  list.unshift({ takenAt: Date.now(), tracks });
  await store.set(`snapshots:${mixId}`, list.slice(0, MAX_SNAPSHOTS));
}

export async function loadSnapshots(mixId: MixId): Promise<Snapshot[]> {
  return (await store.get<Snapshot[]>(`snapshots:${mixId}`)) ?? [];
}
