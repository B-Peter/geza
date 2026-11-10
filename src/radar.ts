// The five-axis "spider graph": axes, words for each level, presets, and the
// geometry for drawing it and turning a tap into an axis + level.

import type { Tune } from "./claude.js";

export type AxisKey = keyof Tune;

export interface Axis {
  key: AxisKey;
  label: string;
  /** What levels 1..5 mean, low to high. */
  words: [string, string, string, string, string];
}

export const AXES: Axis[] = [
  { key: "mood", label: "Mood", words: ["Gloomy", "Mellow", "Neutral", "Bright", "Euphoric"] },
  { key: "tempo", label: "Tempo", words: ["Crawl", "Easy", "Medium", "Brisk", "Racing"] },
  { key: "energy", label: "Energy", words: ["Calm", "Soft", "Steady", "Driven", "Intense"] },
  { key: "fresh", label: "Fresh", words: ["Known", "Familiar", "Mixed", "Newer", "Unheard"] },
  { key: "vocals", label: "Vocals", words: ["Instrumental", "Sparse", "Balanced", "Vocal", "Singalong"] },
];

export const PRESETS: { name: string; tune: Tune }[] = [
  { name: "Driving", tune: { mood: 4, tempo: 4, energy: 4, fresh: 3, vocals: 4 } },
  { name: "Focus", tune: { mood: 3, tempo: 2, energy: 2, fresh: 2, vocals: 1 } },
  { name: "Cooking", tune: { mood: 4, tempo: 3, energy: 3, fresh: 3, vocals: 4 } },
  { name: "Wind down", tune: { mood: 2, tempo: 1, energy: 1, fresh: 2, vocals: 3 } },
];

/** Drawing space (SVG viewBox units); the graph scales to its container. */
export const VIEW = { width: 350, height: 330, cx: 175, cy: 170, r: 94 } as const;

/** How far out the axis chips sit, as a fraction of the radius (clear of level 5). */
export const CHIP_DISTANCE = 1.48;

export const clampLevel = (n: number): number => Math.min(5, Math.max(1, Math.round(n)));

/** Angle of axis i: the first axis points straight up, then clockwise. */
const angle = (i: number) => ((-90 + 72 * i) * Math.PI) / 180;

/** Point at `fraction` (0..1) of the radius along axis i. */
export function point(i: number, fraction: number): [number, number] {
  const a = angle(i);
  return [VIEW.cx + VIEW.r * fraction * Math.cos(a), VIEW.cy + VIEW.r * fraction * Math.sin(a)];
}

/** Where level 1..5 sits on an axis. */
export const levelPoint = (i: number, level: number) => point(i, level / 5);

/** SVG `points` attribute for the shape of a tune. */
export function polygon(tune: Tune): string {
  return AXES.map((a, i) =>
    levelPoint(i, tune[a.key])
      .map((n) => n.toFixed(1))
      .join(","),
  ).join(" ");
}

/**
 * The axis and level nearest a tap at (x, y) in viewBox units, or null when
 * the tap is outside the graph. Taps near the centre count as level 1.
 */
export function pick(x: number, y: number): { axis: AxisKey; level: number } | null {
  const dx = x - VIEW.cx;
  const dy = y - VIEW.cy;
  const dist = Math.hypot(dx, dy);
  if (dist > VIEW.r * 1.2) return null;
  // Nearest axis by angle.
  const tapAngle = Math.atan2(dy, dx);
  let best = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  AXES.forEach((_, i) => {
    const diff = Math.abs(Math.atan2(Math.sin(tapAngle - angle(i)), Math.cos(tapAngle - angle(i))));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  // Level from the distance projected onto that axis.
  const along = dx * Math.cos(angle(best)) + dy * Math.sin(angle(best));
  const axis = AXES[best];
  if (!axis) return null;
  return { axis: axis.key, level: clampLevel((Math.max(0, along) / VIEW.r) * 5) };
}

/** Short summary like "Bright · Brisk · Driven". */
export function describe(tune: Tune): string {
  const [mood, tempo, energy] = AXES;
  if (!mood || !tempo || !energy) return "";
  return [mood, tempo, energy].map((a) => a.words[tune[a.key] - 1]).join(" · ");
}
