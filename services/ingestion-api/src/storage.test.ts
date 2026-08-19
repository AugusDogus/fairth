import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createUploadStorage } from "./storage.js";

describe("upload storage", () => {
  test("resumes chunks and atomically publishes their assembled content", async () => {
    const root = await mkdtemp(join(tmpdir(), "fairth-upload-"));
    try {
      const storage = createUploadStorage({
        host: "127.0.0.1", port: 1, incomingRoot: root, authDataRoot: root, publicBaseUrl: "http://127.0.0.1:3000",
        maxUploadBytes: 100, chunkBytes: 4,
      });
      await storage.initialize();
      const session = await storage.createSession({ filename: "hello world.jpg", size: 11, metadata: {} });
      await storage.putChunk(session.id, 0, Readable.from("hell"), 4);
      await storage.putChunk(session.id, 1, Readable.from("o wo"), 4);
      expect((await storage.getSession(session.id)).receivedChunks).toEqual([0, 1]);
      await storage.putChunk(session.id, 2, Readable.from("rld"), 3);
      const completed = await storage.completeSession(session.id);
      expect(completed.sha256).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
      expect(await readFile(join(root, "ready", completed.filename), "utf8")).toBe("hello world");
      expect((await readdir(join(root, "ready"))).sort()).toEqual([completed.filename, `${completed.filename}.upload.json`].sort());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
