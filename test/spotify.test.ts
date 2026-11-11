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

import { api, findTrack, matchTrack, SessionExpiredError } from "../src/spotify.js";

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

describe("missingScopes", () => {
  it("lists permissions the stored login doesn't have", async () => {
    const { missingScopes, REQUIRED_SCOPES } = await import("../src/spotify.js");
    secrets.set("spotifyTokens", { ...stored(3_600_000), scope: "user-read-private user-top-read" });
    const missing = await missingScopes();
    expect(missing).toContain("user-library-read");
    expect(missing).not.toContain("user-top-read");
    expect(missing).not.toContain("user-read-private");
    secrets.set("spotifyTokens", { ...stored(3_600_000), scope: REQUIRED_SCOPES.join(" ") });
    expect(await missingScopes()).toEqual([]);
  });

  it("treats a login without recorded permissions as missing all of them", async () => {
    const { missingScopes, REQUIRED_SCOPES } = await import("../src/spotify.js");
    secrets.set("spotifyTokens", stored(3_600_000));
    expect(await missingScopes()).toEqual(REQUIRED_SCOPES);
  });
});

describe("findTrack", () => {
  const t = (id: string, artist: string, name: string) => ({
    id,
    uri: `spotify:track:${id}`,
    name,
    artists: [{ name: artist }],
  });
  const q = (c: Call) => decodeURIComponent(new URL(c.url).searchParams.get("q") ?? "");

  it("takes the fielded search when the artist matches", async () => {
    secrets.set("spotifyTokens", stored(3_600_000));
    stubFetch(() =>
      json({ tracks: { items: [t("a", "Someone Else", "Blue Hour"), t("b", "Sundial", "Blue Hour")] } }),
    );
    const found = await findTrack("Sundial", "Blue Hour");
    expect(found?.id).toBe("b");
    expect(calls).toHaveLength(1);
  });

  it("falls back to a plain query when the fielded one finds nothing", async () => {
    secrets.set("spotifyTokens", stored(3_600_000));
    stubFetch((c) =>
      q(c).startsWith("track:")
        ? json({ tracks: { items: [] } })
        : json({ tracks: { items: [t("x", "Sundial", "Don't Stop Now - Remastered 2011")] } }),
    );
    const found = await findTrack("Sundial", "Don’t Stop Now (Single Version)");
    expect(found?.id).toBe("x");
    expect(calls).toHaveLength(2);
    expect(q(calls[1] as Call)).toBe("Don’t Stop Now Sundial");
  });

  it("ignores a plain-search hit with a different title or artist", async () => {
    secrets.set("spotifyTokens", stored(3_600_000));
    stubFetch((c) =>
      q(c).startsWith("track:")
        ? json({ tracks: { items: [] } })
        : json({ tracks: { items: [t("y", "Sundial", "Another Song"), t("z", "Cover Band", "Blue Hour")] } }),
    );
    await expect(findTrack("Sundial", "Blue Hour")).resolves.toBeNull();
  });

  it("prefers the track whose title matches over one by the artist with another title", () => {
    const items = [t("1", "Sundial", "Blue Hour (Live)"), t("2", "Sundial", "Blue Hour")];
    expect(matchTrack(items as never, "Sundial", "Blue Hour")?.id).toBe("2");
  });
});

describe("nameWithin", () => {
  it("matches whole words only", async () => {
    const { nameWithin } = await import("../src/spotify.js");
    expect(nameWithin("the national", "national")).toBe(true);
    expect(nameWithin("yellow days", "low")).toBe(false);
    expect(nameWithin("", "low")).toBe(false);
  });
});
