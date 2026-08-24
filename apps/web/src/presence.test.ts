import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCompanionPresence } from "./presence";

describe("companion presence", () => {
  test("requires a recent authenticated heartbeat", async () => {
    const root = await mkdtemp(join(tmpdir(), "fairth-presence-"));
    try {
      const presence = createCompanionPresence(root);
      expect(await presence.isRecent("companion-token")).toBe(false);
      await presence.touch("companion-token");
      expect(await presence.isRecent("companion-token")).toBe(true);
      expect(await presence.isRecent("companion-token", Date.now() + 61 * 60 * 1_000)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
