import { describe, expect, it } from "vitest";
import { testAndSaveKey } from "../src/claude.js";

describe("testAndSaveKey", () => {
  it("rejects admin keys before any network call", async () => {
    await expect(testAndSaveKey("sk-ant-admin01-abc")).rejects.toThrow(/admin key/);
  });
  it("rejects strings that aren't API keys", async () => {
    await expect(testAndSaveKey("hello")).rejects.toThrow(/doesn't look like/);
  });
});
