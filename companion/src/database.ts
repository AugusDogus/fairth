import * as SQLite from "expo-sqlite";
import type { QueueItem, SyncSettings } from "./types";
import { defaultSettings } from "./types";

const databasePromise = SQLite.openDatabaseAsync("fairth-companion.sqlite");

type QueueRow = Readonly<{
  asset_id: string;
  uri: string;
  filename: string;
  media_type: string;
  created_at: number;
  album: string;
  status: string;
  attempts: number;
  next_attempt_at: number;
  upload_id: string | null;
  error: string | null;
}>;

function queueItem(row: QueueRow): QueueItem | undefined {
  if (row.media_type !== "photo" && row.media_type !== "video") return undefined;
  if (row.status !== "pending" && row.status !== "uploading" && row.status !== "retry" && row.status !== "uploaded") return undefined;
  return {
    assetId: row.asset_id,
    uri: row.uri,
    filename: row.filename,
    mediaType: row.media_type,
    createdAt: row.created_at,
    album: row.album,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    ...(row.upload_id === null ? {} : { uploadId: row.upload_id }),
    ...(row.error === null ? {} : { error: row.error }),
  };
}

export async function initializeDatabase(): Promise<void> {
  const database = await databasePromise;
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS queue (
      asset_id TEXT PRIMARY KEY,
      uri TEXT NOT NULL,
      filename TEXT NOT NULL,
      media_type TEXT NOT NULL CHECK(media_type IN ('photo', 'video')),
      created_at INTEGER NOT NULL,
      album TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('pending', 'uploading', 'retry', 'uploaded')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      upload_id TEXT,
      error TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS queue_work ON queue(status, next_attempt_at, created_at);
  `);
  await database.runAsync("UPDATE queue SET status = 'retry' WHERE status = 'uploading'");
}

export async function loadSettings(): Promise<SyncSettings> {
  const database = await databasePromise;
  const row = await database.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'sync'");
  if (row === null) return defaultSettings;
  try {
    const value: unknown = JSON.parse(row.value);
    if (typeof value !== "object" || value === null) return defaultSettings;
    const record = Object.fromEntries(Object.entries(value));
    return {
      primaryEndpoint: typeof record.primaryEndpoint === "string" ? record.primaryEndpoint : "",
      lanEndpoint: typeof record.lanEndpoint === "string" ? record.lanEndpoint : "",
      deviceId: typeof record.deviceId === "string" ? record.deviceId : "pixel",
      wifiOnly: record.wifiOnly !== false,
      chargingOnly: record.chargingOnly === true,
      automaticSync: record.automaticSync === true,
      windowStart: typeof record.windowStart === "number" ? record.windowStart : 0,
      windowEnd: typeof record.windowEnd === "number" ? record.windowEnd : 24,
      albumIds: Array.isArray(record.albumIds) ? record.albumIds.filter((id): id is string => typeof id === "string") : [],
    };
  } catch {
    return defaultSettings;
  }
}

export async function saveSettings(settings: SyncSettings): Promise<void> {
  const database = await databasePromise;
  await database.runAsync(
    "INSERT INTO settings (key, value) VALUES ('sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    JSON.stringify(settings),
  );
}

export async function settingValue(key: string): Promise<string | undefined> {
  const database = await databasePromise;
  const row = await database.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  return row?.value;
}

export async function setSettingValue(key: string, value: string): Promise<void> {
  const database = await databasePromise;
  await database.runAsync("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
}

export async function enqueue(item: Omit<QueueItem, "status" | "attempts" | "nextAttemptAt">): Promise<void> {
  const database = await databasePromise;
  await database.runAsync(
    `INSERT INTO queue (asset_id, uri, filename, media_type, created_at, album, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
     ON CONFLICT(asset_id) DO UPDATE SET uri = excluded.uri, filename = excluded.filename`,
    item.assetId, item.uri, item.filename, item.mediaType, item.createdAt, item.album, Date.now(),
  );
}

export async function nextQueueItem(): Promise<QueueItem | undefined> {
  const database = await databasePromise;
  const row = await database.getFirstAsync<QueueRow>(
    "SELECT * FROM queue WHERE status IN ('pending', 'retry') AND next_attempt_at <= ? ORDER BY created_at LIMIT 1",
    Date.now(),
  );
  return row === null ? undefined : queueItem(row);
}

export async function updateQueue(assetId: string, update: Readonly<{ status: QueueItem["status"]; attempts?: number; nextAttemptAt?: number; uploadId?: string | null; error?: string | null }>): Promise<void> {
  const database = await databasePromise;
  await database.runAsync(
    `UPDATE queue SET status = ?, attempts = COALESCE(?, attempts), next_attempt_at = COALESCE(?, next_attempt_at),
     upload_id = CASE WHEN ? = 1 THEN ? ELSE upload_id END,
     error = CASE WHEN ? = 1 THEN ? ELSE error END, updated_at = ? WHERE asset_id = ?`,
    update.status,
    update.attempts ?? null,
    update.nextAttemptAt ?? null,
    update.uploadId === undefined ? 0 : 1,
    update.uploadId ?? null,
    update.error === undefined ? 0 : 1,
    update.error ?? null,
    Date.now(),
    assetId,
  );
}

export async function queueCounts(): Promise<Readonly<{ pending: number; retry: number; uploaded: number }>> {
  const database = await databasePromise;
  const rows = await database.getAllAsync<{ status: string; count: number }>("SELECT status, COUNT(*) AS count FROM queue GROUP BY status");
  const counts = { pending: 0, retry: 0, uploaded: 0 };
  for (const row of rows) {
    if (row.status === "pending" || row.status === "uploading") counts.pending += row.count;
    else if (row.status === "retry") counts.retry += row.count;
    else if (row.status === "uploaded") counts.uploaded += row.count;
  }
  return counts;
}
