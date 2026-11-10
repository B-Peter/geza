// App-wide state (Svelte 5 runes) and the hash router.

import * as claude from "./claude.js";
import { loadMixes, loadPending, type Mix, type MixId, type PendingSwap, saveMixes } from "./mixes.js";
import * as spotify from "./spotify.js";
import { type Profile, SessionExpiredError } from "./spotify.js";

export type Route =
  | { name: "mixes" }
  | { name: "mix"; id: MixId }
  | { name: "review"; id: MixId }
  | { name: "settings" }
  | { name: "random" }
  | { name: "key" };

const MIX_IDS: MixId[] = ["driving", "working", "cooking", "home"];

function parseRoute(hash: string): Route {
  const [, name, id] = hash.replace(/^#/, "").split("/");
  const mixId = MIX_IDS.find((m) => m === id);
  if (name === "mix" && mixId) return { name: "mix", id: mixId };
  if (name === "review" && mixId) return { name: "review", id: mixId };
  if (name === "settings") return { name: "settings" };
  if (name === "random") return { name: "random" };
  if (name === "key") return { name: "key" };
  return { name: "mixes" };
}

export function go(path: string): void {
  location.hash = path;
}

export interface Toast {
  text: string;
  kind: "error" | "ok";
}

class AppState {
  ready = $state(false);
  loggedIn = $state(false);
  hasKey = $state(false);
  profile = $state<Profile | null>(null);
  mixes = $state<Mix[]>([]);
  pending = $state<Partial<Record<MixId, PendingSwap>>>({});
  route = $state<Route>(parseRoute(location.hash));
  toast = $state<Toast | null>(null);
  /** Progress message while a long task runs; null when idle. */
  busy = $state<string | null>(null);

  needsPlaylists = $derived(this.mixes.some((m) => !m.playlistId));

  constructor() {
    addEventListener("hashchange", () => {
      this.route = parseRoute(location.hash);
      scrollTo(0, 0);
    });
  }

  async init(): Promise<void> {
    try {
      await spotify.handleRedirect();
    } catch (e) {
      this.notify(e);
    }
    this.loggedIn = await spotify.isLoggedIn();
    this.hasKey = await claude.hasKey();
    this.mixes = await loadMixes();
    for (const id of MIX_IDS) {
      const swap = await loadPending(id);
      if (swap) this.pending[id] = swap;
    }
    if (this.loggedIn) {
      try {
        this.profile = await spotify.getProfile();
      } catch (e) {
        this.notify(e);
      }
    }
    this.ready = true;
  }

  mix(id: MixId): Mix {
    const mix = this.mixes.find((m) => m.id === id);
    if (!mix) throw new Error(`Unknown mix ${id}`);
    return mix;
  }

  async setMixes(mixes: Mix[]): Promise<void> {
    this.mixes = mixes;
    // IndexedDB can't store Svelte's reactive proxies; save a plain copy.
    await saveMixes($state.snapshot(this.mixes) as Mix[]);
  }

  async updateMix(id: MixId, patch: Partial<Mix>): Promise<void> {
    await this.setMixes(this.mixes.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  notify(message: unknown, kind: Toast["kind"] = "error"): void {
    if (message instanceof SessionExpiredError) {
      // Tokens are already deleted; show Welcome so the user can log in again.
      this.loggedIn = false;
      this.profile = null;
      go("/");
    }
    const text = message instanceof Error ? message.message : String(message);
    this.toast = { text, kind };
    const current = this.toast;
    setTimeout(
      () => {
        if (this.toast === current) this.toast = null;
      },
      kind === "error" ? 8000 : 3000,
    );
  }

  /** Run a long task with a progress message; errors become a toast. */
  async task<T>(label: string, fn: (progress: (m: string) => void) => Promise<T>): Promise<T | undefined> {
    if (this.busy) return undefined;
    this.busy = label;
    try {
      return await fn((m) => {
        this.busy = m;
      });
    } catch (e) {
      this.notify(e);
      return undefined;
    } finally {
      this.busy = null;
    }
  }
}

export const app = new AppState();
