import * as SQLite from "expo-sqlite";
import type { SyncSettings } from "./types";
import { defaultSettings } from "./types";

const databasePromise = SQLite.openDatabaseAsync("fairth-companion.sqlite");

export async function initializeDatabase(): Promise<void> {
  const database = await databasePromise;
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
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
