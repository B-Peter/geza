import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the encrypted store (IndexedDB isn't available here).
const secrets = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../src/store.js", () => ({
  getSecret: async (k: string) => secrets.get(k) ?? null,
  setSecret: async (k: string, v: unknown) => {
    secrets.set(k, v);
  },
  deleteSecret: async (k: string) => {
    secrets.delete(k);
  },
  get: async () => undefined,
  set: async () => {},
  remove: async () => {},
  requestPersistence: async () => false,
}));
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });

import { api, SessionExpiredError } from "../src/spotify.js";

interface Call {
  url: string;
  auth: string | null;
}
let calls: Call[] = [];

function stubFetch(handler: (c: Call) => Response) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string, init?: RequestInit) => {
      const call = { url: String(input), auth: new Headers(init?.headers).get("Authorization") };
      calls.push(call);
      return handler(call);
    }),
  );
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const isTokenCall = (c: Call) => c.url.startsWith("https://accounts.spotify.com/");
const freshTokens = () => json({ access_token: "new", refresh_token: "r2", expires_in: 3600 });
const stored = (msUntilExpiry: number) => ({
  access_token: "old",
  refresh_token: "r1",
  expires_at: Date.now() + msUntilExpiry,
});

beforeEach(() => secrets.clear());

describe("spotify api()", () => {
  it("retries once after a 429, honouring Retry-After", async () => {
    secrets.set("spotifyTokens", stored(3_600_000));
    let n = 0;
    stubFetch(() => (n++ === 0 ? json({}, 429, { "Retry-After": "0" }) : json({ id: "me" })));
    await expect(api("/me")).resolves.toEqual({ id: "me" });
    expect(calls).toHaveLength(2);
  });

  it("does not wait out a long Retry-After", async () => {
    secrets.set("spotifyTokens", stored(3_600_000));
    stubFetch(() => json({}, 429, { "Retry-After": "120" }));
    await expect(api("/me")).rejects.toThrow(/rate limited, try again in 2 min/);
    expect(calls).toHaveLength(1);
  });

  it("refreshes once on a 401 and retries with the new token", async () => {
    secrets.set("spotifyTokens", stored(3_600_000));
    stubFetch((c) => {
      if (isTokenCall(c)) return freshTokens();
      return c.auth === "Bearer new" ? json({ id: "me" }) : json({ error: { message: "expired" } }, 401);
    });
    await expect(api("/me")).resolves.toEqual({ id: "me" });
    expect(calls.map((c) => c.auth)).toEqual(["Bearer old", null, "Bearer new"]);
    expect((secrets.get("spotifyTokens") as { refresh_token: string }).refresh_token).toBe("r2");
  });

  it("gives up after one 401 retry", async () => {
    secrets.set("spotifyTokens", stored(3_600_000));
    stubFetch((c) => (isTokenCall(c) ? freshTokens() : json({ error: { message: "nope" } }, 401)));
    await expect(api("/me")).rejects.toThrow(/Spotify 401/);
    expect(calls.filter((c) => !isTokenCall(c))).toHaveLength(2);
  });

  it("logs out when the refresh token is rejected", async () => {
    secrets.set("spotifyTokens", stored(0));
    stubFetch(() => json({ error: "invalid_grant", error_description: "Refresh token revoked" }, 400));
    await expect(api("/me")).rejects.toBeInstanceOf(SessionExpiredError);
    expect(secrets.has("spotifyTokens")).toBe(false);
  });

  it("shares one refresh between parallel requests", async () => {
    secrets.set("spotifyTokens", stored(0));
    stubFetch((c) => (isTokenCall(c) ? freshTokens() : json({ ok: true })));
    await Promise.all([api("/a"), api("/b"), api("/c")]);
    expect(calls.filter(isTokenCall)).toHaveLength(1);
    expect(calls.filter((c) => c.auth === "Bearer new")).toHaveLength(3);
  });
});
