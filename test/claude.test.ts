import { describe, expect, it } from "vitest";
import { cleanKey, ObjectScanner, request, testAndSaveKey } from "../src/claude.js";

describe("cleanKey", () => {
  it("removes invisible characters, spaces and quotes a paste can add", () => {
    expect(cleanKey("​ sk-ant-api03-abc \n")).toBe("sk-ant-api03-abc");
    expect(cleanKey('"sk-ant-api03-abc"')).toBe("sk-ant-api03-abc");
    expect(cleanKey("﻿sk-ant-xyz")).toBe("sk-ant-xyz");
  });
});

describe("testAndSaveKey", () => {
  it("rejects admin keys before any network call", async () => {
    await expect(testAndSaveKey("sk-ant-admin01-abcdefghijklmnop")).rejects.toThrow(/admin key/);
  });
  it("rejects strings that can't be keys", async () => {
    await expect(testAndSaveKey("hello")).rejects.toThrow(/doesn't look like/);
    await expect(testAndSaveKey("sk-ant-api03 with spaces inside it")).rejects.toThrow(/doesn't look like/);
  });
});

describe("ObjectScanner", () => {
  it("hands over each inner object as soon as its text is complete", () => {
    const scanner = new ObjectScanner();
    expect(scanner.push('{"artists":[{"artist":"A","tags":["x"')).toEqual([]);
    expect(scanner.push(']},{"artist":"B')).toEqual(['{"artist":"A","tags":["x"]}']);
    expect(scanner.push('","tags":[]}]}')).toEqual(['{"artist":"B","tags":[]}']);
  });
  it("isn't fooled by braces and quotes inside strings", () => {
    const scanner = new ObjectScanner();
    // The artist is: The {Odd} "Ones" \  (escaped quotes, and a backslash right before the closing quote)
    const item = JSON.stringify({ artist: 'The {Odd} "Ones" \\', reason: "a } b" });
    const found = [
      ...scanner.push(`{"artists":[${item.slice(0, 20)}`),
      ...scanner.push(`${item.slice(20)}]}`),
    ];
    expect(found).toEqual([item]);
  });
});

describe("request", () => {
  it("skips thinking where the wait matters (decks, random), keeps it for mix swaps", () => {
    expect(request("s", {}, {}, "low").thinking).toEqual({ type: "disabled" });
    expect(request("s", {}, {}, "medium").thinking).toEqual({ type: "adaptive" });
  });
});
