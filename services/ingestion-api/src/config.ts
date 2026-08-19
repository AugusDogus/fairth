import { resolve } from "node:path";

export type Config = Readonly<{
  host: string;
  port: number;
  incomingRoot: string;
  token: string;
  maxUploadBytes: number;
  chunkBytes: number;
}>;

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received ${raw}.`);
  }
  return value;
}

export function loadConfig(): Config {
  const token = process.env.INGESTION_TOKEN;
  if (token === undefined || token.length < 24) {
    throw new Error("INGESTION_TOKEN must contain at least 24 characters. Generate one with `openssl rand -hex 32`.");
  }

  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: positiveInteger("PORT", 3000),
    incomingRoot: resolve(process.env.INCOMING_ROOT ?? "/incoming"),
    token,
    maxUploadBytes: positiveInteger("MAX_UPLOAD_BYTES", 50 * 1024 * 1024 * 1024),
    chunkBytes: positiveInteger("UPLOAD_CHUNK_BYTES", 8 * 1024 * 1024),
  };
}
