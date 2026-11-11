/**
 * Lowercase, strip accents and punctuation, collapse spaces. Letters and
 * digits of every script are kept: a name in Cyrillic, Japanese or Arabic
 * must not come out empty, or all such names would look like the same one.
 */
export const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Title without version suffixes like " - Remastered 2011" or " (Live)". */
export const baseTitle = (title: string): string =>
  normalize(title.replace(/\s+[-–]\s+.*$/, "").replace(/\s*[([].*?[)\]]/g, ""));

/** Identity of a song independent of Spotify IDs (re-releases, remasters). */
export const songKey = (artist: string, title: string): string =>
  `${normalize(artist.split(",")[0] ?? artist)}|${baseTitle(title)}`;
