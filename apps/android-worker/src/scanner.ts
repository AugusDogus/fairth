import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Config } from "./config.js";

export type Candidate = Readonly<{ path: string; size: number }>;
type Observation = Readonly<{ size: number; mtimeMs: number; stableSince: number }>;

const MEDIA_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".dng",
  ".mp4", ".mov", ".m4v", ".3gp", ".mkv", ".webm",
]);

async function walk(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else if (entry.isFile() && MEDIA_EXTENSIONS.has(extname(entry.name).toLowerCase())) paths.push(path);
  }
  return paths;
}

export function createStableScanner(config: Config) {
  const observations = new Map<string, Observation>();

  async function scan(now = Date.now()): Promise<Candidate[]> {
    const paths = [...await walk(join(config.incomingRoot, "ready")), ...await walk(join(config.incomingRoot, "drop"))];
    const present = new Set(paths);
    const candidates: Candidate[] = [];
    for (const path of paths) {
      const info = await stat(path);
      const previous = observations.get(path);
      if (previous === undefined || previous.size !== info.size || previous.mtimeMs !== info.mtimeMs) {
        observations.set(path, { size: info.size, mtimeMs: info.mtimeMs, stableSince: now });
      } else if (now - previous.stableSince >= config.stableForMs) {
        candidates.push({ path, size: info.size });
      }
    }
    for (const path of observations.keys()) if (!present.has(path)) observations.delete(path);
    return candidates;
  }

  function forget(path: string): void { observations.delete(path); }
  return { scan, forget };
}

export async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
