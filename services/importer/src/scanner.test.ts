import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStableScanner, sha256 } from "./scanner.js";

describe("stable scanner", () => {
  test("returns supported media only after the stabilization window", async () => {
    const root = await mkdtemp(join(tmpdir(), "fairth-scanner-"));
    try {
      await mkdir(join(root, "drop"));
      await mkdir(join(root, "ready"));
      await writeFile(join(root, "drop", "photo.jpg"), "media");
      await writeFile(join(root, "drop", "note.txt"), "ignore");
      const scanner = createStableScanner({
        adbEndpoint: "android:5555", androidMediaDirectory: "/sdcard/DCIM/Incoming",
        googlePhotosPackage: "photos", healthPort: 1, dataDirectory: root,
        incomingRoot: root, pollIntervalMs: 1, stableForMs: 10, maxRetries: 1,
      });
      expect(await scanner.scan(100)).toHaveLength(0);
      expect(await scanner.scan(111)).toEqual([{ path: join(root, "drop", "photo.jpg"), size: 5 }]);
      expect(await sha256(join(root, "drop", "photo.jpg"))).toBe("721c9525ade2ea8903d343ef25cf68b9bf4ab0aad56bb7b01fbe48d09bc7fcf4");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
