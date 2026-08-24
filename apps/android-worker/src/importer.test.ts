import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "./config.js";
import { createImportDatabase } from "./database.js";
import { createImporter, type ImporterState } from "./importer.js";

describe("media importer", () => {
  test("moves unchanged bytes into Android using the original name and capture time", async () => {
    const root = await mkdtemp(join(tmpdir(), "fairth-importer-"));
    const incomingRoot = join(root, "incoming");
    const dataDirectory = join(root, "data");
    const ready = join(incomingRoot, "ready");
    await mkdir(ready, { recursive: true });
    await mkdir(dataDirectory, { recursive: true });
    const sourcePath = join(ready, "server-generated-name.jpg");
    const bytes = Buffer.from("unchanged camera bytes");
    await writeFile(sourcePath, bytes);
    const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    await writeFile(`${sourcePath}.upload.json`, JSON.stringify({
      originalFilename: "IMG_20200102_030405.jpg",
      sha256: digest,
      metadata: { capturedAt: "2020-01-02T03:04:05.678Z", deviceId: "pixel" },
    }));
    const config: Config = {
      adbEndpoint: "127.0.0.1:5555",
      androidMediaDirectory: "/storage/emulated/0/DCIM/Camera",
      googlePhotosPackage: "com.google.android.apps.photos",
      healthPort: 1,
      dataDirectory,
      incomingRoot,
      pollIntervalMs: 1,
      provisioningStateDirectory: join(root, "provisioning"),
      stableForMs: 1,
      maxRetries: 2,
    };
    const database = createImportDatabase(dataDirectory);
    const state: ImporterState = { running: false };
    const calls: Array<Readonly<{ filename: string; capturedAtMs: number; sha256: string; bytes: Buffer }>> = [];
    const importer = createImporter(config, database, {
      importMedia: async (path, filename, capturedAtMs, expectedSha256) => {
        calls.push({ filename, capturedAtMs, sha256: expectedSha256, bytes: await readFile(path) });
        return { ok: true, stdout: "indexed", stderr: "" };
      },
    }, state);

    try {
      await importer.cycle();
      await Bun.sleep(2);
      await importer.cycle();

      expect(calls).toEqual([{
        filename: "IMG_20200102_030405.jpg",
        capturedAtMs: 1_577_934_245_678,
        sha256: digest,
        bytes,
      }]);
      expect(database.counts()).toEqual({ pending: 0, imported: 1, failed: 0, duplicate: 0 });
      const archiveDates = await readdir(join(incomingRoot, "archive"));
      const archived = await readdir(join(incomingRoot, "archive", archiveDates[0] ?? "missing"));
      const archivedMedia = archived.find((name) => !name.endsWith(".upload.json"));
      expect(archivedMedia).toBeDefined();
      if (archivedMedia !== undefined) {
        expect(await readFile(join(incomingRoot, "archive", archiveDates[0] ?? "missing", archivedMedia))).toEqual(bytes);
      }
    } finally {
      database.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
