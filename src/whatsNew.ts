// "Géza was updated": a short note, shown once after a new version is installed.

const SEEN_KEY = "ps.seenVersion";

/**
 * The note for this launch, or null. The first launch ever only records the
 * version (nothing was "updated" for a new install).
 */
export function updateMessage(version: string): string | null {
  let seen: string | null = null;
  try {
    seen = localStorage.getItem(SEEN_KEY);
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    return null;
  }
  if (!seen || seen === version) return null;
  return "Géza was updated.";
}
