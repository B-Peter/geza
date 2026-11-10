// Claude curator, called directly from the browser with the user's own key.

import Anthropic from "@anthropic-ai/sdk";
import { deleteSecret, getSecret, setSecret } from "./store.js";

// Haiku: fast and low-cost, enough for picking a handful of songs.
export const MODEL = "claude-haiku-5-5";
const KEY_SECRET = "anthropicKey";

function client(apiKey: string): Anthropic {
  // The user's own key, kept encrypted on this device. dangerouslyAllowBrowser
  // sends the direct-browser-access header the API requires for CORS.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

export async function hasKey(): Promise<boolean> {
  return Boolean(await getSecret<string>(KEY_SECRET));
}

export async function maskedKey(): Promise<string | null> {
  const key = await getSecret<string>(KEY_SECRET);
  return key ? `${key.slice(0, 7)}…${key.slice(-4)}` : null;
}

export async function removeKey(): Promise<void> {
  await deleteSecret(KEY_SECRET);
}

/**
 * What a paste really contains: phones and password managers can add
 * zero-width characters, non-breaking spaces or surrounding quotes.
 */
export function cleanKey(input: string): string {
  return input
    .replace(/[​-‍⁠﻿ ]/g, "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "");
}

/** Checks the key with a Models API lookup (no tokens spent), then saves it. */
export async function testAndSaveKey(input: string): Promise<void> {
  const apiKey = cleanKey(input);
  // Admin keys can manage the whole Anthropic organization; never keep one in a browser.
  if (apiKey.startsWith("sk-ant-admin"))
    throw new Error("That's an admin key. Create a regular API key just for this app instead.");
  // Only a sanity check; Anthropic decides whether the key is valid (below).
  if (apiKey.length < 20 || /\s/.test(apiKey))
    throw new Error("That doesn't look like an Anthropic API key. Copy it again from the console.");
  try {
    await client(apiKey).models.retrieve(MODEL);
  } catch (e) {
    throw new Error(describeError(e));
  }
  await setSecret(KEY_SECRET, apiKey);
}

export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError)
    return "Your Claude key was rejected. Check it or create a new one.";
  if (e instanceof Anthropic.PermissionDeniedError) return "Your Claude key isn't allowed to use this model.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limited by Anthropic. Try again in a minute.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic. Check the connection.";
  if (e instanceof Anthropic.APIError) {
    if (e.status === 402 || /credit/i.test(e.message)) return "Your Anthropic account is out of credit.";
    return `Anthropic error ${e.status}: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

export const SYSTEM_PROMPT = `You are the music curator for a personal playlist app. You pick songs
for one listener's mix. You do not talk to the listener.

Rules:
- Only suggest real, released songs you are sure exist. If unsure, skip it.
- Return exact artist and title, no remixes or live versions unless the
  listener's history shows they like them.
- Never suggest anything in "blocked" or already in "current".
- Never replace anything in "locked".
- "remove" may only name songs from "current". Remove exactly
  "remove_count" songs and add exactly "add_count" songs.
- Keep the mix's flow: tempo and mood should fit the occasion and the
  Tune settings.
- Of the new picks: 50% familiar territory (artists close to the
  listener's loved tracks), 30% adjacent (same scene or era, new to
  them), 20% wildcard (different genre that still fits the mood).
- At least 30% of new picks should be artists NOT in the listener's top
  artists.
- Max 1 new track per artist per run, max 2 per artist in the mix.
- Wildcards must still match the Tune tempo and energy.
- At most 25% of picks released in the last 3 years.
- If the owner's note conflicts with the history, follow the note.
- If candidates are too few after filtering, return fewer picks, not
  worse ones.
- Give each pick a reason of 12 words or fewer, plain language.
- Output JSON only, matching the schema.

Tune values are 1 to 5 per axis and describe the target for the mix:
mood (1 gloomy, 5 euphoric), tempo (1 crawl, 5 racing), energy (1 calm,
5 intense), fresh (1 known songs, 5 unheard), vocals (1 instrumental,
5 singalong). They are your interpretation targets, not measurements.`;

export interface Pick {
  artist: string;
  title: string;
  reason: string;
}

export interface Picks {
  remove: Pick[];
  add: Pick[];
}

export interface Tune {
  mood: number;
  tempo: number;
  energy: number;
  fresh: number;
  vocals: number;
}

interface SongRef {
  artist: string;
  title: string;
}

export interface CurateInput {
  mix: string;
  mode: "tweak" | "renew";
  remove_count: number;
  add_count: number;
  tune: Tune;
  loved: SongRef[];
  blocked: SongRef[];
  locked: SongRef[];
  current: SongRef[];
  top_artists: string[];
  note: string;
}

const PICK_SCHEMA = {
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
    remove: { type: "array", items: PICK_SCHEMA },
    add: { type: "array", items: PICK_SCHEMA },
  },
  required: ["remove", "add"],
  additionalProperties: false,
};

export async function curate(input: CurateInput): Promise<Picks> {
  const apiKey = await getSecret<string>(KEY_SECRET);
  if (!apiKey) throw new Error("Add your Claude key first.");
  let response: Anthropic.Message;
  try {
    response = await client(apiKey).messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: PICKS_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(input, null, 2) }],
    });
  } catch (e) {
    throw new Error(describeError(e));
  }
  if (response.stop_reason === "refusal") throw new Error("Claude declined this request.");
  if (response.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off. Try again.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let picks: Picks;
  try {
    picks = JSON.parse(text) as Picks;
  } catch {
    throw new Error("Claude returned invalid JSON.");
  }
  if (!Array.isArray(picks?.add) || !Array.isArray(picks?.remove)) {
    throw new Error("Claude's answer didn't match the expected shape.");
  }
  return picks;
}
