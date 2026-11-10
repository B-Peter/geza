// "Géza was updated" message: shown once after a new version is installed.
// Update NEWS with each user-visible release (one short line).

export const NEWS =
  "Train plays the whole deck in one player: tap ▶ once, every swipe moves to the next song. Reconnect Spotify once to allow it.";

const SEEN_KEY = "ps.seenVersion";

/**
 * The message to show for this launch, or null. The first launch ever only
 * records the version (nothing was "updated" for a new install).
 */
export function updateMessage(version: string, news = NEWS): string | null {
  let seen: string | null = null;
  try {
    seen = localStorage.getItem(SEEN_KEY);
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    return null;
  }
  if (!seen || seen === version) return null;
  return `Géza was updated (version ${version}). ${news}`;
}
