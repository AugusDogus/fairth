import { basename } from "node:path";

export type UploadMetadata = Readonly<{
  deviceId?: string;
  album?: string;
  capturedAt?: string;
}>;

export type UploadSession = Readonly<{
  id: string;
  filename: string;
  size: number;
  sha256?: string;
  createdAt: string;
  metadata: UploadMetadata;
}>;

export type ParseResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; message: string }>;

const SHA256 = /^[a-f0-9]{64}$/i;

export function safeFilename(input: string): string {
  const leaf = basename(input).normalize("NFKC");
  const safe = leaf.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 180);
  return safe.length > 0 ? safe : "upload.bin";
}

function optionalString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : undefined;
}

export function parseSessionRequest(value: unknown, maxBytes: number): ParseResult<Omit<UploadSession, "id" | "createdAt">> {
  if (typeof value !== "object" || value === null) return { ok: false, message: "Request body must be a JSON object." };
  const record = Object.fromEntries(Object.entries(value));
  const filename = record.filename;
  const size = record.size;
  const sha256 = record.sha256;
  if (typeof filename !== "string" || filename.length === 0 || filename.length > 255) {
    return { ok: false, message: "filename must contain 1 to 255 characters." };
  }
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > maxBytes) {
    return { ok: false, message: `size must be an integer between 1 and ${maxBytes} bytes.` };
  }
  if (sha256 !== undefined && (typeof sha256 !== "string" || !SHA256.test(sha256))) {
    return { ok: false, message: "sha256 must be a 64-character hexadecimal digest when supplied." };
  }
  const metadataValue = record.metadata;
  const metadataRecord = typeof metadataValue === "object" && metadataValue !== null
    ? Object.fromEntries(Object.entries(metadataValue))
    : {};
  const deviceId = optionalString(metadataRecord.deviceId, 128);
  const album = optionalString(metadataRecord.album, 255);
  const capturedAt = optionalString(metadataRecord.capturedAt, 64);
  if (metadataRecord.capturedAt !== undefined && (capturedAt === undefined || !Number.isFinite(Date.parse(capturedAt)))) {
    return { ok: false, message: "metadata.capturedAt must be a valid date-time string no longer than 64 characters." };
  }
  const metadata: UploadMetadata = {
    ...(deviceId === undefined ? {} : { deviceId }),
    ...(album === undefined ? {} : { album }),
    ...(capturedAt === undefined ? {} : { capturedAt }),
  };
  return {
    ok: true,
    value: {
      filename: safeFilename(filename),
      size,
      ...(typeof sha256 === "string" ? { sha256: sha256.toLowerCase() } : {}),
      metadata,
    },
  };
}
