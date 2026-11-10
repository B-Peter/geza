import { expect, test } from "./fixtures.js";

// Runs against the production build (vite preview). The strict CSP exists
// only there, so these are the tests that catch a CSP regression: an inline
// style, a new script origin, a forgotten API host.

const CONNECT =
  "connect-src 'self' https://accounts.spotify.com https://api.spotify.com https://api.anthropic.com https://musicbrainz.org";

for (const path of ["./", "./spike.html"]) {
  test(`prod: ${path} loads under the CSP with no console errors`, async ({ page, errors }) => {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain(CONNECT);
    expect(csp).toContain("object-src 'none'");
    expect(errors, "console errors").toEqual([]);
  });
}

test("prod: the CSP really blocks connections to other origins", async ({ page }) => {
  await page.goto("./");
  // Independent of the test's own network mocks: the browser raises a CSP
  // violation before any request is made.
  const blocked = await page.evaluate(async () => {
    const violation = new Promise<string>((resolve) =>
      document.addEventListener("securitypolicyviolation", (e) => resolve(e.blockedURI), { once: true }),
    );
    await fetch("https://example.com/").catch(() => undefined);
    return Promise.race([violation, new Promise<string>((r) => setTimeout(() => r("no violation"), 2000))]);
  });
  expect(blocked).toContain("example.com");
});

test("prod: no source maps are published", async ({ page }) => {
  const html = await (await page.request.get("./")).text();
  const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1] ?? "");
  expect(scripts.length).toBeGreaterThan(0);
  for (const src of scripts) {
    const js = await (await page.request.get(src)).text();
    expect(js, src).not.toMatch(/sourceMappingURL=/);
  }
});
