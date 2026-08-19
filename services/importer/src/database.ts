import { Database } from "bun:sqlite";
import { join } from "node:path";

export type ImportRecord = Readonly<{
  hash: string;
  sourcePath: string;
  filename: string;
  status: "pending" | "imported" | "failed" | "duplicate";
  attempts: number;
  nextAttemptAt: number;
  error?: string;
  importedAt?: string;
}>;

function parseRecord(value: unknown): ImportRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const row = Object.fromEntries(Object.entries(value));
  if (typeof row.hash !== "string" || typeof row.source_path !== "string" || typeof row.filename !== "string") return undefined;
  if (row.status !== "pending" && row.status !== "imported" && row.status !== "failed" && row.status !== "duplicate") return undefined;
  if (typeof row.attempts !== "number" || typeof row.next_attempt_at !== "number") return undefined;
  return {
    hash: row.hash,
    sourcePath: row.source_path,
    filename: row.filename,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    ...(typeof row.error === "string" ? { error: row.error } : {}),
    ...(typeof row.imported_at === "string" ? { importedAt: row.imported_at } : {}),
  };
}

export function createImportDatabase(dataDirectory: string) {
  const database = new Database(join(dataDirectory, "importer.sqlite"), { create: true });
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS imports (
      hash TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      filename TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'imported', 'failed', 'duplicate')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      imported_at TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  const findStatement = database.prepare("SELECT * FROM imports WHERE hash = ?");
  const beginStatement = database.prepare(`
    INSERT INTO imports (hash, source_path, filename, status, attempts, next_attempt_at, updated_at)
    VALUES (?, ?, ?, 'pending', 1, 0, ?)
    ON CONFLICT(hash) DO UPDATE SET
      source_path = excluded.source_path,
      filename = excluded.filename,
      status = 'pending',
      attempts = imports.attempts + 1,
      error = NULL,
      updated_at = excluded.updated_at
  `);
  const successStatement = database.prepare("UPDATE imports SET status = 'imported', imported_at = ?, error = NULL, updated_at = ? WHERE hash = ?");
  const duplicateStatement = database.prepare("UPDATE imports SET status = 'duplicate', imported_at = ?, error = NULL, updated_at = ? WHERE hash = ?");
  const failureStatement = database.prepare("UPDATE imports SET status = 'failed', next_attempt_at = ?, error = ?, updated_at = ? WHERE hash = ?");

  return {
    find(hash: string): ImportRecord | undefined {
      return parseRecord(findStatement.get(hash));
    },
    begin(hash: string, sourcePath: string, filename: string): void {
      beginStatement.run(hash, sourcePath, filename, new Date().toISOString());
    },
    success(hash: string): void {
      const now = new Date().toISOString();
      successStatement.run(now, now, hash);
    },
    duplicate(hash: string): void {
      const now = new Date().toISOString();
      duplicateStatement.run(now, now, hash);
    },
    failure(hash: string, message: string, nextAttemptAt: number): void {
      failureStatement.run(nextAttemptAt, message, new Date().toISOString(), hash);
    },
    counts(): Readonly<Record<string, number>> {
      const rows = database.prepare("SELECT status, COUNT(*) AS count FROM imports GROUP BY status").all();
      const counts: Record<string, number> = {};
      for (const value of rows) {
        if (typeof value !== "object" || value === null) continue;
        const row = Object.fromEntries(Object.entries(value));
        if (typeof row.status === "string" && typeof row.count === "number") counts[row.status] = row.count;
      }
      return counts;
    },
    close(): void { database.close(); },
  };
}

export type ImportDatabase = ReturnType<typeof createImportDatabase>;
