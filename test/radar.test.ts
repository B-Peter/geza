import { expect, describe as group, it } from "vitest";
import {
  AXES,
  CHIP_DISTANCE,
  clampLevel,
  describe,
  levelPoint,
  pick,
  point,
  polygon,
  VIEW,
} from "../src/radar.js";

const tune = { mood: 4, tempo: 3, energy: 4, fresh: 4, vocals: 3 };

group("radar geometry", () => {
  it("puts the first axis straight up", () => {
    const [x, y] = levelPoint(0, 5);
    expect(x).toBeCloseTo(VIEW.cx);
    expect(y).toBeCloseTo(VIEW.cy - VIEW.r);
  });

  it("turns a tap on each level dot back into that axis and level", () => {
    AXES.forEach((axis, i) => {
      for (let level = 1; level <= 5; level++) {
        const [x, y] = levelPoint(i, level);
        expect(pick(x, y)).toEqual({ axis: axis.key, level });
      }
    });
  });

  it("tolerates imprecise taps and snaps to the nearest level", () => {
    const [x, y] = levelPoint(1, 3);
    expect(pick(x + 6, y - 5)).toEqual({ axis: "tempo", level: 3 });
  });

  it("ignores taps outside the graph and treats the centre as level 1", () => {
    expect(pick(0, 0)).toBeNull();
    expect(pick(VIEW.cx, VIEW.cy)?.level).toBe(1);
  });

  it("clamps levels to 1..5", () => {
    expect(clampLevel(0)).toBe(1);
    expect(clampLevel(7)).toBe(5);
    expect(clampLevel(2.6)).toBe(3);
  });

  it("draws one point per axis and summarises mood, tempo and energy", () => {
    expect(polygon(tune).split(" ")).toHaveLength(5);
    expect(describe(tune)).toBe("Bright · Medium · Driven");
  });
});

group("radar chip positions", () => {
  it("match the CSS classes in Radar.svelte", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/ui/Radar.svelte", "utf8");
    AXES.forEach((_, i) => {
      const [x, y] = point(i, CHIP_DISTANCE);
      const left = ((x / VIEW.width) * 100).toFixed(2);
      const top = ((y / VIEW.height) * 100).toFixed(2);
      const rule = new RegExp(String.raw`\.axis-${i} \{ left: ([\d.]+)%; top: ([\d.]+)%; \}`).exec(css);
      expect(rule, `.axis-${i}`).not.toBeNull();
      expect(Number(rule?.[1]).toFixed(2)).toBe(left);
      expect(Number(rule?.[2]).toFixed(2)).toBe(top);
    });
  });
});
