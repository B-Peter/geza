// Géza, the cyberpunk sidekick: a 20 x 24 pixel sprite drawn for a dark neon
// panel, built from layers so each level adds gear like an RPG hero. The same
// drawing as the design canvas (generated from one source).

export interface Level {
  n: number;
  name: string;
  /** XP needed to reach this level. */
  from: number;
  look: string;
}

export const LEVELS: Level[] = [
  {
    n: 1,
    name: "Street Kid",
    from: 0,
    look: "Grey hoodie, cheap cyan earbuds, messy hair. Big ears, small data.",
  },
  { n: 2, name: "Netrunner", from: 25, look: "Black jacket with cyan trim and an LED headband." },
  {
    n: 3,
    name: "Signal Hacker",
    from: 100,
    look: "Glowing cyber-eye, LED headphones round the neck, circuit-line jacket.",
  },
  {
    n: 4,
    name: "Neon DJ",
    from: 300,
    look: "Pink mohawk, cyan visor, headphones on, glowing EQ on techwear.",
  },
  {
    n: 5,
    name: "Synth Legend",
    from: 750,
    look: "Chrome headphones and cyber-arm, neon coat and cape, halo, glowing moustache.",
  },
];

const C = {
  line: "#05060C",
  skin: "#E9B08F",
  skinD: "#C98A6C",
  blush: "#FF6FA8",
  hair: "#1B1622",
  cyan: "#2EF2FF",
  cyanD: "#12A9C2",
  magenta: "#FF2E88",
  purple: "#7B3FF2",
  yellow: "#FFE14D",
  hoodie: "#4A4E6E",
  hoodieD: "#363A57",
  jacket: "#1C1E33",
  tech: "#121426",
  coat: "#2A1E4F",
  chrome: "#B8C2D6",
  chromeD: "#7D879C",
  pants: "#262A44",
  shoe: "#0B0C16",
  mouth: "#9C3E52",
  tee: "#2B2F4A",
};

export const W = 20;
export const H = 24;

/** Pixels that glow (no dark outline drawn against them). */
export const GLOW = new Set<string>([C.cyan, C.magenta, C.yellow, C.purple]);

export type Grid = (string | null)[][];

/** The sprite for level n (1–5): grid[y][x] is a colour or null. */
export function sprite(n: number): Grid {
  const g: Grid = Array.from({ length: H }, () => Array<string | null>(W).fill(null));
  const px = (x: number, y: number, c: string) => {
    const row = g[y];
    if (row && x >= 0 && x < W) row[x] = c;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(x, y, c);
  };

  // Level 5: neon cape behind, halo ring above.
  if (n === 5) {
    rect(2, 13, 2, 21, C.magenta);
    rect(17, 13, 17, 21, C.magenta);
    rect(1, 16, 1, 22, C.magenta);
    rect(18, 16, 18, 22, C.magenta);
    rect(7, 0, 12, 0, C.cyan);
    px(6, 1, C.cyan);
    px(13, 1, C.cyan);
  }

  // Legs, shoes with a neon sole from level 2.
  rect(7, 21, 8, 22, C.pants);
  rect(11, 21, 12, 22, C.pants);
  rect(6, 23, 8, 23, C.shoe);
  rect(11, 23, 13, 23, C.shoe);
  if (n >= 2) {
    px(6, 23, C.cyan);
    px(13, 23, C.cyan);
  }

  // Torso and arms.
  const torso =
    ({ 1: C.hoodie, 2: C.jacket, 3: C.jacket, 4: C.tech, 5: C.coat } as Record<number, string>)[n] ??
    C.hoodie;
  rect(5, 13, 14, 20, torso);
  rect(3, 14, 4, 19, torso);
  rect(15, 14, 16, 19, torso);
  rect(3, 20, 4, 20, C.skin);
  rect(15, 20, 16, 20, C.skin);
  if (n === 1) {
    rect(5, 13, 14, 13, C.hoodieD);
    rect(9, 15, 10, 18, C.hoodieD);
    px(8, 14, C.chromeD);
    px(11, 14, C.chromeD);
  }
  if (n === 2) {
    rect(9, 13, 10, 20, C.tee);
    rect(8, 13, 8, 20, C.cyan);
    rect(11, 13, 11, 20, C.cyan);
    rect(3, 19, 4, 19, C.cyan);
    rect(15, 19, 16, 19, C.cyan);
  }
  if (n === 3) {
    rect(9, 13, 10, 20, C.tee);
    rect(6, 15, 7, 15, C.magenta);
    px(7, 16, C.magenta);
    rect(7, 17, 8, 17, C.magenta);
    rect(12, 16, 13, 16, C.cyan);
    px(12, 17, C.cyan);
    rect(12, 18, 13, 18, C.cyan);
  }
  if (n === 4) {
    rect(6, 13, 13, 13, C.magenta);
    rect(11, 16, 13, 18, C.line);
    px(11, 18, C.magenta);
    px(12, 17, C.cyan);
    px(12, 18, C.cyan);
    px(13, 18, C.yellow);
    rect(5, 20, 14, 20, C.cyanD);
  }
  if (n === 5) {
    rect(9, 13, 10, 20, C.tee);
    rect(8, 13, 8, 20, C.purple);
    rect(11, 13, 11, 20, C.purple);
    rect(5, 19, 14, 19, C.cyan);
    rect(15, 14, 16, 20, C.chrome);
    px(16, 15, C.chromeD);
    px(15, 17, C.chromeD);
    px(16, 18, C.cyan);
  }

  // Neck, head, ears.
  rect(9, 12, 10, 12, C.skinD);
  rect(5, 4, 14, 11, C.skin);
  rect(6, 3, 13, 3, C.skin);
  rect(4, 7, 4, 8, C.skin);
  rect(15, 7, 15, 8, C.skin);

  // Hair by level.
  if (n <= 3) {
    rect(5, 2, 14, 3, C.hair);
    rect(5, 4, 5, 5, C.hair);
    rect(14, 4, 14, 5, C.hair);
    px(7, 1, C.hair);
    px(11, 1, C.hair);
    px(9, 4, C.hair);
  }
  if (n === 4) {
    rect(5, 3, 6, 4, C.hair);
    rect(13, 3, 14, 4, C.hair);
    rect(8, 0, 11, 3, C.magenta);
    rect(7, 2, 12, 3, C.magenta);
  }
  if (n === 5) {
    rect(5, 2, 14, 3, C.chrome);
    rect(5, 4, 5, 6, C.chrome);
    rect(14, 4, 14, 5, C.chrome);
    px(12, 1, C.chrome);
    px(13, 1, C.chrome);
  }

  // Eyes.
  if (n <= 2) {
    rect(7, 6, 7, 7, C.line);
    rect(12, 6, 12, 7, C.line);
  } else if (n === 3) {
    rect(7, 7, 8, 7, C.line);
    rect(11, 6, 12, 7, C.magenta);
    px(13, 8, C.chromeD);
    px(13, 9, C.chromeD);
  } else {
    rect(5, 6, 14, 7, C.cyan);
    rect(6, 6, 8, 6, "#B8FBFF");
  }
  if (n === 2) rect(5, 4, 14, 4, C.cyan);

  // Cheeks, nose, moustache, mouth.
  px(6, 9, C.blush);
  px(13, 9, C.blush);
  rect(9, 8, 10, 8, C.skinD);
  if (n === 1) rect(8, 9, 11, 9, C.hair);
  else if (n <= 3) rect(7, 9, 12, 9, C.hair);
  else rect(6, 9, 13, 9, C.hair);
  if (n === 5) {
    px(5, 8, C.cyan);
    px(14, 8, C.cyan);
  }
  rect(9, 10, 10, 10, C.mouth);

  if (n === 1) {
    px(4, 8, C.cyan);
    px(15, 8, C.cyan);
  }
  if (n === 3) {
    rect(7, 12, 12, 12, C.jacket);
    rect(4, 11, 6, 13, C.chromeD);
    rect(13, 11, 15, 13, C.chromeD);
    px(5, 12, C.cyan);
    px(14, 12, C.cyan);
  }
  if (n >= 4) {
    const band = n === 5 ? C.chrome : C.tech;
    const cup = n === 5 ? C.chromeD : C.jacket;
    const led = n === 5 ? C.cyan : C.magenta;
    rect(5, 1, 14, 1, band);
    if (n === 4) rect(8, 1, 11, 1, C.magenta);
    px(4, 2, band);
    px(15, 2, band);
    rect(3, 3, 3, 5, band);
    rect(16, 3, 16, 5, band);
    rect(2, 6, 4, 9, cup);
    rect(15, 6, 17, 9, cup);
    rect(3, 7, 3, 8, led);
    rect(16, 7, 16, 8, led);
  }
  const sparks: [number, number, string][] =
    n === 5
      ? [
          [0, 4, C.cyan],
          [1, 5, C.magenta],
          [19, 9, C.cyan],
          [18, 10, C.magenta],
          [0, 12, C.yellow],
          [19, 3, C.yellow],
        ]
      : [];
  for (const [x, y, c] of sparks) px(x, y, c);
  const sparkSet = new Set(sparks.map(([x, y]) => `${x},${y}`));

  const out = g.map((row) => row.slice());
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (g[y]?.[x]) continue;
      const neighbours: [number, number][] = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];
      const near = neighbours.some(([a, b]) => {
        const c = g[b]?.[a];
        return c && !sparkSet.has(`${a},${b}`) && !GLOW.has(c) && c !== C.line;
      });
      const row = out[y];
      if (near && row) row[x] = C.line;
    }
  return out;
}
