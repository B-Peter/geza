// Bundles src/main.js into dist/app.js and copies public/ into dist/.
//   node scripts/build.mjs          production build
//   node scripts/build.mjs --serve  dev server on http://127.0.0.1:8080/

import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const serve = process.argv.includes("--serve");
const outdir = "dist";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await cp("public", outdir, { recursive: true });

// Give each build its own service-worker cache name.
const buildId = Date.now().toString(36);
const swPath = `${outdir}/sw.js`;
await writeFile(swPath, (await readFile(swPath, "utf8")).replace("__BUILD_ID__", buildId));

const options = {
  entryPoints: { app: "src/main.js" },
  bundle: true,
  format: "esm",
  target: ["safari16", "chrome120", "firefox120"],
  outdir,
  sourcemap: true,
  minify: !serve,
  legalComments: "linked",
  logLevel: "info",
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  // Spotify allows http only for loopback IPs (not "localhost").
  await ctx.serve({ servedir: outdir, host: "127.0.0.1", port: 8080 });
  console.log("Dev server: http://127.0.0.1:8080/  (register this exact URL as a Spotify redirect URI)");
} else {
  await esbuild.build(options);
}
