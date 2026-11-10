// What Géza says on the Mixes screen: one short line about something he has
// actually learned, or a nudge when he hasn't learned much yet.

import type { TasteProfile } from "../taste.js";
import type { LevelInfo } from "./xp.js";

export function gezaSays(info: LevelInfo, taste: TasteProfile | null): string {
  const t = taste;
  if (t && t.judged >= 3) {
    const liked = t.liked_tags[0];
    const disliked = t.disliked_tags[0];
    if (disliked) return `You drop ${disliked} fast. Noted: fewer of those.`;
    if (liked) return `You light up for ${liked}. Queuing more of it.`;
    const era = t.liked_eras[0];
    if (era) return `The ${era} keep winning you over.`;
    if (t.explicit === "avoid") return "Clean lyrics only. Got it.";
  }
  if (info.xp === 0) return "New here. Swipe a deck in Train and I'll learn your taste fast.";
  if (!info.next) return "I know your taste inside out. Keep the feedback coming.";
  const left = info.next.from - info.xp;
  return `${left} more to ${info.next.name}. Every swipe, play and heart counts.`;
}
