import { resolve } from "node:path";

export type Config = Readonly<{
  adbEndpoint: string;
  androidMediaDirectory: string;
  googlePhotosPackage: string;
  healthPort: number;
  dataDirectory: string;
  incomingRoot: string;
  pollIntervalMs: number;
  stableForMs: number;
  maxRetries: number;
}>;

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer; received ${raw}.`);
  return value;
}

export function loadConfig(): Config {
  return {
    adbEndpoint: process.env.ADB_ENDPOINT ?? "android:5555",
    androidMediaDirectory: process.env.ANDROID_MEDIA_DIRECTORY ?? "/storage/emulated/0/DCIM/Incoming",
    googlePhotosPackage: process.env.GOOGLE_PHOTOS_PACKAGE ?? "com.google.android.apps.photos",
    healthPort: positiveInteger("HEALTH_PORT", 3001),
    dataDirectory: resolve(process.env.IMPORTER_DATA ?? "/data"),
    incomingRoot: resolve(process.env.INCOMING_ROOT ?? "/incoming"),
    pollIntervalMs: positiveInteger("POLL_INTERVAL_MS", 5000),
    stableForMs: positiveInteger("STABLE_FOR_MS", 15000),
    maxRetries: positiveInteger("MAX_RETRIES", 8),
  };
}
