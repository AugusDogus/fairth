import { resolve } from "node:path";

export type Config = Readonly<{
  host: string;
  port: number;
  incomingRoot: string;
  authDataRoot: string;
  publicBaseUrl: string;
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
  const port = positiveInteger("PORT", 3000);
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
  const parsedPublicUrl = new URL(publicBaseUrl);
  if ((parsedPublicUrl.protocol !== "http:" && parsedPublicUrl.protocol !== "https:") || parsedPublicUrl.pathname !== "/") {
    throw new Error(`PUBLIC_BASE_URL must be an HTTP(S) origin without a path; received ${publicBaseUrl}.`);
  }

  return {
    host: process.env.HOST ?? "0.0.0.0",
    port,
    incomingRoot: resolve(process.env.INCOMING_ROOT ?? "/incoming"),
    authDataRoot: resolve(process.env.AUTH_DATA_ROOT ?? "/data"),
    publicBaseUrl: parsedPublicUrl.origin,
    maxUploadBytes: positiveInteger("MAX_UPLOAD_BYTES", 50 * 1024 * 1024 * 1024),
    chunkBytes: positiveInteger("UPLOAD_CHUNK_BYTES", 8 * 1024 * 1024),
  };
}
