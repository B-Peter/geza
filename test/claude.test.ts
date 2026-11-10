import { describe, expect, it } from "vitest";
import { cleanKey, testAndSaveKey } from "../src/claude.js";

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
