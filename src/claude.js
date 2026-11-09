// Claude curator: called directly from the browser with the user's own key.

import Anthropic from "@anthropic-ai/sdk";
import { getSecret, setSecret, deleteSecret } from "./store.js";

export const MODEL = "claude-opus-5-5";
const KEY_SECRET = "anthropicKey";

function client(apiKey) {
  // The user's own key, kept encrypted on this device. dangerouslyAllowBrowser
  // sends the direct-browser-access header the API requires for CORS.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

export async function hasKey() {
  return Boolean(await getSecret(KEY_SECRET));
}

export async function maskedKey() {
  const key = await getSecret(KEY_SECRET);
  return key ? `${key.slice(0, 7)}…${key.slice(-4)}` : null;
}

export async function removeKey() {
  await deleteSecret(KEY_SECRET);
}

// Checks the key with a Models API lookup (no tokens spent), then saves it.
export async function testAndSaveKey(apiKey) {
  apiKey = apiKey.trim();
  if (!apiKey.startsWith("sk-ant-")) throw new Error("That doesn't look like an Anthropic API key (sk-ant-…).");
  try {
    await client(apiKey).models.retrieve(MODEL);
  } catch (e) {
    throw new Error(describeError(e));
  }
  await setSecret(KEY_SECRET, apiKey);
}

export function describeError(e) {
  if (e instanceof Anthropic.AuthenticationError) return "The key was rejected. Check it or create a new one.";
  if (e instanceof Anthropic.PermissionDeniedError) return "The key isn't allowed to use this model.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limited by Anthropic. Try again in a minute.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic. Check the connection.";
  if (e instanceof Anthropic.APIError) return `Anthropic error ${e.status}: ${e.message}`;
  return e?.message || String(e);
}

export const SYSTEM_PROMPT = `You are the music curator for a personal playlist app. You pick songs
for one listener's mix. You do not talk to the listener.

Rules:
- Only suggest real, released songs you are sure exist. If unsure, skip it.
- Return exact artist and title, no remixes or live versions unless the
  listener's history shows they like them.
- Never suggest anything in "blocked" or already in "current".
- Never replace anything in "locked".
- Aim for about {{swap_pct}}% new tracks. Keep the mix's flow: tempo and
  mood should fit the occasion and the Tune settings.
- Of the new picks: 50% familiar territory (artists close to the
  listener's loved tracks), 30% adjacent (same scene or era, new to
  them), 20% wildcard (different genre that still fits the mood).
- At least 30% of new picks should be artists NOT in the listener's top
  artists.
- Max 1 new track per artist per run, max 2 per artist in the mix.
- Wildcards must still match the Tune tempo and energy.
- At most 25% of picks released in the last 3 years.
- If the Owner's note conflicts with the history, follow the note.
- If candidates are too few after filtering, return fewer picks, not
  worse ones.
- Give each pick a reason of 12 words or fewer, plain language.
- Output JSON only, matching the schema.

Tune values are 1 to 5 per axis and describe the target for the mix:
mood (1 gloomy, 5 euphoric), tempo (1 crawl, 5 racing), energy (1 calm,
5 intense), fresh (1 known songs, 5 unheard), vocals (1 instrumental,
5 singalong). They are your interpretation targets, not measurements.`;

const PICK = {
  type: "object",
  properties: {
    artist: { type: "string" },
    title: { type: "string" },
    reason: { type: "string" },
  },
  required: ["artist", "title", "reason"],
  additionalProperties: false,
};

const PICKS_SCHEMA = {
  type: "object",
  properties: {
    remove: { type: "array", items: PICK },
    add: { type: "array", items: PICK },
  },
  required: ["remove", "add"],
  additionalProperties: false,
};

// input: { mix, mode, swap_pct, picks_wanted, tune, loved, played_in_full,
//          never_played, blocked, locked, current, top_artists, note }
export async function curate(input) {
  const apiKey = await getSecret(KEY_SECRET);
  if (!apiKey) throw new Error("Add your Claude key first.");
  let response;
  try {
    response = await client(apiKey).beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Refusal fallback: if a safety classifier declines, the API re-runs the
      // request on a suitable model inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: PICKS_SCHEMA },
      },
      system: SYSTEM_PROMPT.replace("{{swap_pct}}", String(input.swap_pct)),
      messages: [{ role: "user", content: JSON.stringify(input, null, 2) }],
    });
  } catch (e) {
    throw new Error(describeError(e));
  }
  if (response.stop_reason === "refusal") throw new Error("Claude declined this request.");
  if (response.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off. Try again.");
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  let picks;
  try {
    picks = JSON.parse(text);
  } catch {
    throw new Error("Claude returned invalid JSON.");
  }
  if (!Array.isArray(picks?.add) || !Array.isArray(picks?.remove)) {
    throw new Error("Claude's answer didn't match the expected shape.");
  }
  return { picks, usage: response.usage, model: response.model };
}
