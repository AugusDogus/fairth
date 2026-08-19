import { randomUUID } from "node:crypto";
import { mkdir, rename, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ReturnTypeAdb } from "./types.js";
import type { Config } from "./config.js";
import type { ImportDatabase } from "./database.js";
import { createStableScanner, sha256 } from "./scanner.js";

export type ImporterState = {
  running: boolean;
  lastScanAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
};

function remoteFilename(filename: string, hash: string): string {
  const safe = basename(filename).normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-160);
  return `${hash.slice(0, 12)}-${safe.length > 0 ? safe : "media.bin"}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function archive(config: Config, sourcePath: string): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const directory = join(config.incomingRoot, "archive", date);
  await mkdir(directory, { recursive: true });
  const destination = join(directory, `${Date.now()}-${randomUUID()}-${basename(sourcePath)}`);
  await rename(sourcePath, destination);
  const manifest = `${sourcePath}.upload.json`;
  if (await exists(manifest)) await rename(manifest, `${destination}.upload.json`);
}

function retryDelay(attempts: number): number {
  return Math.min(60 * 60_000, 5_000 * (2 ** Math.min(attempts, 9)));
}

export function createImporter(config: Config, database: ImportDatabase, adb: ReturnTypeAdb, state: ImporterState) {
  const scanner = createStableScanner(config);

  async function cycle(): Promise<void> {
    if (state.running) return;
    state.running = true;
    state.lastScanAt = new Date().toISOString();
    try {
      for (const candidate of await scanner.scan()) {
        const hash = await sha256(candidate.path);
        const existing = database.find(hash);
        if (existing?.status === "imported" || existing?.status === "duplicate") {
          database.duplicate(hash);
          await archive(config, candidate.path);
          scanner.forget(candidate.path);
          console.log(JSON.stringify({ level: "info", event: "duplicate_archived", path: candidate.path, hash }));
          continue;
        }
        if (existing !== undefined && existing.attempts >= config.maxRetries) continue;
        if (existing !== undefined && existing.nextAttemptAt > Date.now()) continue;

        const filename = remoteFilename(candidate.path, hash);
        database.begin(hash, candidate.path, filename);
        const attempt = (database.find(hash)?.attempts ?? 1);
        const result = await adb.importMedia(candidate.path, filename);
        if (result.ok) {
          database.success(hash);
          await archive(config, candidate.path);
          scanner.forget(candidate.path);
          state.lastSuccessAt = new Date().toISOString();
          delete state.lastError;
          console.log(JSON.stringify({ level: "info", event: "imported", path: candidate.path, filename, hash }));
        } else {
          const details = [result.message, result.stderr, result.stdout].filter((value) => value.length > 0).join(" ").slice(0, 2000);
          database.failure(hash, details, Date.now() + retryDelay(attempt));
          state.lastError = details;
          console.error(JSON.stringify({ level: "error", event: "import_failed", path: candidate.path, hash, attempt, message: details }));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown importer failure";
      state.lastError = message;
      console.error(JSON.stringify({ level: "error", event: "scan_failed", message }));
    } finally {
      state.running = false;
    }
  }

  return { cycle };
}
