// Saves a fresh screenshot of every screen to screenshots/ for review,
// without touching the approved baselines.

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const dir = "screenshots";
mkdirSync(dir, { recursive: true });
const result = spawnSync("npx", ["playwright", "test", "--update-snapshots=none", "--grep", "^dd "], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, SHOTS_DIR: dir },
});
console.log(`\nScreenshots in ${dir}/`);
process.exit(result.status ?? 1);
