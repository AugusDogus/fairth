import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export type ImportMetadata = Readonly<{
  remoteFilename: string;
  capturedAtMs: number;
  deviceId?: string;
}>;

export type ImportMetadataResult =
  | Readonly<{ ok: true; value: ImportMetadata }>
  | Readonly<{ ok: false; message: string }>;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function safeAndroidFilename(value: string): string {
  const leaf = basename(value).normalize("NFKC");
  const safe = leaf.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-180);
  return safe.length > 0 ? safe : "media.bin";
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : undefined;
}

function parsedCaptureTime(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : undefined;
}

export async function readImportMetadata(
  sourcePath: string,
  actualSha256: string,
  fallbackModifiedAtMs: number,
): Promise<ImportMetadataResult> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(`${sourcePath}.upload.json`, "utf8"));
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return {
        ok: true,
        value: { remoteFilename: safeAndroidFilename(sourcePath), capturedAtMs: fallbackModifiedAtMs },
      };
    }
    return { ok: false, message: "Upload manifest is unreadable or invalid JSON. The media file was not imported." };
  }

  const manifest = record(value);
  if (manifest === undefined || typeof manifest.originalFilename !== "string" || manifest.originalFilename.length === 0 || manifest.originalFilename.length > 255) {
    return { ok: false, message: "Upload manifest does not contain a valid original filename. The media file was not imported." };
  }
  if (manifest.sha256 !== actualSha256) {
    return { ok: false, message: "Upload manifest SHA-256 does not match the received media. The file was not imported." };
  }
  const metadata = record(manifest.metadata) ?? {};
  const capturedAtMs = parsedCaptureTime(metadata.capturedAt) ?? fallbackModifiedAtMs;
  const deviceId = typeof metadata.deviceId === "string" && metadata.deviceId.length > 0 && metadata.deviceId.length <= 128
    ? metadata.deviceId
    : undefined;
  return {
    ok: true,
    value: {
      remoteFilename: safeAndroidFilename(manifest.originalFilename),
      capturedAtMs,
      ...(deviceId === undefined ? {} : { deviceId }),
    },
  };
}
