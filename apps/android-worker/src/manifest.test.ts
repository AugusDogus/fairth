import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readImportMetadata } from "./manifest.js";

describe("upload manifest", () => {
  test("preserves the camera filename and capture time", async () => {
    const root = await mkdtemp(join(tmpdir(), "fairth-manifest-"));
    try {
      const mediaPath = join(root, "stored-photo.jpg");
      await writeFile(mediaPath, "original bytes");
      await writeFile(`${mediaPath}.upload.json`, JSON.stringify({
        originalFilename: "IMG_20200102_030405.jpg",
        sha256: "abc123",
        metadata: { capturedAt: "2020-01-02T03:04:05.678Z", deviceId: "pixel" },
      }));

      expect(await readImportMetadata(mediaPath, "abc123", 1_700_000_000_000)).toEqual({
        ok: true,
        value: {
          capturedAtMs: 1_577_934_245_678,
          deviceId: "pixel",
          remoteFilename: "IMG_20200102_030405.jpg",
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects a manifest whose digest does not describe the media", async () => {
    const root = await mkdtemp(join(tmpdir(), "fairth-manifest-"));
    try {
      const mediaPath = join(root, "stored-photo.jpg");
      await writeFile(mediaPath, "original bytes");
      await writeFile(`${mediaPath}.upload.json`, JSON.stringify({
        originalFilename: "IMG_1.jpg",
        sha256: "different",
        metadata: { capturedAt: "2020-01-02T03:04:05.678Z" },
      }));

      expect(await readImportMetadata(mediaPath, "actual", 1_700_000_000_000)).toEqual({
        ok: false,
        message: "Upload manifest SHA-256 does not match the received media. The file was not imported.",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses the source filename and modification time for a manual drop", async () => {
    const root = await mkdtemp(join(tmpdir(), "fairth-manifest-"));
    try {
      const mediaPath = join(root, "manual photo.jpg");
      await writeFile(mediaPath, "original bytes");

      expect(await readImportMetadata(mediaPath, "unused", 1_700_000_000_123)).toEqual({
        ok: true,
        value: {
          capturedAtMs: 1_700_000_000_123,
          remoteFilename: "manual_photo.jpg",
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
