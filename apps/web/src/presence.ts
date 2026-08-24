import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const recentCompanionMs = 60 * 60 * 1_000;

function tokenFilename(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createCompanionPresence(authDataRoot: string) {
  const directory = join(authDataRoot, "companion-presence");

  return {
    async touch(token: string): Promise<void> {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, tokenFilename(token)), `${new Date().toISOString()}\n`, { encoding: "utf8", mode: 0o600 });
    },
    async isRecent(token: string, now = Date.now()): Promise<boolean> {
      try {
        const info = await stat(join(directory, tokenFilename(token)));
        return now - info.mtimeMs <= recentCompanionMs;
      } catch {
        return false;
      }
    },
  };
}

export type CompanionPresence = ReturnType<typeof createCompanionPresence>;
