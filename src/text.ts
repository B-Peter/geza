/** Lowercase, strip accents and punctuation, collapse spaces. */
export const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Title without version suffixes like " - Remastered 2011" or " (Live)". */
export const baseTitle = (title: string): string =>
  normalize(title.replace(/\s+[-–]\s+.*$/, "").replace(/\s*[([].*?[)\]]/g, ""));

/** Identity of a song independent of Spotify IDs (re-releases, remasters). */
export const songKey = (artist: string, title: string): string =>
  `${normalize(artist.split(",")[0] ?? artist)}|${baseTitle(title)}`;
